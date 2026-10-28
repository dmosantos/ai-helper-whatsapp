import { createHash } from 'node:crypto';
import { mergeIntervals, type Interval } from './coverage.ts';
import { tx, type Db } from './db.ts';

export interface ChatRow {
  id: string;
  name: string | null;
  is_group: number;
  last_ts: number | null;
  history_start_ts: number | null;
  updated_at: number | null;
}

export interface ContactInput {
  id: string;
  name?: string | null;
  pushname?: string | null;
  number?: string | null;
}

export interface MessageInput {
  id: string;
  chat_id: string;
  ts: number;
  author_id: string | null;
  author_name: string | null;
  from_me: boolean;
  type: string;
  body: string | null;
  stanza: string | null;
  quoted_stanza: string | null;
  is_system: boolean;
  is_edited: boolean;
  is_deleted: boolean;
  is_forwarded: boolean;
  media_kind: string | null;
  media_mime: string | null;
  media_filename: string | null;
  media_size: number | null;
  duration: number | null;
}

export interface MessageRow {
  id: string;
  short_id: string;
  chat_id: string;
  ts: number;
  author_id: string | null;
  author_name: string | null;
  from_me: number;
  type: string;
  body: string | null;
  stanza: string | null;
  quoted_stanza: string | null;
  is_system: number;
  is_edited: number;
  is_deleted: number;
  is_forwarded: number;
  media_kind: string | null;
  media_status: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_filename: string | null;
  media_size: number | null;
  duration: number | null;
  transcription: string | null;
  transcription_status: string | null;
  transcription_model: string | null;
  display_name: string | null;
}

const NAME_SQL = `COALESCE(NULLIF(c.name, ''), NULLIF(m.author_name, ''), NULLIF(c.pushname, ''), c.number, m.author_id)`;
const SELECT_MSG = `SELECT m.*, ${NAME_SQL} AS display_name FROM messages m LEFT JOIN contacts c ON c.id = m.author_id`;

// ---------------------------------------------------------------- chats

export function upsertChats(db: Db, chats: Array<Pick<ChatRow, 'id' | 'name' | 'is_group' | 'last_ts'>>): void {
  const stmt = db.prepare(
    `INSERT INTO chats (id, name, is_group, last_ts, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_group = excluded.is_group,
       last_ts = COALESCE(excluded.last_ts, last_ts), updated_at = excluded.updated_at`,
  );
  const now = Math.floor(Date.now() / 1000);
  tx(db, () => {
    for (const c of chats) stmt.run(c.id, c.name, c.is_group, c.last_ts, now);
  });
}

export function allChats(db: Db): ChatRow[] {
  return db.prepare('SELECT * FROM chats ORDER BY COALESCE(last_ts, 0) DESC').all() as unknown as ChatRow[];
}

export function getChat(db: Db, id: string): ChatRow | undefined {
  return db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as unknown as ChatRow | undefined;
}

export function setHistoryStart(db: Db, chatId: string, ts: number | null): void {
  db.prepare('UPDATE chats SET history_start_ts = ? WHERE id = ?').run(ts, chatId);
}

// ------------------------------------------------------------- contacts

export function upsertContacts(db: Db, contacts: ContactInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO contacts (id, name, pushname, number) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, name),
       pushname = COALESCE(excluded.pushname, pushname), number = COALESCE(excluded.number, number)`,
  );
  tx(db, () => {
    for (const c of contacts) stmt.run(c.id, c.name ?? null, c.pushname ?? null, c.number ?? null);
  });
}

/** Autores de mensagens do chat que ainda não têm registro em `contacts`. */
export function authorsWithoutContact(db: Db, chatId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT m.author_id AS id FROM messages m LEFT JOIN contacts c ON c.id = m.author_id
       WHERE m.chat_id = ? AND m.author_id IS NOT NULL AND c.id IS NULL`,
    )
    .all(chatId) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Mapa `numero → nome` para resolver menções (`@5511999990000`) no texto. */
