/**
 * Pure money maths for group splitting: no framework, no database.
 *
 * All amounts are **integer minor units** (paise, cents). Every splitting
 * function guarantees sum(shares) === total exactly (see tests/money.test.ts).
 * Port of groupsplit/money.py.
 */
import { MoneyError } from "./errors.ts";

// currency -> [display prefix, decimal places]
export const CURRENCIES: Record<string, readonly [string, number]> = {
  INR: ["\u20b9", 2],
  USD: ["$", 2],
  EUR: ["\u20ac", 2],
  GBP: ["\u00a3", 2],
  AED: ["AED\u00a0", 2],
  JPY: ["\u00a5", 0],
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);
/** Symbol shown in the UI (trimmed, like the Flask `CURRENCY_SYMBOLS` global). */
export const CURRENCY_SYMBOLS: Record<string, string> = Object.fromEntries(
  Object.entries(CURRENCIES).map(([code, [sym]]) => [code, sym.trim()]),
);
export const CURRENCY_EXPONENT: Record<string, number> = Object.fromEntries(
  Object.entries(CURRENCIES).map(([code, [, exp]]) => [code, exp]),
);

const MAX_MAJOR_UNITS = 10_000_000n; // 1 crore: a sanity ceiling, not a business rule

export function exponent(currency: string): number {
  return (CURRENCIES[currency] ?? CURRENCIES.INR)[1];
}

// ----------------------------------------------------------------- parsing
const NUMBER = /^[0-9]+(\.[0-9]+)?$/;

interface Parsed {
  whole: bigint;
  frac: string; // digits after the point, trailing zeros removed
}

/**
 * Strict plain-decimal parse: digits with an optional fraction. No exponents
 * ('1e999999'), no NaN/Infinity, no signs, no whitespace tricks.
 */
function cleanNumber(raw: string | null | undefined, label: string): Parsed {
  const text = (raw ?? "").replace(/,/g, "").trim();
  if (!text) throw new MoneyError(`${label} is required.`);
  if (text.startsWith("-")) throw new MoneyError(`${label} cannot be negative.`);
  if (!NUMBER.test(text) || text.length > 20) throw new MoneyError(`${label} must be a number.`);
  const [w, f = ""] = text.split(".");
  return { whole: BigInt(w), frac: f.replace(/0+$/, "") };
}

/** '1,250.50' -> 125050 (minor units). */
export function parseAmount(
  raw: string | null | undefined,
  currency = "INR",
  opts: { label?: string; allowZero?: boolean } = {},
): number {
  const label = opts.label ?? "Amount";
  const { whole, frac } = cleanNumber(raw, label);
  const exp = exponent(currency);
  if (frac.length > exp) {
    const places = exp === 0 ? "whole numbers only" : `at most ${exp} decimal places`;
    throw new MoneyError(`${label} allows ${places}.`);
  }
  if (whole === 0n && frac === "" && !opts.allowZero) {
    throw new MoneyError(`${label} must be greater than zero.`);
  }
  if (whole > MAX_MAJOR_UNITS || (whole === MAX_MAJOR_UNITS && frac !== "")) {
    throw new MoneyError(`${label} is too large.`);
  }
  const minorFrac = frac.padEnd(exp, "0");
  return Number(whole) * 10 ** exp + (exp ? Number(minorFrac) : 0);
}

