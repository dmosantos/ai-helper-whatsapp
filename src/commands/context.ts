import { getChat, getMessageByShortId, messagesAround } from '../cache/repo.ts';
import { CliError, EXIT } from '../errors.ts';
import type { RenderMeta } from '../output/render.ts';
import { openApp, parseFormat, renderRows } from './shared.ts';

export interface ContextOptions {
  id: string;
  before?: string;
  after?: string;
  format?: string;
}

/** Mostra as mensagens ao redor de uma referência `m:xxxx`. Só usa o cache. */
export async function contextCommand(opts: ContextOptions): Promise<void> {
  const { db, cfg } = openApp(true);
  const targets = getMessageByShortId(db, opts.id);
  if (targets.length === 0) throw new CliError(EXIT.GENERAL, `Referência não encontrada no cache: ${opts.id}`);
  if (targets.length > 1) {
    throw new CliError(EXIT.GENERAL, `Referência ambígua ${opts.id}: ${targets.map((t) => `m:${t.short_id}`).join(', ')}`);
  }
  const target = targets[0];
  const before = opts.before ? Number(opts.before) : 10;
  const after = opts.after ? Number(opts.after) : 10;
  const rows = messagesAround(db, target, before, after);
  const chat = getChat(db, target.chat_id) ?? { id: target.chat_id, name: null, is_group: 0 };

  const meta: RenderMeta = {
    chat,
    from: rows[0].ts,
    to: rows[rows.length - 1].ts,
    tz: cfg.timezone,
    mode: `contexto de m:${target.short_id} (${before} antes, ${after} depois)`,
    coverage: 'n/a',
    warnings: [],
  };
  process.stdout.write(renderRows(db, rows, meta, parseFormat(opts.format), { highlightId: target.id }));
}
