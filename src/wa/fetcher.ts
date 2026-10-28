import type { Interval } from '../cache/coverage.ts';
import type { Db } from '../cache/db.ts';
import { upsertChats, upsertContacts, type ContactInput } from '../cache/repo.ts';
import { log } from '../log.ts';
import type { WaClient } from './client.ts';

const START_LIMIT = 150;
const MAX_LIMIT = 60_000;

export interface GapResult {
  /** Mensagens brutas do whatsapp-web.js dentro da lacuna, em ordem cronológica. */
  messages: any[];
  /** O WhatsApp Web não tem mensagens mais antigas que `oldestTs` (histórico esgotado). */
  exhausted: boolean;
  /** Limite de carregamento atingido antes de alcançar o início da lacuna. */
  capped: boolean;
  oldestTs: number | null;
}

/** Atualiza a tabela `chats` com a lista ao vivo do WhatsApp. */
export async function refreshChats(db: Db, client: WaClient): Promise<number> {
  const chats = await client.getChats();
  upsertChats(
    db,
    chats.map((c: any) => ({
      id: c.id._serialized as string,
      name: (c.name as string) || null,
      is_group: c.isGroup ? 1 : 0,
      last_ts: typeof c.timestamp === 'number' ? c.timestamp : null,
    })),
  );
  return chats.length;
}

/**
 * Carrega as mensagens de `gap`. `fetchMessages` sempre parte das mais recentes,
 * então aumentamos o `limit` até a mensagem mais antiga passar do início da lacuna.
 */
export async function fetchGap(client: WaClient, chatId: string, gap: Interval): Promise<GapResult> {
  const chat = await client.getChatById(chatId);
  let limit = START_LIMIT;
  for (;;) {
    const fetched: any[] = await chat.fetchMessages({ limit });
    const sorted = fetched.sort((a, b) => a.timestamp - b.timestamp);
    const oldestTs = sorted.length ? (sorted[0].timestamp as number) : null;
    const exhausted = sorted.length < limit;
    const reached = oldestTs !== null && oldestTs <= gap.from;
    const capped = !exhausted && !reached && limit >= MAX_LIMIT;

    if (exhausted || reached || capped) {
      return {
        messages: sorted.filter((m) => m.timestamp >= gap.from && m.timestamp <= gap.to),
        exhausted,
        capped,
        oldestTs,
      };
    }
    limit = Math.min(limit * 4, MAX_LIMIT);
    log(`  carregando histórico… (${sorted.length} mensagens, mais antiga: ${oldestTs ? new Date(oldestTs * 1000).toISOString().slice(0, 10) : '-'})`);
  }
}

/** Resolve nomes dos autores que ainda não estão no cache de contatos. */
export async function resolveContacts(db: Db, client: WaClient, ids: string[]): Promise<void> {
  const found: ContactInput[] = [];
  for (const id of ids) {
    try {
      const c: any = await client.getContactById(id);
      found.push({
        id,
        name: (c.name as string) || null,
        pushname: (c.pushname as string) || (c.shortName as string) || null,
        number: (c.number as string) || id.split('@')[0],
      });
    } catch {
      found.push({ id, number: id.split('@')[0] });
    }
  }
  if (found.length) upsertContacts(db, found);
}

/** Registra o próprio usuário como contato, para exibir "(eu)" com o nome certo. */
export function rememberSelf(db: Db, client: WaClient): string | null {
  const info: any = client.info;
  const id: string | undefined = info?.wid?._serialized;
  if (!id) return null;
  upsertContacts(db, [{ id, pushname: info.pushname ?? null, number: id.split('@')[0] }]);
  return id;
}
