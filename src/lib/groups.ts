/**
 * Supabase-backed group expense business logic (port of groupsplit/services.py).
 * All the rules live here; the server actions in src/actions/groups.ts are thin.
 */
import "server-only";
import { randomInt } from "node:crypto";
import {
  countRows,
  deleteRows,
  DuplicateKeyError,
  fetchRows,
  getOne,
  insertRow,
  insertRows,
  updateRows,
  type Row,
} from "./db";
import { GroupError } from "./errors";
import {
  CURRENCIES,
  formatAmount,
  parseAmount,
  parsePercentBp,
  simplifyDebts,
  splitEqual,
  splitExact,
  splitPercent,
} from "./money";
import { hashPassword, verifyPassword } from "./password";
import { isValidDay } from "./personal";

export const CATEGORIES = ["Food", "Travel", "Hotel", "Shopping", "Utilities", "Entertainment", "Other"] as const;
export const SPLIT_METHODS = ["equal", "exact", "percentage"] as const;
export const PAGE_SIZE = 12;

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GROUP_COLUMNS = "id,name,description,invite_code,owner_id,currency,created_at"; // never the password hash

// ------------------------------------------------------------------ types
export interface PublicGroup {
  id: number;
  name: string;
  description: string;
  invite_code: string;
  owner_id: number;
  currency: string;
  created_at: string;
}

export interface Membership {
  group_id: number;
  user_id: number;
  role: "owner" | "member";
  status: "active" | "removed";
  joined_at: string;
  name: string;
  email: string;
}

export interface GroupSummary {
  id: number;
  name: string;
  description: string;
  currency: string;
  role: string;
  member_count: number;
  expense_count: number;
  total_minor: number;
  net_minor: number;
}

export interface MemberRow {
  user_id: number;
  role: "owner" | "member";
  joined_at: string;
  name: string;
  email: string;
}

export interface Balance {
  user_id: number;
  name: string;
  active: boolean;
  paid: number;
  share: number;
  sent: number;
  received: number;
  net: number;
}

export interface TransferRow {
  from_id: number;
  from_name: string;
  to_id: number;
  to_name: string;
  amount: number;
}

export interface ExpenseRow {
  id: number;
  title: string;
  category: string;
  expense_date: string;
  split_method: string;
  amount_minor: number;
  paid_by: number;
  created_by: number;
  payer_name: string;
  split_count: number;
  my_share_minor: number | null;
}

export interface ActivityRow {
  kind: string;
  description: string;
  created_at: string;
}

export interface Actor {
  user_id: number;
  name: string;
  role: "owner" | "member";
}

// ---------------------------------------------------------------- helpers
/** 'YYYY-MM-DD HH:MM:SS' in UTC, the format every created_at column uses. */
function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

const len = (s: string) => Array.from(s).length; // count characters, not UTF-16 units

async function usersById(ids: Iterable<number>, columns = "id,name,email"): Promise<Map<number, Row>> {
  const unique = [...new Set([...ids].map(Number))].sort((a, b) => a - b);
  if (!unique.length) return new Map();
  const rows = await fetchRows("users", { where: { id: unique }, columns });
  return new Map(rows.map((u) => [u.id as number, u]));
}

async function activeMemberNames(groupId: number): Promise<Map<number, string>> {
  const members = await fetchRows("group_members", { where: { group_id: groupId, status: "active" } });
  const users = await usersById(
    members.map((m) => m.user_id),
    "id,name",
  );
  const out = new Map<number, string>();
  for (const m of members) {
    const u = users.get(m.user_id);
    if (u) out.set(m.user_id, u.name);
  }
  return out;
}

