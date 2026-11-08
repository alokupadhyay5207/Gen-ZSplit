// Port of tests/test_money.py: property tests (shares always sum to the total)
// plus parsing / formatting checks. Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAmount,
  parseAmount,
  parsePercentBp,
  simplifyDebts,
  splitEqual,
  splitExact,
  splitPercent,
  toInputValue,
} from "../src/lib/money.ts";
import { GroupError } from "../src/lib/errors.ts";

// Small deterministic PRNG (mulberry32) so failures are reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int };
}
const sum = (vals: Iterable<number>) => [...vals].reduce((a, b) => a + b, 0);

test("equal split always sums and is fair", () => {
  const r = rng(20261011);
  for (let i = 0; i < 5000; i++) {
    const total = r.int(1, 1e9);
    const n = r.int(1, 40);
    const ids = new Set<number>();
    while (ids.size < n) ids.add(r.int(1, 499));
    const shares = splitEqual(total, [...ids], r.int(0, 99));
    assert.equal(sum(shares.values()), total);
    assert.ok(Math.max(...shares.values()) - Math.min(...shares.values()) <= 1);
    assert.deepEqual([...shares.keys()].sort((a, b) => a - b), [...ids].sort((a, b) => a - b));
  }
});

test("equal split remainder rotates", () => {
  const ids = [1, 2, 3];
  const extras = [0, 1, 2].map((k) => {
    const s = splitEqual(100, ids, k);
    return [...s.entries()].find(([, v]) => v === 34)![0];
  });
  assert.deepEqual(extras.sort(), [1, 2, 3]);
});

test("percentage split always sums and is within one unit of exact", () => {
  const r = rng(7);
  for (let i = 0; i < 5000; i++) {
    const n = r.int(1, 12);
    const cuts = Array.from({ length: n - 1 }, () => r.int(0, 10000)).sort((a, b) => a - b);
    const edges = [0, ...cuts, 10000];
    const bps = new Map<number, number>();
    for (let k = 0; k < n; k++) bps.set(k + 1, edges[k + 1] - edges[k]);
    const total = r.int(1, 1e9);
    const shares = splitPercent(total, bps);
    assert.equal(sum(shares.values()), total);
    for (const [uid, bp] of bps) {
      assert.ok(Math.abs((shares.get(uid) as number) - (total * bp) / 10000) <= 1);
    }
  }
});

test("percentage: one third each", () => {
  const shares = splitPercent(10000, new Map([[1, 3333], [2, 3333], [3, 3334]]));
  assert.equal(sum(shares.values()), 10000);
});

test("percentage must total 100", () => {
  assert.throws(() => splitPercent(10000, new Map([[1, 5000], [2, 4999]])), (e: unknown) => {
    assert.ok(e instanceof GroupError);
    assert.match((e as Error).message, /99\.99%/);
    return true;
  });
});

test("exact mismatch message is human", () => {
  assert.throws(() => splitExact(10000, new Map([[1, 3000], [2, 6000]]), "INR"), (e: unknown) => {
    assert.match((e as Error).message, /₹10\.00 short of the total ₹100\.00/);
    return true;
  });
});

test("simplify settles everyone to zero in at most n-1 transfers", () => {
  const r = rng(99);
  for (let i = 0; i < 3000; i++) {
    const n = r.int(2, 15);
    const vals = Array.from({ length: n - 1 }, () => r.int(-1e6, 1e6));
    vals.push(-sum(vals));
    const nets = new Map(vals.map((v, k) => [k + 1, v] as [number, number]));
    const transfers = simplifyDebts(nets);
    assert.ok(transfers.length <= n - 1);
    const after = new Map(nets);
    for (const [f, t, a] of transfers) {
      assert.ok(a > 0);
      after.set(f, (after.get(f) as number) + a);
      after.set(t, (after.get(t) as number) - a);
    }
    assert.ok([...after.values()].every((v) => v === 0));
  }
});

test("parsing: good values", () => {
  assert.equal(parseAmount("1,250.50"), 125050);
  assert.equal(parseAmount(" 12 "), 1200);
  assert.equal(parseAmount("500", "JPY"), 500);
  assert.equal(parseAmount("0", "INR", { allowZero: true }), 0);
  assert.equal(parsePercentBp("33.33", "P"), 3333);
  assert.equal(parseAmount("10.500"), 1050); // trailing zeros are fine
});

test("parsing: hostile values are rejected with a GroupError", () => {
  const bad = ["", "abc", "NaN", "Infinity", "-5", "0", "0.001", "1e999999", "1e3", "10000001",
    "99999999999999999999999", "1.2.3", "--1", "1 2", "٣"];
  for (const b of bad) {
    assert.throws(() => parseAmount(b), GroupError, `should reject ${JSON.stringify(b)}`);
  }
});

test("JPY has no decimals", () => {
  assert.throws(() => parseAmount("10.5", "JPY"), GroupError);
});

test("percent bounds", () => {
  for (const b of ["", "-1", "100.01", "1.234", "x"]) {
    assert.throws(() => parsePercentBp(b, "P"), GroupError, `should reject ${JSON.stringify(b)}`);
  }
});

test("formatting: Indian grouping", () => {
  assert.equal(formatAmount(12505000, "INR"), "₹1,25,050.00");
  assert.equal(formatAmount(99999999, "INR"), "₹9,99,999.99");
  assert.equal(formatAmount(100, "INR"), "₹1.00");
  assert.equal(formatAmount(0, "INR"), "₹0.00");
});

test("formatting: western grouping and signs", () => {
  assert.equal(formatAmount(123456789, "USD"), "$1,234,567.89");
  assert.equal(formatAmount(-100, "USD"), "-$1.00");
  assert.equal(formatAmount(100, "USD", true), "+$1.00");
  assert.equal(formatAmount(500, "JPY"), "¥500");
});

test("round trip parse(toInputValue(x)) === x", () => {
  for (const minor of [1, 99, 100, 123456, 1e9]) {
    assert.equal(parseAmount(toInputValue(minor, "INR")), minor);
  }
});
