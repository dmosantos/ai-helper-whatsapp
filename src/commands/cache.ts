import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allChats, chatStats, deleteChatData, getCoverage, lastSync } from '../cache/repo.ts';
import { paths } from '../config.ts';
import { CliError, EXIT } from '../errors.ts';
import { ymdhm } from '../fmt.ts';
import { openApp, resolveChat } from './shared.ts';

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export async function cacheStatusCommand(opts: { chat?: string }): Promise<void> {
  const app = openApp(true);
  const { db, cfg } = app;
  const tz = cfg.timezone;
  const chats = opts.chat ? [await resolveChat(app, opts.chat)] : allChats(db);

  const lines = [`# cache em ${paths.data} | banco: ${mb(existsSync(paths.db) ? statSync(paths.db).size : 0)} | mídia: ${mb(dirSize(paths.media))}`];
  for (const c of chats) {
    const s = chatStats(db, c.id);
    if (s.total === 0 && !opts.chat) continue;
    const cov = getCoverage(db, c.id);
    const sync = lastSync(db, c.id);
    lines.push(
      `${c.name ?? c.id} [${c.id}] msgs=${s.total} cobertura=${cov.length ? cov.map((i) => `${ymdhm(i.from, tz)}→${ymdhm(i.to, tz)}`).join(' ; ') : '-'} áudios_pendentes=${s.audio.pending} mídias_pendentes=${s.media.pending} última_sync=${sync ? ymdhm(sync.synced_at, tz) : '-'}`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

export async function cacheClearCommand(opts: { chat?: string; keepMedia?: boolean }): Promise<void> {
  if (!opts.chat) throw new CliError(EXIT.USAGE, 'Informe --chat <nome|id> para limpar o cache de um chat.');
  const app = openApp(true);
  const chat = await resolveChat(app, opts.chat);

  const files = app.db
    .prepare('SELECT DISTINCT media_path AS p FROM messages WHERE chat_id = ? AND media_path IS NOT NULL')
    .all(chat.id) as Array<{ p: string }>;
  const { messages } = deleteChatData(app.db, chat.id);

  let removed = 0;
  if (!opts.keepMedia) {
    const dirs = new Set<string>();
    for (const { p } of files) {
      if (existsSync(p)) {
        rmSync(p, { force: true });
        removed++;
      }
      dirs.add(dirname(p));
    }
    for (const d of dirs) {
      if (existsSync(d) && readdirSync(d).length === 0) rmSync(d, { recursive: true, force: true });
    }
  }
  process.stdout.write(`cache limpo para "${chat.name ?? chat.id}": ${messages} mensagens, ${removed} arquivos de mídia removidos\n`);
}
