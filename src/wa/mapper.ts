import type { MessageInput } from '../cache/repo.ts';

/** Tipos do WhatsApp que são eventos do sistema, não conversa. */
const SYSTEM_TYPES = new Set([
  'e2e_notification',
  'notification',
  'notification_template',
  'gp2',
  'call_log',
  'protocol',
  'ciphertext',
  'broadcast_notification',
  'group_notification',
  'oversized',
  'unknown',
]);

const MEDIA_KINDS: Record<string, string> = {
  image: 'image',
  video: 'video',
  ptt: 'audio',
  audio: 'audio',
  document: 'document',
  sticker: 'sticker',
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Texto para tipos que não têm `body` legível. */
function describe(msg: any): string | null {
  switch (msg.type) {
    case 'location':
      return msg.location ? `[localização ${msg.location.latitude}, ${msg.location.longitude}${msg.location.description ? ` — ${msg.location.description}` : ''}]` : '[localização]';
    case 'vcard':
    case 'multi_vcard':
      return `[contato] ${str(msg.body) ?? ''}`.trim();
    case 'poll_creation': {
      const options = Array.isArray(msg.pollOptions) ? msg.pollOptions.map((o: any) => o?.name ?? o).join(' | ') : '';
      return `[enquete] ${msg.pollName ?? ''}${options ? ` — ${options}` : ''}`.trim();
    }
    default:
      return null;
  }
}

/**
 * Converte um `Message` do whatsapp-web.js em linha para o cache.
 * Recebe o objeto "cru" (any) de propósito: facilita testar com fakes.
 */
export function mapMessage(msg: any, chatId: string, myId: string | null): MessageInput {
  const data = msg._data ?? {};
  const fromMe = Boolean(msg.fromMe);
  const authorId: string | null = fromMe ? myId : (str(msg.author) ?? str(msg.from));
  const type = String(msg.type ?? 'unknown');
  const mediaKind = MEDIA_KINDS[type] ?? null;
  const isMedia = mediaKind !== null;

  const text = isMedia ? str(msg.body) : (describe(msg) ?? str(msg.body));

  return {
    id: String(msg.id?._serialized),
    chat_id: chatId,
    ts: Number(msg.timestamp),
    author_id: authorId,
    author_name: str(data.notifyName),
    from_me: fromMe,
    type,
    body: type === 'revoked' ? null : text,
    stanza: str(msg.id?.id),
    quoted_stanza: msg.hasQuotedMsg ? str(data.quotedStanzaID) : null,
    is_system: SYSTEM_TYPES.has(type),
    is_edited: Boolean(data.latestEditMsgKey || data.latestEditSenderTimestampMs),
    is_deleted: type === 'revoked',
    is_forwarded: Boolean(msg.isForwarded),
    media_kind: mediaKind,
    media_mime: isMedia ? str(data.mimetype) : null,
    media_filename: isMedia ? str(data.filename) : null,
    media_size: isMedia ? num(data.size) : null,
    duration: isMedia ? num(msg.duration ?? data.duration) : null,
  };
}