export function contactNamesByNumber(db: Db): Map<string, string> {
  const rows = db
    .prepare(`SELECT number, COALESCE(NULLIF(name, ''), NULLIF(pushname, '')) AS n FROM contacts WHERE number IS NOT NULL`)
    .all() as Array<{ number: string; n: string | null }>;
  const map = new Map<string, string>();
  for (const r of rows) if (r.n) map.set(r.number, r.n);
  return map;
}

// ------------------------------------------------------------- messages

function ftsText(body: string | null, transcription: string | null, filename: string | null): string {
  return [body, transcription, filename].filter(Boolean).join('\n');
}

export function reindexMessage(db: Db, id: string): void {
  const row = db.prepare('SELECT rowid AS rid, body, transcription, media_filename FROM messages WHERE id = ?').get(id) as
    | { rid: number; body: string | null; transcription: string | null; media_filename: string | null }
    | undefined;
  if (!row) return;
  db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(row.rid);
  const text = ftsText(row.body, row.transcription, row.media_filename);
  if (text) db.prepare('INSERT INTO messages_fts (rowid, text) VALUES (?, ?)').run(row.rid, text);
}

function assignShortId(db: Db, id: string): string {
  const hash = createHash('sha1').update(id).digest('hex');
  const exists = db.prepare('SELECT 1 FROM messages WHERE short_id = ?');
  for (let len = 6; len <= hash.length; len++) {
    const candidate = hash.slice(0, len);
    if (!exists.get(candidate)) return candidate;
  }
  return hash;
}

const MEDIA_DOWNLOADABLE = new Set(['image', 'document', 'audio']);

