/**
 * Calendar dates are plain "YYYY-MM-DD" strings in the user's local calendar.
 * All arithmetic goes through UTC so daylight-saving shifts can never move a day.
 */

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function fromParts(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(date: ISODate): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return { y, m, d };
}

function toUTC(date: ISODate): Date {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt: Date): ISODate {
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function today(now: Date = new Date()): ISODate {
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(date: ISODate, n: number): ISODate {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: ISODate, n: number, anchorDay?: number): ISODate {
  const { y, m, d } = parts(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fromParts(ny, nm, Math.min(anchorDay ?? d, daysInMonth(ny, nm)));
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: ISODate): number {
  return toUTC(date).getUTCDay();
}

export function startOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return fromParts(y, m, 1);
}

export function endOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return fromParts(y, m, daysInMonth(y, m));
}

export function startOfQuarter(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return fromParts(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
}

export function endOfQuarter(date: ISODate): ISODate {
  return endOfMonth(addMonths(startOfQuarter(date), 2));
}

export function startOfYear(date: ISODate): ISODate {
  return fromParts(parts(date).y, 1, 1);
}

export function endOfYear(date: ISODate): ISODate {
  return fromParts(parts(date).y, 12, 31);
}

export function startOfWeek(date: ISODate, weekStartsOn: 0 | 1): ISODate {
  const offset = (weekday(date) - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function isWeekend(date: ISODate): boolean {
  const w = weekday(date);
  return w === 0 || w === 6;
}

export function formatDate(date: ISODate, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const { y, m, d } = parts(date);
  const dt = new Date(y, m - 1, d);
  const opts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: 'short' }
      : style === 'long'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
  return dt.toLocaleDateString(undefined, opts);
}

export function formatMonth(date: ISODate, style: 'short' | 'long' = 'long'): string {
  const { y, m } = parts(date);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: style,
    year: style === 'long' ? 'numeric' : '2-digit',
  });
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
