import { ymdhm } from '../fmt.ts';
import type { MessageRow } from '../cache/repo.ts';
import { contentOf, sid, type RenderMeta, type RenderOptions } from './render.ts';

export function renderJson(rows: MessageRow[], meta: RenderMeta, opts: RenderOptions = {}): string {
  const byStanza = new Map(rows.filter((r) => r.stanza).map((r) => [r.stanza as string, r]));
  const messages = rows.map((r) => {
    const quoted = r.quoted_stanza ? (opts.quoted?.get(r.quoted_stanza) ?? byStanza.get(r.quoted_stanza)) : undefined;
    return {
      id: r.id,
      ref: sid(r),
      ts: r.ts,
      datetime: ymdhm(r.ts, meta.tz),
      author: r.display_name,
      author_id: r.author_id,
      from_me: Boolean(r.from_me),
      type: r.type,
      text: contentOf(r, opts),
      body: r.body,
      reply_to: quoted ? sid(quoted) : null,
      flags: {
        edited: Boolean(r.is_edited),
        deleted: Boolean(r.is_deleted),
        forwarded: Boolean(r.is_forwarded),
        system: Boolean(r.is_system),
      },
      media: r.media_kind
        ? {
            kind: r.media_kind,
            status: r.media_status,
            path: r.media_path,
            mime: r.media_mime,
            filename: r.media_filename,
            size: r.media_size,
            duration: r.duration,
          }
        : null,
      transcription: r.transcription,
    };
  });
  return `${JSON.stringify({ meta: { ...meta, count: rows.length }, messages }, null, 2)}\n`;
}
