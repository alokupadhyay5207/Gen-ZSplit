/**
 * Fixed messages that can be requested through a `?notice=<code>` query string.
 * Only whitelisted codes map to text, so a crafted link can't inject arbitrary copy.
 * (Server Components can't set cookies, so redirects made while rendering use these.)
 */
export type NoticeKind = "success" | "error" | "info";

export const NOTICES: Record<string, { kind: NoticeKind; message: string }> = {
  "expense-not-found": { kind: "error", message: "Expense not found." },
  "group-not-found": { kind: "error", message: "We couldn't find that group." },
};
