/**
 * Money is stored as integers in the currency's minor unit (e.g. cents) so
 * sums never drift the way floating point does (0.1 + 0.2 !== 0.3).
 */

const fractionCache = new Map<string, number>();

export function fractionDigits(currency: string): number {
  let digits = fractionCache.get(currency);
  if (digits === undefined) {
    try {
      digits =
        new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
          .maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    fractionCache.set(currency, digits);
  }
  return digits;
}

/**
 * Parse user input such as "1,250.50" or "1250" into minor units.
 * Works on the string, never through a float multiply. Returns null when invalid.
 */
export function parseAmount(input: string, currency: string): number | null {
  const digits = fractionDigits(currency);
  const cleaned = input.trim().replace(/[\s,_]/g, '').replace(/^[A-Za-z$€£¥]+/, '');
  const match = /^(\d{1,15})(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const frac = match[2] ?? '';
  if (frac.length > digits) return null;
  const minor = Number(whole + frac.padEnd(digits, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return minor;
}

/** Minor units -> plain decimal string for inputs ("1250.5" -> "1250.50"). */
export function toInputValue(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  if (digits === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor).toString().padStart(digits + 1, '0');
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

type Style = 'full' | 'whole' | 'compact';

function formatter(currency: string, style: Style): Intl.NumberFormat {
  const key = `${currency}|${style}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      ...(style === 'compact'
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : style === 'whole'
          ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
          : { minimumFractionDigits: fractionDigits(currency) }),
    });
    formatters.set(key, f);
  }
  return f;
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** fractionDigits(currency);
}

export function formatMoney(minor: number, currency: string, opts: { compact?: boolean; whole?: boolean } = {}): string {
  const style: Style = opts.compact ? 'compact' : opts.whole ? 'whole' : 'full';
  return formatter(currency, style).format(toMajor(minor, currency));
}

export function formatPct(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export const CURRENCIES = [
  'KES', 'UGX', 'TZS', 'RWF', 'ETB', 'NGN', 'GHS', 'ZAR', 'EGP',
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'AED', 'JPY', 'CNY',
] as const;
