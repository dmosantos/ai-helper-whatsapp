import { allChats, type ChatRow } from '../cache/repo.ts';
import { normalize, ymdhm } from '../fmt.ts';
import { refreshChats } from '../wa/fetcher.ts';
import { openApp } from './shared.ts';

export interface ChatsOptions {
  search?: string;
  live?: boolean;
  limit?: string;
  offline?: boolean;
}

export async function chatsCommand(opts: ChatsOptions): Promise<void> {
  const app = openApp(Boolean(opts.offline));
  try {
    let chats = allChats(app.db);
    if ((opts.live || chats.length === 0) && !app.offline) {
      await refreshChats(app.db, await app.session.get());
      chats = allChats(app.db);
    }
    if (opts.search) {
      const q = normalize(opts.search);
      chats = chats.filter((c: ChatRow) => normalize(c.name ?? '').includes(q) || c.id.includes(opts.search as string));
    }
    const limit = opts.limit ? Number(opts.limit) : 50;
    const shown = chats.slice(0, limit);
    const lines = shown.map(
      (c) => `${c.id}\t${c.name ?? '(sem nome)'}\t${c.is_group ? 'grupo' : 'pessoa'}\t${c.last_ts ? ymdhm(c.last_ts, app.cfg.timezone) : '-'}`,
    );
    process.stdout.write(`# id\tnome\ttipo\tultima-atividade (${shown.length} de ${chats.length})\n${lines.join('\n')}\n`);
  } finally {
    await app.session.close();
  }
}
