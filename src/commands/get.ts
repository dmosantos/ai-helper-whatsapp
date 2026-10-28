import { computeDelta, subtractIntervals, type Interval } from '../cache/coverage.ts';
import {
  addCoverage,
  authorsWithoutContact,
  getChat,
  getCoverage,
  lastCovered,
  logSync,
  messagesInRange,
  pendingMedia,
  pendingTranscriptions,
  setHistoryStart,
  upsertMessages,
  type ChatRow,
} from '../cache/repo.ts';
import { CliError, EXIT } from '../errors.ts';
import { ymdhm } from '../fmt.ts';
import { log } from '../log.ts';
import { downloadPending } from '../media/download.ts';
import type { RenderMeta } from '../output/render.ts';
import { resolvePeriod } from '../period.ts';
import { transcribeRows } from '../transcribe/runner.ts';
import { fetchGap, rememberSelf, resolveContacts } from '../wa/fetcher.ts';
import { mapMessage } from '../wa/mapper.ts';
import { emit, openApp, outName, parseFormat, renderRows, resolveChat, type App } from './shared.ts';

export interface GetOptions {
  chat: string;
  from?: string;
  to?: string;
  last?: string;
  format?: string;
  out?: string;
  offline?: boolean;
  refresh?: boolean;
  transcribe?: boolean; // --no-transcribe => false
  media?: boolean; // --no-media => false
  includeSystem?: boolean;
  maxDays?: string;
  quiet?: boolean;
}

interface SyncReport {
  fetched: number;
  warnings: string[];
}

async function syncGap(app: App, chat: ChatRow, gap: Interval, mode: string): Promise<SyncReport> {
  const client = await app.session.get();
  const myId = rememberSelf(app.db, client);
  log(`baixando ${ymdhm(gap.from, app.cfg.timezone)} → ${ymdhm(gap.to, app.cfg.timezone)}…`);

  const res = await fetchGap(client, chat.id, gap);
  const inputs = res.messages.map((m) => mapMessage(m, chat.id, myId));
  upsertMessages(app.db, inputs);

  const warnings: string[] = [];
  let coveredFrom = gap.from;
  if (res.capped) {
    coveredFrom = res.oldestTs ?? gap.from;
    warnings.push(`limite de carregamento atingido: só há mensagens a partir de ${ymdhm(coveredFrom, app.cfg.timezone)}`);
  } else if (res.exhausted && res.oldestTs !== null && res.oldestTs > gap.from) {
    setHistoryStart(app.db, chat.id, res.oldestTs);
  }
  addCoverage(app.db, chat.id, { from: coveredFrom, to: gap.to });
  logSync(app.db, chat.id, { from: coveredFrom, to: gap.to }, inputs.length, mode);

  await resolveContacts(app.db, client, authorsWithoutContact(app.db, chat.id));
  return { fetched: inputs.length, warnings };
}

