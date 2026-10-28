/** Intervalo fechado em segundos unix: contém `from` e `to`. */
export interface Interval {
  from: number;
  to: number;
}

/** Ordena e funde intervalos sobrepostos ou adjacentes (`b.from <= a.to + 1`). */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.from <= i.to).map((i) => ({ ...i })).sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.from <= last.to + 1) last.to = Math.max(last.to, cur.to);
    else out.push(cur);
  }
  return out;
}

/** Partes de `range` que NÃO estão cobertas por `covered`. */
export function subtractIntervals(range: Interval, covered: Interval[]): Interval[] {
  const gaps: Interval[] = [];
  let cursor = range.from;
  for (const c of mergeIntervals(covered)) {
    if (c.to < cursor) continue;
    if (c.from > range.to) break;
    if (c.from > cursor) gaps.push({ from: cursor, to: Math.min(c.from - 1, range.to) });
    cursor = Math.max(cursor, c.to + 1);
    if (cursor > range.to) break;
  }
  if (cursor <= range.to) gaps.push({ from: cursor, to: range.to });
  return gaps;
}

export interface DeltaPlan {
  range: Interval;
  /** Houve mais de `maxDays` desde a última sincronização, então ficou um buraco. */
  truncated: boolean;
  /** Trecho que ficou sem cobertura por causa do limite de dias. */
  skipped: Interval | null;
  /** Primeira sincronização deste chat. */
  firstSync: boolean;
}

/**
 * Modo delta: da última cobertura até agora, limitado a `maxDays`.
 * `lastCovered` é o fim da cobertura mais recente do chat (ou null se nunca sincronizou).
 */
export function computeDelta(lastCovered: number | null, now: number, maxDays: number): DeltaPlan {
  const limit = now - Math.round(maxDays * 86400);
  if (lastCovered === null) {
    return { range: { from: limit, to: now }, truncated: false, skipped: null, firstSync: true };
  }
  if (lastCovered + 1 >= limit) {
    return { range: { from: Math.min(lastCovered + 1, now), to: now }, truncated: false, skipped: null, firstSync: false };
  }
  return {
    range: { from: limit, to: now },
    truncated: true,
    skipped: { from: lastCovered + 1, to: limit - 1 },
    firstSync: false,
  };
}
