const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(ts: number, tz: string): Record<string, string> {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ts * 1000))) out[p.type] = p.value;
  return out;
}

const EN_WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** `2026-10-03` */
export function ymd(ts: number, tz: string): string {
  const p = parts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `09:14` */
export function hm(ts: number, tz: string): string {
  const p = parts(ts, tz);
  return `${p.hour}:${p.minute}`;
}

/** `sex` */
export function weekday(ts: number, tz: string): string {
  return WEEKDAYS[EN_WEEKDAY[parts(ts, tz).weekday] ?? 0];
}

/** `2026-10-03 09:14` */
export function ymdhm(ts: number, tz: string): string {
  return `${ymd(ts, tz)} ${hm(ts, tz)}`;
}

/** `0:42`, `1:05:09` */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'chat'
  );
}

export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