export async function getCommand(opts: GetOptions): Promise<void> {
  const app = openApp(Boolean(opts.offline));
  try {
    const { db, cfg } = app;
    const tz = cfg.timezone;
    const now = Math.floor(Date.now() / 1000);
    const warnings: string[] = [];

    const chat = await resolveChat(app, opts.chat);
    const maxDays = opts.maxDays ? Number(opts.maxDays) : cfg.maxDays;
    if (!Number.isFinite(maxDays) || maxDays <= 0) throw new CliError(EXIT.USAGE, '--max-days inválido.');

    // 1. período: explícito ou delta
    const explicit = resolvePeriod({ from: opts.from, to: opts.to, last: opts.last }, tz, now);
    let range: Interval;
    let mode: string;
    if (explicit) {
      range = explicit;
      mode = 'período';
    } else {
      const last = lastCovered(db, chat.id);
      const plan = computeDelta(last, now, maxDays);
      range = plan.range;
      mode = plan.firstSync
        ? `delta (primeira sincronização: últimos ${maxDays} dias)`
        : `delta desde ${ymdhm(last as number, tz)}`;
      if (plan.truncated && plan.skipped) {
        warnings.push(
          `última sincronização há mais de ${maxDays} dias: ficou um buraco sem cobertura entre ${ymdhm(plan.skipped.from, tz)} e ${ymdhm(plan.skipped.to, tz)} (preencha com --from/--to se precisar)`,
        );
      }
    }

    // 2. lacunas = período − cobertura
    const gaps = opts.refresh ? [range] : subtractIntervals(range, getCoverage(db, chat.id));
    const needSync = gaps.length > 0 && !app.offline;
    if (gaps.length > 0 && app.offline) {
      warnings.push(
        `modo offline: trechos sem cache não foram baixados (${gaps.map((g) => `${ymdhm(g.from, tz)}→${ymdhm(g.to, tz)}`).join('; ')})`,
      );
    }

    // 3. sincroniza e baixa mídias pendentes (abre o WhatsApp só se necessário)
    const wantMedia = opts.media !== false && !app.offline;
    let pending = wantMedia ? pendingMedia(db, chat.id, range.from, range.to) : [];
    if (needSync || pending.length > 0) {
      let fetched = 0;
      if (needSync) {
        for (const gap of gaps) {
          const r = await syncGap(app, chat, gap, mode);
          fetched += r.fetched;
          warnings.push(...r.warnings);
        }
        log(`${fetched} mensagens sincronizadas`);
      }
      if (wantMedia) {
        pending = pendingMedia(db, chat.id, range.from, range.to);
        if (pending.length > 0) {
          log(`baixando ${pending.length} mídia(s)…`);
          const s = await downloadPending(db, await app.session.get(), pending);
          log(`  mídias: ${s.downloaded} baixadas, ${s.failed} indisponíveis, ${s.skipped} ignoradas (tamanho)`);
        }
      }
    }

    // 4. transcrição dos áudios do período
    if (opts.transcribe !== false) {
      const t = await transcribeRows(db, pendingTranscriptions(db, { chatId: chat.id, from: range.from, to: range.to }));
      if (t.unavailable) warnings.push('transcrição indisponível (uv/Python não encontrado ou desativada): áudios ficaram pendentes');
    }

    // 5. renderiza a partir do cache
    const rows = messagesInRange(db, chat.id, range.from, range.to, Boolean(opts.includeSystem));
    const fresh = getChat(db, chat.id) ?? chat;
    if (fresh.history_start_ts && range.from < fresh.history_start_ts) {
      warnings.push(`histórico anterior a ${ymdhm(fresh.history_start_ts, tz)} não está disponível no WhatsApp Web`);
    }
    const pendingAudio = rows.filter((r) => r.media_kind === 'audio' && r.transcription_status === 'pending').length;
    if (pendingAudio > 0) warnings.push(`${pendingAudio} áudio(s) sem transcrição`);
    const failedMedia = rows.filter((r) => r.media_status === 'failed').length;
    if (failedMedia > 0) warnings.push(`${failedMedia} mídia(s) indisponíveis no WhatsApp`);
    const unfetched = rows.filter((r) => r.media_status === 'pending').length;
    if (unfetched > 0) warnings.push(`${unfetched} mídia(s) ainda não baixadas`);

    const stillMissing = subtractIntervals(range, getCoverage(db, chat.id)).length > 0;
    const meta: RenderMeta = {
      chat: fresh,
      from: range.from,
      to: range.to,
      tz,
      mode,
      coverage: stillMissing ? 'parcial' : 'completa',
      warnings,
    };

    const format = parseFormat(opts.format);
    const content = renderRows(db, rows, meta, format);

    if (opts.quiet) {
      process.stdout.write(`${rows.length} mensagens no período (${mode}); avisos: ${warnings.length ? warnings.join(' | ') : 'nenhum'}\n`);
      return;
    }
    emit(content, rows, meta, { format, out: opts.out, name: outName(chat, range.from, range.to, tz) }, cfg.maxStdoutChars);
  } finally {
    await app.session.close();
  }
}
