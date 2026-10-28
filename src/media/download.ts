import { writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Db } from '../cache/db.ts';
import { getChat, setMedia, type MessageRow } from '../cache/repo.ts';
import { ensureDir, loadConfig, paths } from '../config.ts';
import { slugify } from '../fmt.ts';
import { log } from '../log.ts';
import type { WaClient } from '../wa/client.ts';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/msword': '.doc',
  'application/vnd.ms-excel': '.xls',
};

export function extensionFor(mime: string | null, filename: string | null): string {
  const fromName = filename ? extname(filename) : '';
  if (fromName) return fromName.toLowerCase();
  const base = (mime ?? '').split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? '.bin';
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
}

export function chatMediaDir(chatId: string, chatName: string | null): string {
  const tail = chatId.split('@')[0].slice(-6);
  return ensureDir(join(paths.media, `${slugify(chatName ?? chatId)}-${tail}`));
}

export interface MediaStats {
  downloaded: number;
  failed: number;
  skipped: number;
}

/** Baixa as mídias pendentes (`rows`) usando o cliente. Idempotente: grava o status no cache. */
export async function downloadPending(db: Db, client: WaClient, rows: MessageRow[]): Promise<MediaStats> {
  const stats: MediaStats = { downloaded: 0, failed: 0, skipped: 0 };
  const maxBytes = loadConfig().maxDocMB * 1024 * 1024;
  let n = 0;

  for (const row of rows) {
    n++;
    if (row.media_kind === 'document' && row.media_size && row.media_size > maxBytes) {
      setMedia(db, row.id, { status: 'skipped' });
      stats.skipped++;
      continue;
    }
    try {
      const msg: any = await client.getMessageById(row.id);
      const media = msg ? await msg.downloadMedia() : null;
      if (!media?.data) {
        setMedia(db, row.id, { status: 'failed' });
        stats.failed++;
        continue;
      }
      const chat = getChat(db, row.chat_id);
      const dir = chatMediaDir(row.chat_id, chat?.name ?? null);
      const filename: string | null = (media.filename as string | undefined) ?? row.media_filename;
      const ext = extensionFor(media.mimetype ?? row.media_mime, filename);
      const file =
        row.media_kind === 'document' && filename
          ? `${row.short_id}_${safeName(filename)}`
          : `${row.short_id}${ext}`;
      const full = join(dir, file);
      const buf = Buffer.from(media.data as string, 'base64');
      writeFileSync(full, buf);
      setMedia(db, row.id, { status: 'downloaded', path: full, mime: media.mimetype ?? null, filename, size: buf.length });
      stats.downloaded++;
    } catch (err) {
      log(`  falha ao baixar mídia ${row.short_id}: ${(err as Error).message}`);
      setMedia(db, row.id, { status: 'failed' });
      stats.failed++;
    }
    if (n % 10 === 0) log(`  mídias: ${n}/${rows.length}`);
  }
  return stats;
}
