/**
 * One-shot "flash" messages for the personal-expense and auth pages (the equivalent
 * of Flask's flash()). A server action calls flash("...") then redirect(); the
 * destination page reads the cookie while rendering and the browser clears it.
 * The cookie carries only message text, so it is intentionally readable by JS.
 */
import "server-only";
import { cookies } from "next/headers";
import { NOTICES } from "./notices";

export const FLASH_COOKIE = "gz_flash";
const MAX_MESSAGES = 5;

function decode(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

/** Queue a message for the next page render. Server actions / route handlers only. */
export async function flash(message: string): Promise<void> {
  const store = await cookies();
  const list = [...decode(store.get(FLASH_COOKIE)?.value), message].slice(-MAX_MESSAGES);
  store.set(FLASH_COOKIE, Buffer.from(JSON.stringify(list), "utf8").toString("base64url"), {
    path: "/",
    maxAge: 120,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}

/** Read queued messages (plus an optional whitelisted ?notice= code). Safe in Server Components. */
export async function readFlash(noticeCode?: string): Promise<string[]> {
  const list = decode((await cookies()).get(FLASH_COOKIE)?.value);
  const notice = noticeCode ? NOTICES[noticeCode] : undefined;
  if (notice) list.push(notice.message);
  return list;
}
