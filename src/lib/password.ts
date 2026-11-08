/**
 * Werkzeug-compatible password hashing.
 *
 * The Flask app stored hashes produced by werkzeug.security.generate_password_hash
 * ("scrypt:32768:8:1$<salt>$<hex>" on Werkzeug >= 3, "pbkdf2:sha256:600000$<salt>$<hex>"
 * on older versions). Every existing user and group password in Supabase therefore
 * keeps working, and hashes created by this app can still be verified by the old
 * Flask app if you ever need to roll back.
 */
import { createHash, pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function makeSalt(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += SALT_CHARS[bytes[i] % SALT_CHARS.length];
  return out;
}

function scryptHex(password: string, salt: string, n: number, r: number, p: number): string {
  // Werkzeug passes maxmem = 132 * n * r * p to hashlib.scrypt.
  return scryptSync(password, salt, 64, {
    N: n,
    r,
    p,
    maxmem: 132 * n * r * p,
  }).toString("hex");
}

export function hashPassword(password: string): string {
  const salt = makeSalt();
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}$${salt}$${scryptHex(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)}`;
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyPassword(stored: string | null | undefined, password: string): boolean {
  if (!stored || typeof password !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [method, salt, expected] = parts;
  try {
    if (method.startsWith("scrypt:")) {
      const [, n, r, p] = method.split(":");
      const N = Number(n);
      const R = Number(r);
      const P = Number(p);
      if (![N, R, P].every((v) => Number.isInteger(v) && v > 0)) return false;
      return safeEqualHex(scryptHex(password, salt, N, R, P), expected);
    }
    if (method.startsWith("pbkdf2:")) {
      const [, algo, iterations] = method.split(":");
      const iters = Number(iterations);
      if (!Number.isInteger(iters) || iters <= 0) return false;
      const keylen = createHash(algo).digest().length; // Werkzeug uses the digest size
      const digest = pbkdf2Sync(password, salt, iters, keylen, algo);
      return safeEqualHex(digest.toString("hex"), expected);
    }
  } catch {
    return false;
  }
  return false;
}