export function normalizeInviteCode(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function newInviteCode(): string {
  return Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");
}

/** Write an activity line. Best effort: a failure here must not undo the real action. */
async function logActivity(
  groupId: number,
  actorId: number,
  kind: string,
  text: string,
  expenseId: number | null = null,
): Promise<void> {
  try {
    await insertRow("group_activity", {
      group_id: groupId,
      actor_id: actorId,
      kind,
      description: text,
      expense_id: expenseId,
      created_at: now(),
    });
  } catch (err) {
    console.error("Could not write group activity", err);
  }
}

// ----------------------------------------------------------------- reads
export async function getGroup(groupId: number): Promise<PublicGroup | null> {
  return (await getOne("groups", { id: groupId }, GROUP_COLUMNS)) as PublicGroup | null;
}

export async function getMembership(groupId: number, userId: number): Promise<Membership | null> {
  const [m, u] = await Promise.all([
    getOne("group_members", { group_id: groupId, user_id: userId, status: "active" }),
    getOne("users", { id: userId }, "id,name,email"),
  ]);
  if (!m || !u) return null;
  return { ...m, name: u.name ?? "", email: u.email ?? "" } as Membership;
}

/** Resolve (group, me) for a member. Non-members and missing groups look identical, so ids can't be enumerated. */
export async function getAccess(
  groupId: number,
  userId: number,
): Promise<{ group: PublicGroup; me: Membership } | null> {
  if (!Number.isSafeInteger(groupId) || groupId <= 0) return null;
  const me = await getMembership(groupId, userId);
  if (!me) return null;
  const group = await getGroup(groupId);
  return group ? { group, me } : null;
}

export function actorOf(me: Membership): Actor {
  return { user_id: me.user_id, name: me.name, role: me.role };
}

export async function listUserGroups(userId: number): Promise<GroupSummary[]> {
  const memberships = await fetchRows("group_members", { where: { user_id: userId, status: "active" } });
  if (!memberships.length) return [];
  const gids: number[] = memberships.map((m) => m.group_id);
  const [groupRows, members, expenses, splits, settlements, activity] = await Promise.all([
    fetchRows("groups", { where: { id: gids }, columns: GROUP_COLUMNS }),
    fetchRows("group_members", { where: { group_id: gids, status: "active" } }),
    fetchRows("group_expenses", { where: { group_id: gids, deleted_at: null }, order: [["id", false]] }),
    fetchRows("expense_splits", { where: { group_id: gids }, order: [["id", false]] }),
    fetchRows("settlements", { where: { group_id: gids }, order: [["id", false]] }),
    fetchRows("group_activity", { where: { group_id: gids }, columns: "id,group_id", order: [["id", false]] }),
  ]);
  const groups = new Map(groupRows.map((g) => [g.id as number, g]));
  const result: Array<GroupSummary & { sort: number }> = [];
  for (const m of memberships) {
    const g = groups.get(m.group_id);
    if (!g) continue;
    const gid: number = g.id;
    const gExpenses = expenses.filter((e) => e.group_id === gid);
    const liveIds = new Set<number>(gExpenses.map((e) => e.id));
    const sumBy = (rows: Row[], field: string) => rows.reduce((s, r) => s + (r[field] as number), 0);
    const paid = sumBy(gExpenses.filter((e) => e.paid_by === userId), "amount_minor");
    const share = sumBy(
      splits.filter((s) => s.group_id === gid && s.user_id === userId && liveIds.has(s.expense_id)),
      "share_minor",
    );
    const sent = sumBy(settlements.filter((t) => t.group_id === gid && t.payer_id === userId), "amount_minor");
    const received = sumBy(settlements.filter((t) => t.group_id === gid && t.receiver_id === userId), "amount_minor");
    result.push({
      id: gid,
      name: g.name,
      description: g.description ?? "",
      currency: g.currency ?? "INR",
      role: m.role,
      member_count: members.filter((x) => x.group_id === gid).length,
      expense_count: gExpenses.length,
      total_minor: sumBy(gExpenses, "amount_minor"),
      net_minor: paid - share + sent - received,
      sort: Math.max(0, ...activity.filter((a) => a.group_id === gid).map((a) => a.id as number)),
    });
  }
  result.sort((a, b) => b.sort - a.sort || b.id - a.id);
  return result.map(({ sort: _sort, ...rest }) => rest);
}

export async function listMembers(groupId: number): Promise<MemberRow[]> {
  const members = await fetchRows("group_members", { where: { group_id: groupId, status: "active" } });
  const users = await usersById(members.map((m) => m.user_id));
  const out: MemberRow[] = [];
  for (const m of members) {
    const u = users.get(m.user_id);
    if (u) out.push({ user_id: m.user_id, role: m.role, joined_at: m.joined_at ?? "", name: u.name, email: u.email });
  }
  out.sort(
    (a, b) =>
      Number(a.role !== "owner") - Number(b.role !== "owner") || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return out;
}

export async function listExpenses(
  groupId: number,
  userId: number,
  requestedPage = 1,
): Promise<{ rows: ExpenseRow[]; pager: { page: number; pages: number; total: number }; totalMinor: number }> {
  const live = await fetchRows("group_expenses", {
    where: { group_id: groupId, deleted_at: null },
    order: [
      ["expense_date", true],
      ["id", true],
    ],
  });
  const total = live.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pages);
  const pageRows = live.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const [payers, splits] = await Promise.all([
    usersById(
      pageRows.map((e) => e.paid_by),
      "id,name",
    ),
    pageRows.length
      ? fetchRows("expense_splits", { where: { expense_id: pageRows.map((e) => e.id) } })
      : Promise.resolve([] as Row[]),
  ]);
  const rows: ExpenseRow[] = pageRows.map((e) => {
    const mine = splits.filter((s) => s.expense_id === e.id);
    const my = mine.find((s) => s.user_id === userId);
    return {
      id: e.id,
      title: e.title,
      category: e.category,
      expense_date: e.expense_date,
      split_method: e.split_method,
      amount_minor: e.amount_minor,
      paid_by: e.paid_by,
      created_by: e.created_by,
      payer_name: payers.get(e.paid_by)?.name ?? "",
      split_count: mine.length,
      my_share_minor: my ? (my.share_minor as number) : null,
    };
  });
  return {
    rows,
    pager: { page, pages, total },
    totalMinor: live.reduce((s, e) => s + (e.amount_minor as number), 0),
  };
}

export async function listActivity(groupId: number, limit = 20): Promise<ActivityRow[]> {
  const rows = await fetchRows("group_activity", { where: { group_id: groupId }, order: [["id", true]], limit });
  return rows.map((a) => ({ kind: a.kind, description: a.description, created_at: a.created_at ?? "" }));
}

export async function computeBalances(groupId: number): Promise<{ balances: Balance[]; transfers: TransferRow[] }> {
  const [members, expenses, splits, settlements] = await Promise.all([
    fetchRows("group_members", { where: { group_id: groupId } }),
    fetchRows("group_expenses", {
      where: { group_id: groupId, deleted_at: null },
      columns: "id,paid_by,amount_minor",
      order: [["id", false]],
    }),
    fetchRows("expense_splits", { where: { group_id: groupId }, order: [["id", false]] }),
    fetchRows("settlements", { where: { group_id: groupId }, order: [["id", false]] }),
  ]);
  const users = await usersById(
    members.map((m) => m.user_id),
    "id,name",
  );
  const book = new Map<number, Balance>();
  for (const m of members) {
    const u = users.get(m.user_id);
    if (u) {
      book.set(m.user_id, {
        user_id: m.user_id,
        name: u.name,
        active: m.status === "active",
        paid: 0,
        share: 0,
        sent: 0,
        received: 0,
        net: 0,
      });
    }
  }
  const liveIds = new Set<number>(expenses.map((e) => e.id));
  for (const e of expenses) {
    const b = book.get(e.paid_by);
    if (b) b.paid += e.amount_minor;
  }
  for (const s of splits) {
    const b = book.get(s.user_id);
    if (b && liveIds.has(s.expense_id)) b.share += s.share_minor;
  }
  for (const t of settlements) {
    const p = book.get(t.payer_id);
    if (p) p.sent += t.amount_minor;
    const r = book.get(t.receiver_id);
    if (r) r.received += t.amount_minor;
  }
  const balances: Balance[] = [];
  for (const b of book.values()) {
    b.net = b.paid - b.share + b.sent - b.received;
    if (b.active || b.net) balances.push(b);
  }
  balances.sort((a, b) => b.net - a.net || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const names = new Map(balances.map((b) => [b.user_id, b.name]));
  const transfers = simplifyDebts(new Map(balances.map((b) => [b.user_id, b.net] as [number, number]))).map(
    ([from, to, amount]) => ({
      from_id: from,
      from_name: names.get(from) as string,
      to_id: to,
      to_name: names.get(to) as string,
      amount,
    }),
  );
  return { balances, transfers };
}

// ---------------------------------------------------------------- writes
export async function createGroup(input: {
  ownerId: number;
  ownerName: string;
  name: string | null;
  description: string | null;
  currency: string | null;
  password: string | null;
}): Promise<number> {
  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim();
  const currency = (input.currency ?? "INR").trim().toUpperCase() || "INR";
  const password = input.password ?? "";
  if (len(name) < 2 || len(name) > 60) throw new GroupError("Group name must be 2 to 60 characters.");
  if (len(description) > 280) throw new GroupError("Description can be at most 280 characters.");
  if (!(currency in CURRENCIES)) throw new GroupError("Choose a supported currency.");
  if (len(password) < 6 || len(password) > 128) throw new GroupError("Group password must be 6 to 128 characters.");
  const passwordHash = hashPassword(password);
  for (let attempt = 0; attempt < 8; attempt++) {
    let group: Row;
    try {
      group = await insertRow("groups", {
        name,
        description,
        invite_code: newInviteCode(),
        password_hash: passwordHash,
        owner_id: input.ownerId,
        currency,
        created_at: now(),
      });
    } catch (err) {
      if (err instanceof DuplicateKeyError) continue; // invite code collision: try another code
      throw err;
    }
    const gid: number = group.id;
    try {
      await insertRow("group_members", {
        group_id: gid,
        user_id: input.ownerId,
        role: "owner",
        status: "active",
        joined_at: now(),
      });
    } catch (err) {
      await deleteRows("groups", { id: gid }); // undo the half-created group
      throw err;
    }
    await logActivity(gid, input.ownerId, "group_created", `${input.ownerName} created ${name}.`);
    return gid;
  }
  throw new GroupError("Couldn't generate an invite code. Please try again.");
}

/** Mark a former member active again, or add a brand new member. */
async function reactivateOrAdd(groupId: number, userId: number, existing: Row | null): Promise<void> {
  if (existing) {
    await updateRows("group_members", { group_id: groupId, user_id: userId }, { status: "active", joined_at: now() });
  } else {
    await insertRow("group_members", {
      group_id: groupId,
      user_id: userId,
      role: "member",
      status: "active",
      joined_at: now(),
    });
  }
}

export async function joinGroup(input: {
  userId: number;
  userName: string;
  code: string | null;
  password: string | null;
}): Promise<{ group: { id: number; name: string }; already: boolean }> {
  const code = normalizeInviteCode(input.code);
  const group = code ? await getOne("groups", { invite_code: code }) : null;
  if (!group || !verifyPassword(group.password_hash, input.password ?? "")) {
    throw new GroupError("That invite code and password don't match a group.");
  }
  const brief = { id: group.id as number, name: group.name as string };
  const existing = await getOne("group_members", { group_id: group.id, user_id: input.userId });
  if (existing && existing.status === "active") return { group: brief, already: true };
  try {
    await reactivateOrAdd(group.id, input.userId, existing);
  } catch (err) {
    if (err instanceof DuplicateKeyError) return { group: brief, already: true }; // double-click
    throw err;
  }
  await logActivity(group.id, input.userId, "member_joined", `${input.userName} joined the group.`);
  return { group: brief, already: false };
}

export async function addMemberByEmail(group: PublicGroup, actor: Actor, rawEmail: string | null): Promise<string> {
  if (actor.role !== "owner") throw new GroupError("Only the group owner can add people by email.");
  const email = (rawEmail ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new GroupError("Enter a valid email address.");
  const user = await getOne("users", { email }, "id,name,email");
  if (!user) {
    throw new GroupError("No account uses that email yet. Ask them to register, or share the invite code instead.");
  }
  const existing = await getOne("group_members", { group_id: group.id, user_id: user.id });
  if (existing && existing.status === "active") throw new GroupError(`${user.name} is already in this group.`);
  await reactivateOrAdd(group.id, user.id, existing);
  await logActivity(group.id, actor.user_id, "member_added", `${actor.name} added ${user.name}.`);
  return user.name;
}

export async function removeMember(group: PublicGroup, actor: Actor, targetId: number): Promise<string> {
  const leaving = targetId === actor.user_id;
  if (!leaving && actor.role !== "owner") throw new GroupError("Only the group owner can remove people.");
  const target = await getOne("group_members", { group_id: group.id, user_id: targetId, status: "active" });
  if (!target) throw new GroupError("That person isn't an active member of this group.");
  if (target.role === "owner") throw new GroupError("The owner can't leave or be removed. Delete the group instead.");
  const [{ balances }, user] = await Promise.all([
    computeBalances(group.id),
    getOne("users", { id: targetId }, "id,name"),
  ]);
  const name: string = user?.name ?? "This member";
  const net = balances.find((b) => b.user_id === targetId)?.net ?? 0;
  if (net) {
    const amt = formatAmount(Math.abs(net), group.currency);
    if (leaving) {
      throw new GroupError(`${net > 0 ? `You're owed ${amt}` : `You owe ${amt}`}. Settle up before leaving.`);
    }
    throw new GroupError(
      `${net > 0 ? `${name} is owed ${amt}` : `${name} owes ${amt}`}. Settle up before removing them.`,
    );
  }
  await updateRows("group_members", { group_id: group.id, user_id: targetId }, { status: "removed" });
  await logActivity(
    group.id,
    actor.user_id,
    leaving ? "member_left" : "member_removed",
    leaving ? `${name} left the group.` : `${actor.name} removed ${name}.`,
  );
  return name;
}

export async function deleteGroup(group: PublicGroup, actor: Actor, confirmName: string | null): Promise<void> {
  if (actor.role !== "owner") throw new GroupError("Only the group owner can delete the group.");
  if ((confirmName ?? "").trim() !== group.name) {
    throw new GroupError("Type the group name exactly to confirm deletion.");
  }
  for (const table of ["expense_splits", "settlements", "group_activity", "group_expenses", "group_members"]) {
    await deleteRows(table, { group_id: group.id });
  }
  await deleteRows("groups", { id: group.id });
}

const INT = /^[0-9]+$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function addExpense(group: PublicGroup, actor: Actor, form: FormData): Promise<number> {
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const currency = group.currency;
  const title = text("title").trim();
  const notes = text("notes").trim();
  if (!title) throw new GroupError("Give the expense a title.");
  if (len(title) > 120) throw new GroupError("Title can be at most 120 characters.");
  if (len(notes) > 500) throw new GroupError("Notes can be at most 500 characters.");
  const rawCategory = text("category");
  const category = (CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : "Other";
  const amount = parseAmount(text("amount"), currency, { label: "Amount" });

  const when = text("expense_date").trim() || todayIso();
  if (!isValidDay(when)) throw new GroupError("Enter a valid date.");
  const maxDay = new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 10);
  if (when < "2000-01-01" || when > maxDay) throw new GroupError("That date is out of range.");

  const rawPayer = text("paid_by").trim();
  const rawParticipants = form.getAll("participants").map((v) => (typeof v === "string" ? v.trim() : ""));
  if (!INT.test(rawPayer) || rawParticipants.some((p) => !INT.test(p))) {
    throw new GroupError("Pick who paid and who is in the split.");
  }
  const paidBy = Number(rawPayer);
  const participants = [...new Set(rawParticipants.map(Number))];
  if (!participants.length) throw new GroupError("Pick at least one person to split with.");
  const method = text("split_method") || "equal";
  if (!(SPLIT_METHODS as readonly string[]).includes(method)) throw new GroupError("Choose a valid split method.");

  const names = await activeMemberNames(group.id);
  if (!names.has(paidBy)) throw new GroupError("The person who paid must be an active member of this group.");
  if (!participants.every((p) => names.has(p))) {
    throw new GroupError("Everyone in the split must be an active member of this group.");
  }

  const bps = new Map<number, number>();
  let shares: Map<number, number>;
  if (method === "equal") {
    const offset = await countRows("group_expenses", { group_id: group.id });
    shares = splitEqual(amount, participants, offset);
  } else if (method === "exact") {
    const amounts = new Map<number, number>();
    for (const uid of participants) {
      amounts.set(
        uid,
        parseAmount(text(`exact_${uid}`), currency, { label: `${names.get(uid)}'s amount`, allowZero: true }),
      );
    }
    shares = splitExact(amount, amounts, currency);
  } else {
    for (const uid of participants) {
      bps.set(uid, parsePercentBp(text(`percent_${uid}`), `${names.get(uid)}'s percentage`));
    }
    shares = splitPercent(amount, bps);
  }

  const expense = await insertRow("group_expenses", {
    group_id: group.id,
    paid_by: paidBy,
    title,
    amount_minor: amount,
    category,
    expense_date: when,
    split_method: method,
    notes,
    created_by: actor.user_id,
    deleted_at: null,
    deleted_by: null,
    created_at: now(),
  });
  const eid: number = expense.id;
  try {
    await insertRows(
      "expense_splits",
      [...shares].map(([uid, share]) => ({
        expense_id: eid,
        group_id: group.id,
        user_id: uid,
        share_minor: share,
        share_bp: bps.get(uid) ?? null,
      })),
    );
  } catch (err) {
    await deleteRows("group_expenses", { id: eid }); // no expense without its splits
    throw err;
  }
  await logActivity(
    group.id,
    actor.user_id,
    "expense_added",
    `${actor.name} added ${title} for ${formatAmount(amount, currency)}.`,
    eid,
  );
  return eid;
}

export async function deleteExpense(group: PublicGroup, actor: Actor, expenseId: number): Promise<string> {
  const exp = await getOne("group_expenses", { id: expenseId, group_id: group.id, deleted_at: null });
  if (!exp) throw new GroupError("That expense no longer exists.");
  if (exp.created_by !== actor.user_id && actor.role !== "owner") {
    throw new GroupError("Only the person who added an expense, or the group owner, can delete it.");
  }
  await updateRows("group_expenses", { id: exp.id }, { deleted_at: now(), deleted_by: actor.user_id });
  await logActivity(group.id, actor.user_id, "expense_deleted", `${actor.name} deleted ${exp.title}.`, exp.id);
  return exp.title;
}

export async function recordSettlement(
  group: PublicGroup,
  actor: Actor,
  payerId: number,
  receiverId: number,
  amountMinor: number,
): Promise<[string, string]> {
  if (payerId === receiverId) throw new GroupError("Payer and receiver must be different people.");
  if (amountMinor <= 0) throw new GroupError("Settlement amount must be greater than zero.");
  if (actor.user_id !== payerId && actor.user_id !== receiverId && actor.role !== "owner") {
    throw new GroupError("Only the payer, the receiver or the group owner can record a payment.");
  }
  const names = await activeMemberNames(group.id);
  const payer = names.get(payerId);
  const receiver = names.get(receiverId);
  if (payer === undefined || receiver === undefined) {
    throw new GroupError("Both people must be active members of this group.");
  }
  const { balances } = await computeBalances(group.id);
  const net = new Map(balances.map((b) => [b.user_id, b.net]));
  const cap = Math.min(Math.max(0, -(net.get(payerId) ?? 0)), Math.max(0, net.get(receiverId) ?? 0));
  if (cap === 0) throw new GroupError(`${payer} doesn't owe ${receiver} anything right now.`);
  if (amountMinor > cap) {
    throw new GroupError(
      `That's more than ${payer} owes ${receiver}. The most you can record is ${formatAmount(cap, group.currency)}.`,
    );
  }
  await insertRow("settlements", {
    group_id: group.id,
    payer_id: payerId,
    receiver_id: receiverId,
    amount_minor: amountMinor,
    created_by: actor.user_id,
    created_at: now(),
  });
  await logActivity(
    group.id,
    actor.user_id,
    "settlement",
    `${payer} paid ${receiver} ${formatAmount(amountMinor, group.currency)}.`,
  );
  return [payer, receiver];
}
