/**
 * Cookie sessions: a signed (HS256) JWT in an HttpOnly cookie, the Next.js
 * equivalent of Flask's signed `session` cookie. Cookies can only be written from
 * Server Actions and Route Handlers; Server Components may only read them.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";

export interface SessionData {
  uid?: number;
  name?: string;
  email?: string;
  /** Password-reset flow state (set before the user is logged in). */
  resetEmail?: string;
  otpVerified?: boolean;
}

export interface AuthedUser {
  uid: number;
  name: string;
  email: string;
}

const COOKIE = "gz_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const IS_PROD = process.env.NODE_ENV === "production";

function secretKey(): Uint8Array {
  const secret = process.env.SECRET_KEY;
  if (!secret) {
    if (IS_PROD) throw new Error("SECRET_KEY must be set in production.");
    return new TextEncoder().encode("dev-only-insecure-secret-do-not-use-in-production");
  }
  return new TextEncoder().encode(secret);
}

export async function getSession(): Promise<SessionData> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return {};
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return {
      uid: typeof payload.uid === "number" ? payload.uid : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      resetEmail: typeof payload.resetEmail === "string" ? payload.resetEmail : undefined,
      otpVerified: payload.otpVerified === true ? true : undefined,
    };
  } catch {
    return {};
  }
}

async function writeSession(data: SessionData): Promise<void> {
  const claims: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) claims[k] = v;
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PROD,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Replace the whole session (like `session.clear()` followed by setting keys). Actions/route handlers only. */
export async function setSession(data: SessionData): Promise<void> {
  await writeSession(data);
}

/** Merge keys into the session; pass `undefined` to drop a key. Actions/route handlers only. */
export async function updateSession(patch: SessionData): Promise<void> {
  await writeSession({ ...(await getSession()), ...patch });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Resolve the logged-in user or redirect to /login. Call from every page, action and route handler. */
export async function requireUser(): Promise<AuthedUser> {
  const s = await getSession();
  if (typeof s.uid !== "number") redirect("/login");
  return { uid: s.uid, name: s.name ?? "", email: s.email ?? "" };
}
