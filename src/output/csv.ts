import { ymdhm } from '../fmt.ts';
import type { MessageRow } from '../cache/repo.ts';
import { contentOf, sid, type RenderMeta, type RenderOptions } from './render.ts';

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderCsv(rows: MessageRow[], meta: RenderMeta, opts: RenderOptions = {}): string {
  const header = ['ref', 'datetime', 'author', 'from_me', 'type', 'text', 'reply_to', 'media_path', 'transcription'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const quoted = r.quoted_stanza ? opts.quoted?.get(r.quoted_stanza) : undefined;
    lines.push(
      [
        sid(r),
        ymdhm(r.ts, meta.tz),
        r.display_name,
        r.from_me ? 1 : 0,
        r.type,
        contentOf(r, opts),
        quoted ? sid(quoted) : '',
        r.media_path,
        r.transcription,
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
