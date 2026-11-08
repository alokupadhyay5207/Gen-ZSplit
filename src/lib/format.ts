/** Display helpers shared by server and client components (port of groupsplit/filters.py). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = Array.from(parts[0])[0] ?? "?";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Stable colour for an avatar / group glyph, kept inside the brand's
 * blue -> indigo -> violet -> magenta band so every hue sits in the palette.
 */
export function hue(seed: string): number {
  let total = 0;
  Array.from(seed || "?").forEach((ch, i) => {
    total += (ch.codePointAt(0) as number) * (i + 3);
  });
  return 205 + (total % 130);
}

/** '2026-10-11 09:30:00' (UTC) -> '5 min ago' / '3 h ago' / '12 Oct'. */
export function ago(stamp: string | null | undefined, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(stamp ?? "");
  if (!m) return stamp ?? "";
  const then = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  const secs = (now.getTime() - then.getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 7 * 86400) return `${Math.floor(secs / 86400)} d ago`;
  return `${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]}`;
}

/** '2026-10-11' -> '11 Oct' (adds the year when it isn't the current one). */
export function shortDate(iso: string | null | undefined, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return iso ?? "";
  const [year, month, day] = [+m[1], +m[2], +m[3]];
  const label = `${day} ${MONTHS[month - 1] ?? ""}`;
  return year === now.getUTCFullYear() ? label : `${label} ${year}`;
}

export function displayInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export const CATEGORY_HUE: Record<string, number> = {
  Food: 28,
  Travel: 205,
  Hotel: 265,
  Shopping: 320,
  Utilities: 170,
  Entertainment: 295,
  Other: 240,
};

export const FEED_ICON: Record<string, string> = {
  expense_added: "receipt",
  expense_deleted: "trash",
  settlement: "check",
  member_joined: "user-plus",
  member_added: "user-plus",
  member_left: "logout",
  member_removed: "logout",
  group_created: "sparkle",
};

export const SPLIT_LABEL: Record<string, string> = {
  equal: "equally",
  exact: "by amount",
  percentage: "by percent",
};
