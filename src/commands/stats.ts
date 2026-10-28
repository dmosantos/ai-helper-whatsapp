import { getCoverage, getChat, chatStats, lastSync } from '../cache/repo.ts';
import { ymd, ymdhm } from '../fmt.ts';
import { resolvePeriod } from '../period.ts';
import { openApp, resolveChat } from './shared.ts';

export interface StatsOptions {
  chat: string;
  from?: string;
  to?: string;
  last?: string;
  format?: string;
}

/** Visão geral de um chat no cache: volume, autores, cobertura e pendências. */
export async function statsCommand(opts: StatsOptions): Promise<void> {
  const app = openApp(true);
  const { db, cfg } = app;
  const tz = cfg.timezone;
  const now = Math.floor(Date.now() / 1000);
  const chat = await resolveChat(app, opts.chat);
  const period = resolvePeriod({ from: opts.from, to: opts.to, last: opts.last }, tz, now);
  const s = chatStats(db, chat.id, period?.from, period?.to, (ts) => ymd(ts, tz));
  const coverage = getCoverage(db, chat.id);
  const sync = lastSync(db, chat.id);
  const fresh = getChat(db, chat.id) ?? chat;

  if (opts.format === 'json') {
    process.stdout.write(`${JSON.stringify({ chat: fresh, period, stats: s, coverage, lastSync: sync ?? null }, null, 2)}\n`);
    return;
  }

  const out: string[] = [
    `# chat: ${fresh.name ?? fresh.id} (${fresh.is_group ? 'grupo' : 'pessoa'}, ${fresh.id})`,
    period ? `# período: ${ymdhm(period.from, tz)} → ${ymdhm(period.to, tz)}` : '# período: todo o cache',
    `mensagens: ${s.total}${s.firstTs ? ` (de ${ymdhm(s.firstTs, tz)} a ${ymdhm(s.lastTs as number, tz)})` : ''}`,
    `tipos: ${s.byType.map((t) => `${t.type}=${t.count}`).join(', ') || '-'}`,
    `autores: ${s.byAuthor.map((a) => `${a.name} (${a.count})`).join(', ') || '-'}`,
    `dias mais ativos: ${[...s.byDay].sort((a, b) => b.count - a.count).slice(0, 5).map((d) => `${d.day} (${d.count})`).join(', ') || '-'}`,
    `áudios: ${s.audio.total} (${s.audio.transcribed} transcritos, ${s.audio.pending} pendentes de transcrição, ${s.audio.notDownloaded} não baixados)`,
    `mídias: ${s.media.pending} pendentes, ${s.media.failed} indisponíveis`,
    `cobertura: ${coverage.length ? coverage.map((c) => `${ymdhm(c.from, tz)} → ${ymdhm(c.to, tz)}`).join(' ; ') : 'nenhuma (chat nunca sincronizado)'}`,
    `histórico disponível a partir de: ${fresh.history_start_ts ? ymdhm(fresh.history_start_ts, tz) : 'sem limite conhecido'}`,
    `última sincronização: ${sync ? `${ymdhm(sync.synced_at, tz)} (${sync.message_count} mensagens, ${sync.mode})` : 'nunca'}`,
  ];
  process.stdout.write(`${out.join('\n')}\n`);
}
