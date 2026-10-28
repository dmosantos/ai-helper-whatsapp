import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openDb, type Db } from '../cache/db.ts';
import { allChats, contactNamesByNumber, resolveStanzas, type ChatRow, type MessageRow } from '../cache/repo.ts';
import { loadConfig, paths, type Config } from '../config.ts';
import { CliError, EXIT } from '../errors.ts';
import { normalize, slugify, ymd } from '../fmt.ts';
import { log } from '../log.ts';
import { refreshChats } from '../wa/fetcher.ts';
import { WaSession } from '../wa/client.ts';
import { renderCsv } from '../output/csv.ts';
import { renderJson } from '../output/json.ts';
import { renderHeader, renderLlm, type RenderMeta, type RenderOptions } from '../output/render.ts';

export type Format = 'llm' | 'md' | 'json' | 'csv';

export interface App {
  db: Db;
  cfg: Config;
  session: WaSession;
  offline: boolean;
}

export function openApp(offline = false): App {
  return { db: openDb(), cfg: loadConfig(), session: new WaSession(), offline };
}

export function parseFormat(value: string | undefined): Format {
  const f = (value ?? 'llm').toLowerCase();
  if (f === 'llm' || f === 'md' || f === 'json' || f === 'csv') return f;
  throw new CliError(EXIT.USAGE, `Formato inválido: "${value}". Use llm, md, json ou csv.`);
}

// ------------------------------------------------------------ resolução de chat

function chatLine(c: ChatRow): string {
  return `${c.id}\t${c.name ?? '(sem nome)'}\t${c.is_group ? 'grupo' : 'pessoa'}`;
}

export function findChats(chats: ChatRow[], query: string): ChatRow[] {
  const raw = query.trim();
  if (raw.includes('@')) return chats.filter((c) => c.id.toLowerCase() === raw.toLowerCase());

  const q = normalize(raw);
  const exact = chats.filter((c) => c.name && normalize(c.name) === q);
  if (exact.length > 0) return exact;

  const partial = chats.filter((c) => c.name && normalize(c.name).includes(q));
  if (partial.length > 0) return partial;

  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 6) return chats.filter((c) => c.id.split('@')[0].endsWith(digits) || c.id.includes(digits));
  return [];
}

/** Resolve nome/id/telefone para um chat. Consulta o cache e só abre o WhatsApp se não achar. */
export async function resolveChat(app: App, query: string): Promise<ChatRow> {
  let found = findChats(allChats(app.db), query);
  if (found.length === 0 && !app.offline) {
    log('chat não está no cache; atualizando a lista de conversas…');
    const client = await app.session.get();
    const n = await refreshChats(app.db, client);
    log(`  ${n} conversas atualizadas`);
    found = findChats(allChats(app.db), query);
  }
  if (found.length === 0) {
    throw new CliError(
      EXIT.CHAT_NOT_FOUND,
      `Nenhum chat encontrado para "${query}". Use: wa-fetch chats --search "<parte do nome>"${app.offline ? ' (modo offline: só cache)' : ''}`,
    );
  }
  if (found.length > 1) {
    const list = found.slice(0, 15).map(chatLine).join('\n');
    throw new CliError(
      EXIT.AMBIGUOUS_CHAT,
      `"${query}" corresponde a ${found.length} chats. Repita com --chat <id> (id<TAB>nome<TAB>tipo):\n${list}`,
    );
  }
  return found[0];
}

// ----------------------------------------------------------------- renderização

/** Mapa `stanza → mensagem` das mensagens citadas pelas linhas dadas (mesmo fora do período). */
export function quotedMap(db: Db, rows: MessageRow[]): Map<string, MessageRow> {
  const out = new Map<string, MessageRow>();
  const byChat = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.quoted_stanza) continue;
    byChat.set(r.chat_id, [...(byChat.get(r.chat_id) ?? []), r.quoted_stanza]);
  }
  for (const [chatId, stanzas] of byChat) {
    for (const [k, v] of resolveStanzas(db, chatId, stanzas)) out.set(k, v);
  }
  return out;
}

export function renderRows(db: Db, rows: MessageRow[], meta: RenderMeta, format: Format, extra: RenderOptions = {}): string {
  const opts: RenderOptions = {
    quoted: quotedMap(db, rows),
    mentions: contactNamesByNumber(db),
    ...extra,
    style: format === 'md' ? 'md' : 'llm',
  };
  switch (format) {
    case 'json':
      return renderJson(rows, meta, opts);
    case 'csv':
      return renderCsv(rows, meta, opts);
    default:
      return renderLlm(rows, meta, opts);
  }
}

const EXT: Record<Format, string> = { llm: 'txt', md: 'md', json: 'json', csv: 'csv' };

export interface EmitOptions {
  format: Format;
  out?: string;
  /** Nome base do arquivo quando a saída é desviada para `data/out`. */
  name: string;
}

/**
 * Entrega a saída: stdout quando cabe; caso contrário (ou com `--out`) grava em arquivo
 * e imprime só o cabeçalho com o caminho, para não estourar o contexto de quem lê.
 */
export function emit(content: string, rows: MessageRow[], meta: RenderMeta, opts: EmitOptions, maxChars: number): void {
  const divert = opts.out !== undefined || content.length > maxChars;
  if (!divert) {
    process.stdout.write(content);
    return;
  }
  const file = opts.out ?? join(paths.out, `${slugify(opts.name)}.${EXT[opts.format]}`);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content, 'utf8');
  const head =
    opts.format === 'llm' || opts.format === 'md'
      ? renderHeader(rows, meta).join('\n')
      : `# chat: ${meta.chat.name ?? meta.chat.id} | msgs: ${rows.length}`;
  const why = opts.out !== undefined ? '' : ` (saída com ${content.length} caracteres excede o limite de ${maxChars} para o stdout)`;
  process.stdout.write(`${head}\n# saída gravada em: ${file}${why}\n# leia o arquivo em partes (ex.: por dia) para analisar.\n`);
}

export function outName(chat: ChatRow, from: number, to: number, tz: string): string {
  return `${slugify(chat.name ?? basename(chat.id))}-${ymd(from, tz)}_${ymd(to, tz)}`;
}