export function upsertMessages(db: Db, inputs: MessageInput[]): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  const find = db.prepare('SELECT 1 FROM messages WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO messages (id, short_id, chat_id, ts, author_id, author_name, from_me, type, body, stanza, quoted_stanza,
       is_system, is_edited, is_deleted, is_forwarded, media_kind, media_status, media_mime, media_filename, media_size,
       duration, transcription_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE messages SET type = ?, body = ?, author_name = COALESCE(?, author_name), is_edited = ?, is_deleted = ?,
       is_forwarded = ?, is_system = ?, media_mime = COALESCE(?, media_mime), media_filename = COALESCE(?, media_filename),
       media_size = COALESCE(?, media_size), duration = COALESCE(?, duration) WHERE id = ?`,
  );
  tx(db, () => {
    for (const m of inputs) {
      if (find.get(m.id)) {
        update.run(
          m.type, m.body, m.author_name, +m.is_edited, +m.is_deleted, +m.is_forwarded, +m.is_system,
          m.media_mime, m.media_filename, m.media_size, m.duration, m.id,
        );
        updated++;
      } else {
        const mediaStatus = m.media_kind ? (MEDIA_DOWNLOADABLE.has(m.media_kind) ? 'pending' : 'skipped') : null;
        insert.run(
          m.id, assignShortId(db, m.id), m.chat_id, m.ts, m.author_id, m.author_name, +m.from_me, m.type, m.body,
          m.stanza, m.quoted_stanza, +m.is_system, +m.is_edited, +m.is_deleted, +m.is_forwarded, m.media_kind,
          mediaStatus, m.media_mime, m.media_filename, m.media_size, m.duration,
          m.media_kind === 'audio' ? 'pending' : null,
        );
        inserted++;
      }
      reindexMessage(db, m.id);
    }
  });
  return { inserted, updated };
}

export function messagesInRange(db: Db, chatId: string, from: number, to: number, includeSystem = false): MessageRow[] {
  const sql = `${SELECT_MSG} WHERE m.chat_id = ? AND m.ts BETWEEN ? AND ? ${includeSystem ? '' : 'AND m.is_system = 0'}
    ORDER BY m.ts, m.rowid`;
  return db.prepare(sql).all(chatId, from, to) as unknown as MessageRow[];
}

export function getMessageById(db: Db, id: string): MessageRow | undefined {
  return db.prepare(`${SELECT_MSG} WHERE m.id = ?`).get(id) as unknown as MessageRow | undefined;
}

export function getMessageByShortId(db: Db, shortId: string): MessageRow[] {
  const clean = shortId.replace(/^m:/i, '').toLowerCase();
  return db.prepare(`${SELECT_MSG} WHERE m.short_id = ?`).all(clean) as unknown as MessageRow[];
}

/** Mensagens citadas (por `stanza`) — usado para resolver `↳m:xxxx` mesmo fora do período exibido. */
export function resolveStanzas(db: Db, chatId: string, stanzas: string[]): Map<string, MessageRow> {
  const map = new Map<string, MessageRow>();
  const stmt = db.prepare(`${SELECT_MSG} WHERE m.chat_id = ? AND m.stanza = ? LIMIT 1`);
  for (const s of new Set(stanzas)) {
    const row = stmt.get(chatId, s) as unknown as MessageRow | undefined;
    if (row) map.set(s, row);
  }
  return map;
}

export function messagesAround(db: Db, target: MessageRow, before: number, after: number): MessageRow[] {
  const prev = db
    .prepare(
      `${SELECT_MSG} WHERE m.chat_id = ? AND m.is_system = 0 AND (m.ts < ? OR (m.ts = ? AND m.rowid < (SELECT rowid FROM messages WHERE id = ?)))
       ORDER BY m.ts DESC, m.rowid DESC LIMIT ?`,
    )
    .all(target.chat_id, target.ts, target.ts, target.id, before) as unknown as MessageRow[];
  const next = db
    .prepare(
      `${SELECT_MSG} WHERE m.chat_id = ? AND m.is_system = 0 AND (m.ts > ? OR (m.ts = ? AND m.rowid > (SELECT rowid FROM messages WHERE id = ?)))
       ORDER BY m.ts, m.rowid LIMIT ?`,
    )
    .all(target.chat_id, target.ts, target.ts, target.id, after) as unknown as MessageRow[];
  return [...prev.reverse(), target, ...next];
}

// ---------------------------------------------------------------- mídia

export interface MediaUpdate {
  status: 'downloaded' | 'failed' | 'skipped';
  path?: string | null;
  mime?: string | null;
  filename?: string | null;
  size?: number | null;
}

export function setMedia(db: Db, id: string, u: MediaUpdate): void {
  db.prepare(
    `UPDATE messages SET media_status = ?, media_path = COALESCE(?, media_path), media_mime = COALESCE(?, media_mime),
       media_filename = COALESCE(?, media_filename), media_size = COALESCE(?, media_size) WHERE id = ?`,
  ).run(u.status, u.path ?? null, u.mime ?? null, u.filename ?? null, u.size ?? null, id);
  reindexMessage(db, id);
}

export function pendingMedia(db: Db, chatId: string, from: number, to: number): MessageRow[] {
  return db
    .prepare(`${SELECT_MSG} WHERE m.chat_id = ? AND m.ts BETWEEN ? AND ? AND m.media_status = 'pending' ORDER BY m.ts`)
    .all(chatId, from, to) as unknown as MessageRow[];
}

export interface TranscriptionUpdate {
  status: 'done' | 'empty' | 'failed';
  text?: string | null;
  model?: string | null;
}

export function setTranscription(db: Db, id: string, u: TranscriptionUpdate): void {
  db.prepare('UPDATE messages SET transcription_status = ?, transcription = ?, transcription_model = ? WHERE id = ?').run(
    u.status, u.text ?? null, u.model ?? null, id,
  );
  reindexMessage(db, id);
}

export function pendingTranscriptions(db: Db, opts: { chatId?: string; from?: number; to?: number } = {}): MessageRow[] {
  const where = [`m.media_kind = 'audio'`, `m.media_status = 'downloaded'`, `m.transcription_status = 'pending'`];
  const args: Array<string | number> = [];
  if (opts.chatId) { where.push('m.chat_id = ?'); args.push(opts.chatId); }
  if (opts.from !== undefined) { where.push('m.ts >= ?'); args.push(opts.from); }
  if (opts.to !== undefined) { where.push('m.ts <= ?'); args.push(opts.to); }
  return db.prepare(`${SELECT_MSG} WHERE ${where.join(' AND ')} ORDER BY m.ts`).all(...args) as unknown as MessageRow[];
}

// ------------------------------------------------------------ cobertura

export function getCoverage(db: Db, chatId: string): Interval[] {
  const rows = db.prepare('SELECT from_ts, to_ts FROM coverage WHERE chat_id = ? ORDER BY from_ts').all(chatId) as Array<{
    from_ts: number;
    to_ts: number;
  }>;
  return rows.map((r) => ({ from: r.from_ts, to: r.to_ts }));
}

export function addCoverage(db: Db, chatId: string, interval: Interval): void {
  const merged = mergeIntervals([...getCoverage(db, chatId), interval]);
  tx(db, () => {
    db.prepare('DELETE FROM coverage WHERE chat_id = ?').run(chatId);
    const ins = db.prepare('INSERT INTO coverage (chat_id, from_ts, to_ts) VALUES (?, ?, ?)');
    for (const i of merged) ins.run(chatId, i.from, i.to);
  });
}

export function lastCovered(db: Db, chatId: string): number | null {
  const row = db.prepare('SELECT MAX(to_ts) AS t FROM coverage WHERE chat_id = ?').get(chatId) as { t: number | null };
  return row.t;
}

export function clearCoverage(db: Db, chatId: string): void {
  db.prepare('DELETE FROM coverage WHERE chat_id = ?').run(chatId);
}

export function logSync(db: Db, chatId: string, range: Interval, count: number, mode: string): void {
  db.prepare('INSERT INTO sync_log (chat_id, synced_at, from_ts, to_ts, message_count, mode) VALUES (?, ?, ?, ?, ?, ?)').run(
    chatId, Math.floor(Date.now() / 1000), range.from, range.to, count, mode,
  );
}

export function lastSync(db: Db, chatId: string): { synced_at: number; from_ts: number; to_ts: number; message_count: number; mode: string } | undefined {
  return db.prepare('SELECT * FROM sync_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1').get(chatId) as never;
}

// ---------------------------------------------------------------- busca

/** Converte texto livre em consulta FTS5 segura: cada termo vira prefixo (`"termo"*`). */
export function buildFtsQuery(text: string, any = false): string {
  const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map((t) => `"${t}"*`).join(any ? ' OR ' : ' ');
}

export interface SearchOptions {
  chatId?: string;
  from?: number;
  to?: number;
  limit?: number;
  any?: boolean;
}

export function searchMessages(db: Db, text: string, opts: SearchOptions = {}): MessageRow[] {
  const q = buildFtsQuery(text, opts.any);
  if (!q) return [];
  const where = ['messages_fts MATCH ?'];
  const args: Array<string | number> = [q];
  if (opts.chatId) { where.push('m.chat_id = ?'); args.push(opts.chatId); }
  if (opts.from !== undefined) { where.push('m.ts >= ?'); args.push(opts.from); }
  if (opts.to !== undefined) { where.push('m.ts <= ?'); args.push(opts.to); }
  args.push(opts.limit ?? 20);
  const rows = db
    .prepare(
      `SELECT m.*, ${NAME_SQL} AS display_name FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
       LEFT JOIN contacts c ON c.id = m.author_id WHERE ${where.join(' AND ')} ORDER BY f.rank LIMIT ?`,
    )
    .all(...args) as unknown as MessageRow[];
  return rows.sort((a, b) => a.ts - b.ts);
}

// ---------------------------------------------------------------- stats

export interface ChatStats {
  total: number;
  firstTs: number | null;
  lastTs: number | null;
  byAuthor: Array<{ name: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  byDay: Array<{ day: string; count: number }>;
  audio: { total: number; transcribed: number; pending: number; notDownloaded: number };
  media: { pending: number; failed: number };
}

export function chatStats(db: Db, chatId: string, from?: number, to?: number, dayOf: (ts: number) => string = (ts) => new Date(ts * 1000).toISOString().slice(0, 10)): ChatStats {
  const range = ['m.chat_id = ?', 'm.is_system = 0'];
  const args: Array<string | number> = [chatId];
  if (from !== undefined) { range.push('m.ts >= ?'); args.push(from); }
  if (to !== undefined) { range.push('m.ts <= ?'); args.push(to); }
  const where = range.join(' AND ');

  const head = db.prepare(`SELECT COUNT(*) AS n, MIN(m.ts) AS a, MAX(m.ts) AS b FROM messages m WHERE ${where}`).get(...args) as {
    n: number; a: number | null; b: number | null;
  };
  const byAuthor = db
    .prepare(
      `SELECT COALESCE(${NAME_SQL}, '(desconhecido)') AS name, COUNT(*) AS count FROM messages m
       LEFT JOIN contacts c ON c.id = m.author_id WHERE ${where} GROUP BY m.author_id ORDER BY count DESC`,
    )
    .all(...args) as Array<{ name: string; count: number }>;
  const byType = db
    .prepare(`SELECT m.type AS type, COUNT(*) AS count FROM messages m WHERE ${where} GROUP BY m.type ORDER BY count DESC`)
    .all(...args) as Array<{ type: string; count: number }>;
  const days = new Map<string, number>();
  for (const r of db.prepare(`SELECT m.ts AS ts FROM messages m WHERE ${where}`).all(...args) as Array<{ ts: number }>) {
    const d = dayOf(r.ts);
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  const byDay = [...days.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));
  const audio = db
    .prepare(
      `SELECT COUNT(*) AS total,
         SUM(CASE WHEN m.transcription_status IN ('done', 'empty') THEN 1 ELSE 0 END) AS transcribed,
         SUM(CASE WHEN m.transcription_status = 'pending' AND m.media_status = 'downloaded' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN m.media_status != 'downloaded' THEN 1 ELSE 0 END) AS notDownloaded
       FROM messages m WHERE ${where} AND m.media_kind = 'audio'`,
    )
    .get(...args) as { total: number; transcribed: number | null; pending: number | null; notDownloaded: number | null };
  const media = db
    .prepare(
      `SELECT SUM(CASE WHEN m.media_status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN m.media_status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM messages m WHERE ${where} AND m.media_kind IN ('image', 'document', 'audio')`,
    )
    .get(...args) as { pending: number | null; failed: number | null };

  return {
    total: head.n,
    firstTs: head.a,
    lastTs: head.b,
    byAuthor,
    byType,
    byDay,
    audio: {
      total: audio.total,
      transcribed: audio.transcribed ?? 0,
      pending: audio.pending ?? 0,
      notDownloaded: audio.notDownloaded ?? 0,
    },
    media: { pending: media.pending ?? 0, failed: media.failed ?? 0 },
  };
}

// ---------------------------------------------------------------- limpeza

export function deleteChatData(db: Db, chatId: string): { messages: number } {
  return tx(db, () => {
    const rows = db.prepare('SELECT rowid AS rid FROM messages WHERE chat_id = ?').all(chatId) as Array<{ rid: number }>;
    const delFts = db.prepare('DELETE FROM messages_fts WHERE rowid = ?');
    for (const r of rows) delFts.run(r.rid);
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
    db.prepare('DELETE FROM coverage WHERE chat_id = ?').run(chatId);
    db.prepare('DELETE FROM sync_log WHERE chat_id = ?').run(chatId);
    db.prepare('UPDATE chats SET history_start_ts = NULL WHERE id = ?').run(chatId);
    return { messages: rows.length };
  });
}
