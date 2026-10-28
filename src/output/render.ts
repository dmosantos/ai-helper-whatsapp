import { duration, hm, weekday, ymd, ymdhm } from '../fmt.ts';
import type { MessageRow } from '../cache/repo.ts';

export interface RenderMeta {
  chat: { id: string; name: string | null; is_group: number };
  from: number;
  to: number;
  tz: string;
  /** Rótulo livre: "período", "delta desde 2026-10-20 10:00"... */
  mode: string;
  coverage: 'completa' | 'parcial' | 'n/a';
  /** `search`: cabeçalho enxuto e sem títulos por dia. */
  kind?: 'chat' | 'search';
  warnings: string[];
}

export interface RenderOptions {
  /** `llm`: compacto e estável; `md`: com negrito e títulos Markdown. */
  style?: 'llm' | 'md';
  /** Mensagens citadas que não estão no conjunto exibido (stanza → linha). */
  quoted?: Map<string, MessageRow>;
  /** `numero → nome` para resolver menções. */
  mentions?: Map<string, string>;
  /** Marca uma mensagem como alvo (usado por `context`). */
  highlightId?: string;
  /** Inclui o nome do chat em cada linha (busca em vários chats). */
  showChat?: Map<string, string>;
  /** Inclui a data em cada linha (quando não há títulos por dia). */
  showDate?: boolean;
}

export function sid(row: Pick<MessageRow, 'short_id'>): string {
  return `m:${row.short_id}`;
}

function resolveMentions(text: string, mentions?: Map<string, string>): string {
  if (!mentions || mentions.size === 0) return text;
  return text.replace(/@(\d{8,15})\b/g, (all, num: string) => {
    const name = mentions.get(num);
    return name ? `@${name}` : all;
  });
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Conteúdo da mensagem (depois do "Autor:"), já com marcadores de mídia. */
export function contentOf(row: MessageRow, opts: RenderOptions = {}): string {
  const body = row.body ? resolveMentions(row.body, opts.mentions) : '';
  if (row.is_deleted) return '[mensagem apagada]';

  switch (row.media_kind) {
    case 'audio': {
      const dur = row.duration ? `🎤${duration(row.duration)}` : '🎤';
      if (row.transcription_status === 'done') return `${dur} "${(row.transcription ?? '').trim()}"`;
      if (row.transcription_status === 'empty') return `${dur} [sem fala detectada]`;
      if (row.media_status === 'failed') return `${dur} [áudio indisponível]`;
      if (row.media_status !== 'downloaded') return `${dur} [áudio não baixado]`;
      const why = row.transcription_status === 'failed' ? 'falha ao transcrever' : 'não transcrito';
      return `${dur} [${why}] ${row.media_path}`;
    }
    case 'image': {
      const cap = body ? ` "${body}"` : '';
      return row.media_path ? `🖼${cap} → ${row.media_path}` : `🖼${cap} [imagem não baixada]`;
    }
    case 'document': {
      const name = row.media_filename ?? 'documento';
      const cap = body ? ` "${body}"` : '';
      return row.media_path ? `📎 ${name}${cap} → ${row.media_path}` : `📎 ${name}${cap} [não baixado]`;
    }
    case 'video':
      return `🎞 [vídeo${row.duration ? ` ${duration(row.duration)}` : ''}]${body ? ` "${body}"` : ''}`;
    case 'sticker':
      return '[sticker]';
    default:
      return body || `[${row.type}]`;
  }
}

function replyTag(row: MessageRow, shown: Set<string>, opts: RenderOptions): string {
  if (!row.quoted_stanza) return '';
  const target = opts.quoted?.get(row.quoted_stanza);
  if (!target) return ' ↳(mensagem anterior não disponível)';
  if (shown.has(target.id)) return ` ↳${sid(target)}`;
  const snippet = oneLine(contentOf(target, opts), 50);
  return ` ↳${sid(target)} ("${snippet}")`;
}

export function renderLine(row: MessageRow, shown: Set<string>, opts: RenderOptions, tz: string): string {
  const md = opts.style === 'md';
  const who = row.display_name ?? row.author_id ?? '(desconhecido)';
  const name = md ? `**${who}**` : who;
  const flags = [
    row.from_me ? '(eu)' : '',
    row.is_forwarded ? '[encaminhada]' : '',
    row.is_edited ? '[editada]' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const mark = opts.highlightId === row.id ? '▶' : '';
  const chat = opts.showChat?.get(row.chat_id);
  const where = chat ? ` {${chat}}` : '';
  const date = opts.showDate ? `${ymd(row.ts, tz)} ` : '';
  const content = contentOf(row, opts).replace(/\n/g, '\n    ');
  return `${mark}[${sid(row)}] ${date}${hm(row.ts, tz)}${where} ${name}${flags ? ` ${flags}` : ''}${replyTag(row, shown, opts)}: ${content}`;
}

export function renderHeader(rows: MessageRow[], meta: RenderMeta): string[] {
  if (meta.kind === 'search') {
    return [
      `# ${meta.mode} | escopo: ${meta.chat.name ?? meta.chat.id} | resultados: ${rows.length}`,
      `# avisos: ${meta.warnings.length ? meta.warnings.join(' | ') : 'nenhum'}`,
    ];
  }
  const kind = (k: string) => rows.filter((r) => r.media_kind === k).length;
  const audios = rows.filter((r) => r.media_kind === 'audio');
  const transcribed = audios.filter((r) => r.transcription_status === 'done' || r.transcription_status === 'empty').length;

  const authors = new Map<string, number>();
  for (const r of rows) {
    const n = (r.display_name ?? '(desconhecido)') + (r.from_me ? ' (eu)' : '');
    authors.set(n, (authors.get(n) ?? 0) + 1);
  }
  const top = [...authors.entries()].sort((a, b) => b[1] - a[1]);
  const authorText = top
    .slice(0, 15)
    .map(([n, c]) => `${n} (${c})`)
    .join(', ');

  const lines = [
    `# chat: ${meta.chat.name ?? meta.chat.id} (${meta.chat.is_group ? 'grupo' : 'pessoa'}, ${meta.chat.id})`,
    `# período: ${ymdhm(meta.from, meta.tz)} → ${ymdhm(meta.to, meta.tz)} (${meta.tz}) | modo: ${meta.mode}`,
    `# cobertura: ${meta.coverage} | msgs: ${rows.length} | áudios: ${audios.length} (${transcribed} transcritos) | imagens: ${kind('image')} | documentos: ${kind('document')}`,
    `# autores: ${authorText || '(nenhum)'}${top.length > 15 ? `, +${top.length - 15}` : ''}`,
    `# avisos: ${meta.warnings.length ? meta.warnings.join(' | ') : 'nenhum'}`,
  ];
  return lines;
}

export function renderLlm(rows: MessageRow[], meta: RenderMeta, opts: RenderOptions = {}): string {
  const md = opts.style === 'md';
  const shown = new Set(rows.map((r) => r.id));
  const out = renderHeader(rows, meta);
  let day = '';
  for (const row of rows) {
    const d = ymd(row.ts, meta.tz);
    if (meta.kind !== 'search' && d !== day) {
      day = d;
      out.push('', `${md ? '### ' : '## '}${d} (${weekday(row.ts, meta.tz)})`);
    }
    out.push(renderLine(row, shown, opts, meta.tz));
  }
  if (rows.length === 0) out.push('', '(nenhuma mensagem no período)');
  return `${out.join('\n')}\n`;
}