/** '33.33' -> 3333 basis points (1% = 100 bp). Max 2 decimals. */
export function parsePercentBp(raw: string | null | undefined, label: string): number {
  const { whole, frac } = cleanNumber(raw, label);
  if (whole > 100n || (whole === 100n && frac !== "")) {
    throw new MoneyError(`${label} cannot be more than 100%.`);
  }
  if (frac.length > 2) throw new MoneyError(`${label} allows at most 2 decimal places.`);
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

// -------------------------------------------------------------- formatting
function groupDigits(digits: string, indian: boolean): string {
  if (digits.length <= 3) return digits;
  if (!indian) {
    const out: string[] = [];
    while (digits) {
      out.push(digits.slice(-3));
      digits = digits.slice(0, -3);
    }
    return out.reverse().join(",");
  }
  let head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const parts: string[] = [];
  while (head) {
    parts.push(head.slice(-2));
    head = head.slice(0, -2);
  }
  return parts.reverse().join(",") + "," + tail;
}

/** 125050 -> '₹1,250.50' (Indian digit grouping for INR). */
export function formatAmount(minor: number, currency = "INR", signed = false): string {
  const [symbol, exp] = CURRENCIES[currency] ?? CURRENCIES.INR;
  const sign = minor < 0 ? "-" : signed && minor > 0 ? "+" : "";
  const mag = Math.abs(Math.trunc(minor));
  const base = 10 ** exp;
  const whole = exp ? Math.floor(mag / base) : mag;
  const frac = exp ? mag % base : 0;
  let body = groupDigits(String(whole), currency === "INR");
  if (exp) body += "." + String(frac).padStart(exp, "0");
  return `${sign}${symbol}${body}`;
}

/** Plain machine value for <input value=...> (no symbol, no commas). */
export function toInputValue(minor: number, currency: string): string {
  const exp = exponent(currency);
  if (!exp) return String(minor);
  const base = 10 ** exp;
  return `${Math.floor(minor / base)}.${String(minor % base).padStart(exp, "0")}`;
}

// --------------------------------------------------------------- splitting
/**
 * Equal split. The indivisible remainder (always < n minor units) is handed out
 * one unit at a time starting at `offset`, so the same person does not absorb
 * every stray paisa across many expenses.
 */
export function splitEqual(total: number, userIds: number[], offset = 0): Map<number, number> {
  const n = userIds.length;
  if (n === 0) throw new MoneyError("Select at least one person to split with.");
  const ordered = [...userIds].sort((a, b) => a - b);
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const shares = new Map<number, number>(ordered.map((id) => [id, base]));
  for (let i = 0; i < remainder; i++) {
    const id = ordered[(offset + i) % n];
    shares.set(id, (shares.get(id) ?? 0) + 1);
  }
  return shares;
}

function sumOf(values: Iterable<number>): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function splitExact(total: number, amounts: Map<number, number>, currency = "INR"): Map<number, number> {
  const diff = total - sumOf(amounts.values());
  if (diff) {
    const how = diff > 0 ? "short of" : "over";
    throw new MoneyError(
      `Amounts are ${formatAmount(Math.abs(diff), currency)} ${how} the total ` +
        `${formatAmount(total, currency)}. They must add up exactly.`,
    );
  }
  return new Map(amounts);
}

/**
 * Largest-remainder apportionment: floor every share, then give the leftover
 * units to the people with the biggest fractional remainders.
 */
export function splitPercent(total: number, bps: Map<number, number>): Map<number, number> {
  const got = sumOf(bps.values());
  if (got !== 10000) {
    const shown = Number((got / 100).toPrecision(6)); // like Python's {:g}
    throw new MoneyError(`Percentages add up to ${shown}%. They must total exactly 100%.`);
  }
  const floors = new Map<number, number>();
  const rems: Array<[number, number]> = [];
  for (const uid of [...bps.keys()].sort((a, b) => a - b)) {
    const numer = total * (bps.get(uid) as number);
    const rem = numer % 10000;
    floors.set(uid, (numer - rem) / 10000);
    rems.push([-rem, uid]);
  }
  const leftover = total - sumOf(floors.values());
  rems.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // biggest remainder first, user id breaks ties
  for (const [, uid] of rems.slice(0, leftover)) {
    floors.set(uid, (floors.get(uid) as number) + 1);
  }
  return floors;
}

// ------------------------------------------------------ debt simplification
export type Transfer = [from: number, to: number, amount: number];

/**
 * Greedy min-cash-flow. nets[uid] > 0 means the group owes uid.
 * Returns [from, to, amount] triples using at most n-1 transfers.
 */
export function simplifyDebts(nets: Map<number, number>): Transfer[] {
  const creditors: Array<[number, number]> = [];
  const debtors: Array<[number, number]> = [];
  for (const [uid, amount] of nets) {
    if (amount > 0) creditors.push([amount, uid]);
    else if (amount < 0) debtors.push([-amount, uid]);
  }
  const order = (a: [number, number], b: [number, number]) => b[0] - a[0] || a[1] - b[1];
  creditors.sort(order);
  debtors.sort(order);
  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i][0], creditors[j][0]);
    if (pay > 0) transfers.push([debtors[i][1], creditors[j][1], pay]);
    debtors[i][0] -= pay;
    creditors[j][0] -= pay;
    if (debtors[i][0] === 0) i++;
    if (creditors[j][0] === 0) j++;
  }
  return transfers;
}
