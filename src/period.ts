import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { CliError, EXIT } from './errors.ts';
import type { Interval } from './cache/coverage.ts';

dayjs.extend(utc);
dayjs.extend(timezone);

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const BR = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Converte `2026-10-01`, `2026-10-01 14:30` ou `01/10/2026` (no fuso `tz`) em segundos unix. */
export function parseInstant(input: string, tz: string, endOfDay = false): number {
  const text = input.trim();
  let y: string, mo: string, d: string, hh: string | undefined, mi: string | undefined, ss: string | undefined;
  const iso = ISO.exec(text);
  const br = BR.exec(text);
  if (iso) [, y, mo, d, hh, mi, ss] = iso;
  else if (br) [, d, mo, y, hh, mi, ss] = br;
  else throw new CliError(EXIT.USAGE, `Data inválida: "${input}". Use AAAA-MM-DD, "AAAA-MM-DD HH:mm" ou DD/MM/AAAA.`);

  const hasTime = hh !== undefined;
  const time = hasTime ? `${hh}:${mi}:${ss ?? (endOfDay ? '59' : '00')}` : endOfDay ? '23:59:59' : '00:00:00';
  const parsed = dayjs.tz(`${y}-${mo}-${d} ${time}`, tz);
  if (!parsed.isValid()) throw new CliError(EXIT.USAGE, `Data inválida: "${input}".`);
  return parsed.unix();
}

const UNIT_SECONDS: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800 };

/** `90m`, `12h`, `7d`, `2w` → segundos. */
export function parseDuration(input: string): number {
  const m = /^(\d+)\s*([mhdw])$/i.exec(input.trim());
  if (!m) throw new CliError(EXIT.USAGE, `Duração inválida: "${input}". Use algo como 90m, 12h, 7d ou 2w.`);
  return Number(m[1]) * UNIT_SECONDS[m[2].toLowerCase()];
}

export interface PeriodArgs {
  from?: string;
  to?: string;
  last?: string;
}

/** Devolve o período pedido ou `null` quando nenhum argumento foi informado (modo delta). */
export function resolvePeriod(args: PeriodArgs, tz: string, now: number): Interval | null {
  if (args.last) {
    if (args.from || args.to) throw new CliError(EXIT.USAGE, 'Use --last OU --from/--to, não os dois.');
    return { from: now - parseDuration(args.last), to: now };
  }
  if (!args.from && !args.to) return null;
  if (!args.from) throw new CliError(EXIT.USAGE, '--to exige --from.');
  const from = parseInstant(args.from, tz);
  const to = args.to ? Math.min(parseInstant(args.to, tz, true), now) : now;
  if (from > to) throw new CliError(EXIT.USAGE, '--from é posterior a --to.');
  return { from, to };
}
