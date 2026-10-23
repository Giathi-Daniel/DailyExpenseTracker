import { daysInMonth, fromParts, type ISODate } from './dates';
import type { TxKind } from './schema';

/**
 * Turns pasted M-Pesa confirmation SMS messages into draft transactions so users
 * never type the same payment twice. Parsing is local and pure: the text is never
 * stored, phone numbers are stripped, and the transaction code de-duplicates imports.
 */

export interface ParsedMessage {
  ref: string;
  kind: TxKind;
  /** Minor units (cents). */
  amount: number;
  date: ISODate;
  categoryId: string;
  note: string;
  /** Transaction cost charged on top, in minor units. */
  fee: number;
}

export interface ParseResult {
  entries: ParsedMessage[];
  /** Messages that looked like M-Pesa confirmations but could not be read. */
  skipped: number;
}

const KSH = String.raw`Ksh\s?([\d,]+(?:\.\d{1,2})?)`;
const CODE = /\b([A-Z0-9]{10})\s+confirmed/gi;

const MERCHANT_RULES: Array<[RegExp, string]> = [
  [/kplc|power|electric|water|nairobi water|zuku|safaricom home|faiba|wifi|internet/i, 'exp-utilities'],
  [/naivas|carrefour|quickmart|quick mart|chandarana|magunas|cleanshelf|tuskys|supermarket|grocer|mama mboga|butcher|market/i, 'exp-food'],
  [/kfc|java|artcaffe|chicken inn|pizza|restaurant|cafe|hotel|bar\b|lounge|glovo|uber eats|bolt food/i, 'exp-dining'],
  [/uber|bolt|little cab|matatu|sacco|fuel|petrol|shell|total|rubis|ola energy|parking|sgr|railway/i, 'exp-transport'],
  [/hospital|clinic|pharma|chemist|medical|nhif|sha\b|dental/i, 'exp-health'],
  [/school|college|university|fees|helb|academy/i, 'exp-education'],
  [/netflix|showmax|spotify|dstv|gotv|startimes|youtube|apple|google/i, 'exp-subs'],
  [/fuliza|m-shwari|kcb m-pesa|tala|branch|zenka|okash|loan/i, 'exp-debt'],
  [/sacco savings|mmf|money market|cic|sanlam|britam|etica|lofty|ziidi|investment/i, 'exp-savings'],
  [/rent|apartment|estate|housing|landlord/i, 'exp-rent'],
  [/salon|barber|spa\b|beauty/i, 'exp-care'],
];

export function categoriseMerchant(name: string, fallback = 'exp-other'): string {
  for (const [re, id] of MERCHANT_RULES) if (re.test(name)) return id;
  return fallback;
}

function toMinor(raw: string): number {
  const [whole = '0', frac = ''] = raw.replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

function cleanName(raw: string): string {
  return raw
    .replace(/\b(?:\+?254|0)?7\d{8}\b|\b(?:\+?254|0)?1\d{8}\b/g, '') // phone numbers
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s-]+$/, '')
    .trim()
    .slice(0, 80);
}

function parseDate(text: string): ISODate | null {
  const m = /\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return fromParts(y, mo, d);
}

function parseOne(ref: string, body: string): ParsedMessage | null {
  const date = parseDate(body);
  if (!date) return null;
  const feeMatch = new RegExp(String.raw`Transaction cost,?\s*${KSH}`, 'i').exec(body);
  const fee = feeMatch?.[1] ? toMinor(feeMatch[1]) : 0;
  const base = { ref, date, fee };

  let m = new RegExp(String.raw`received\s+${KSH}\s+from\s+(.+?)\s+on\s+\d`, 'i').exec(body);
  if (m?.[1] && m[2]) {
    const from = cleanName(m[2]);
    return { ...base, kind: 'income', amount: toMinor(m[1]), categoryId: 'inc-other', note: `From ${from}`, fee: 0 };
  }
  m = new RegExp(String.raw`${KSH}\s+paid to\s+(.+?)\.?\s+on\s+\d`, 'i').exec(body);
  if (m?.[1] && m[2]) {
    const to = cleanName(m[2]);
    return { ...base, kind: 'expense', amount: toMinor(m[1]), categoryId: categoriseMerchant(to), note: to };
  }
  m = new RegExp(String.raw`${KSH}\s+sent to\s+(.+?)\s+for account\s+(\S+?)\s+on\s+\d`, 'i').exec(body);
  if (m?.[1] && m[2]) {
    const to = cleanName(m[2]);
    return { ...base, kind: 'expense', amount: toMinor(m[1]), categoryId: categoriseMerchant(to), note: to };
  }
  m = new RegExp(String.raw`${KSH}\s+sent to\s+(.+?)\s+on\s+\d`, 'i').exec(body);
  if (m?.[1] && m[2]) {
    const to = cleanName(m[2]);
    return { ...base, kind: 'expense', amount: toMinor(m[1]), categoryId: categoriseMerchant(to), note: `To ${to}` };
  }
  m = new RegExp(String.raw`Withdraw\s+${KSH}\s+from\s+(.+?)\s+New`, 'i').exec(body);
  if (m?.[1]) {
    return { ...base, kind: 'expense', amount: toMinor(m[1]), categoryId: 'exp-other', note: 'Cash withdrawal' };
  }
  m = new RegExp(String.raw`bought\s+${KSH}\s+of airtime`, 'i').exec(body);
  if (m?.[1]) {
    return { ...base, kind: 'expense', amount: toMinor(m[1]), categoryId: 'exp-airtime', note: 'Airtime' };
  }
  return null;
}

/** Hard cap so a huge paste cannot freeze the tab. */
const MAX_INPUT = 200_000;

export function parseMpesa(input: string): ParseResult {
  const text = input.slice(0, MAX_INPUT);
  const starts: Array<{ ref: string; index: number }> = [];
  for (const match of text.matchAll(CODE)) {
    if (match[1] && match.index !== undefined) starts.push({ ref: match[1].toUpperCase(), index: match.index });
  }
  const entries: ParsedMessage[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  starts.forEach((start, i) => {
    const body = text.slice(start.index, starts[i + 1]?.index ?? text.length);
    if (seen.has(start.ref)) return;
    seen.add(start.ref);
    const parsed = parseOne(start.ref, body);
    if (parsed && parsed.amount > 0) entries.push(parsed);
    else skipped += 1;
  });
  return { entries, skipped };
}
