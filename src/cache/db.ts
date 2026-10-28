import { DatabaseSync } from 'node:sqlite';
import { ensureDir, paths } from '../config.ts';

export type Db = DatabaseSync;

const SCHEMA_V1 = `
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  last_ts INTEGER,
  history_start_ts INTEGER,
  updated_at INTEGER
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT,
  pushname TEXT,
  number TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  author_id TEXT,
  author_name TEXT,
  from_me INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  body TEXT,
  stanza TEXT,
  quoted_stanza TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_edited INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  is_forwarded INTEGER NOT NULL DEFAULT 0,
  media_kind TEXT,
  media_status TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_filename TEXT,
  media_size INTEGER,
  duration INTEGER,
  transcription TEXT,
  transcription_status TEXT,
  transcription_model TEXT
);
CREATE INDEX idx_messages_chat_ts ON messages(chat_id, ts);
CREATE UNIQUE INDEX idx_messages_short ON messages(short_id);
CREATE INDEX idx_messages_stanza ON messages(chat_id, stanza);

CREATE TABLE coverage (
  chat_id TEXT NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  PRIMARY KEY (chat_id, from_ts)
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  mode TEXT NOT NULL
);

CREATE VIRTUAL TABLE messages_fts USING fts5(text, tokenize = 'unicode61 remove_diacritics 2');
`;

const MIGRATIONS: string[] = [SCHEMA_V1];

export function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function openDb(file: string = paths.db): Db {
  if (file !== ':memory:') ensureDir(paths.data);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** Executa `fn` dentro de uma transação. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
