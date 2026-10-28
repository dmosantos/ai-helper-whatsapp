import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import wweb from 'whatsapp-web.js';
import { ensureDir, findBrowser, loadConfig, paths } from '../config.ts';
import { CliError, EXIT } from '../errors.ts';
import { log } from '../log.ts';

const { Client, LocalAuth } = wweb;
export type WaClient = InstanceType<typeof Client>;

export interface StartOptions {
  /** Modo `login`: mostra o QR e espera o escaneamento em vez de falhar. */
  interactive?: boolean;
}

function createClient(): WaClient {
  const cfg = loadConfig();
  const executablePath = findBrowser(cfg);
  if (!executablePath) {
    throw new CliError(EXIT.UNAVAILABLE, 'Chrome/Edge não encontrado. Defina "browserPath" em wa-fetch.config.json.');
  }
  ensureDir(paths.session);
  return new Client({
    authStrategy: new LocalAuth({ dataPath: paths.session }),
    puppeteer: {
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    },
  });
}

async function destroyQuietly(client: WaClient): Promise<void> {
  await Promise.race([client.destroy().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
}

/** Inicia o cliente e resolve quando o WhatsApp Web estiver pronto. */
export async function startClient(opts: StartOptions = {}): Promise<WaClient> {
  const cfg = loadConfig();
  const client = createClient();
  const timeoutMs = opts.interactive ? 5 * 60_000 : cfg.startupTimeoutMs;

  return new Promise<WaClient>((resolve, reject) => {
    let settled = false;
    const fail = (err: CliError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void destroyQuietly(client).finally(() => reject(err));
    };
    const timer = setTimeout(
      () => fail(new CliError(EXIT.UNAVAILABLE, `WhatsApp Web não ficou pronto em ${Math.round(timeoutMs / 1000)}s.`)),
      timeoutMs,
    );

    client.on('qr', (qr: string) => {
      if (!opts.interactive) {
        fail(new CliError(EXIT.AUTH, 'Sessão do WhatsApp ausente ou expirada. Peça ao usuário para rodar: wa-fetch login'));
        return;
      }
      log('\nEscaneie o QR code no WhatsApp (Aparelhos conectados → Conectar um aparelho):\n');
      qrcodeTerminal.generate(qr, { small: true }, (art: string) => process.stderr.write(`${art}\n`));
      QRCode.toFile(paths.qr, qr, { width: 400 }).catch(() => undefined);
      log(`(o QR também é salvo em ${paths.qr})`);
    });
    client.on('auth_failure', (m: string) => fail(new CliError(EXIT.AUTH, `Falha de autenticação: ${m}. Rode: wa-fetch login`)));
    client.on('loading_screen', (percent: number | string) => log(`carregando WhatsApp Web… ${percent}%`));
    if (process.env.WA_FETCH_DEBUG) {
      const t0 = Date.now();
      for (const ev of ['authenticated', 'change_state', 'disconnected', 'auth_failure', 'ready', 'remote_session_saved']) {
        client.on(ev as never, (...a: unknown[]) => log(`[debug +${Math.round((Date.now() - t0) / 1000)}s] ${ev}`, ...a.map((x) => String(x).slice(0, 80))));
      }
    }
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(client);
    };
    client.on('ready', succeed);
    // O evento 'ready' do whatsapp-web.js às vezes não dispara: o WhatsApp Web navega no meio do
    // attachEventListeners e a promessa fica pendente. Para leitura isso não importa, então também
    // consideramos o cliente pronto quando autenticado, com WWebJS injetado e o socket conectado.
    client.on('authenticated', () => {
      void (async () => {
        await new Promise((r) => setTimeout(r, 6_000)); // deixa as navegações da página assentarem
        while (!settled) {
          try {
            const ok = await client.pupPage?.evaluate(
              "typeof window.WWebJS !== 'undefined' && window.require('WAWebSocketModel').Socket.state === 'CONNECTED'",
            );
            if (ok && client.info) return succeed();
          } catch {
            // contexto destruído por navegação: tenta de novo
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      })();
    });
    client.initialize().catch((err: unknown) => fail(new CliError(EXIT.UNAVAILABLE, `Falha ao iniciar o WhatsApp Web: ${(err as Error).message}`)));
  });
}

/** Mantém no máximo um cliente por execução, iniciado só quando alguém precisa dele. */
export class WaSession {
  private client?: Promise<WaClient>;

  get(): Promise<WaClient> {
    this.client ??= startClient();
    return this.client;
  }

  get started(): boolean {
    return this.client !== undefined;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    const pending = this.client;
    this.client = undefined;
    const c = await pending.catch(() => undefined);
    if (c) await destroyQuietly(c);
  }
}
