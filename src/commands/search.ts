import { allChats, searchMessages } from '../cache/repo.ts';
import { CliError, EXIT } from '../errors.ts';
import { resolvePeriod } from '../period.ts';
import { openApp, parseFormat, renderRows, resolveChat } from './shared.ts';
import type { RenderMeta } from '../output/render.ts';

export interface SearchOptions {
  query: string;
  chat?: string;
  from?: string;
  to?: string;
  last?: string;
  limit?: string;
  any?: boolean;
  format?: string;
}

/** Busca textual (FTS5) no cache local. Nunca abre o WhatsApp. */
export async function searchCommand(opts: SearchOptions): Promise<void> {
  const app = openApp(true);
  const { db, cfg } = app;
  const now = Math.floor(Date.now() / 1000);
  const period = resolvePeriod({ from: opts.from, to: opts.to, last: opts.last }, cfg.timezone, now);
  const chat = opts.chat ? await resolveChat(app, opts.chat) : undefined;
  const limit = opts.limit ? Number(opts.limit) : 20;
  if (!Number.isInteger(limit) || limit <= 0) throw new CliError(EXIT.USAGE, '--limit inválido.');

  const rows = searchMessages(db, opts.query, { chatId: chat?.id, from: period?.from, to: period?.to, limit, any: opts.any });
  const format = parseFormat(opts.format);

  const names = new Map(allChats(db).map((c) => [c.id, c.name ?? c.id]));
  const meta: RenderMeta = {
    chat: chat ?? { id: '(todos os chats em cache)', name: 'todos os chats em cache', is_group: 0 },
    from: rows[0]?.ts ?? now,
    to: rows[rows.length - 1]?.ts ?? now,
    tz: cfg.timezone,
    mode: `busca "${opts.query}"${opts.any ? ' (qualquer termo)' : ''}`,
    coverage: 'n/a',
    kind: 'search',
    warnings: rows.length >= limit ? [`resultado limitado a ${limit}; refine a busca ou use --limit`] : [],
  };
  const content = renderRows(db, rows, meta, format, { showChat: chat ? undefined : names, showDate: true });
  process.stdout.write(content);
}
