"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { GroupError } from "@/lib/errors";
import * as svc from "@/lib/groups";
import { parseAmount } from "@/lib/money";
import { requireUser, type AuthedUser } from "@/lib/session";
import { joinThrottle } from "@/lib/throttle";

const GENERIC_FAILURE = "Something went wrong on our side. Nothing was saved. Please try again.";
const NOT_FOUND: ActionResult = { ok: false, error: "We couldn't find that group.", redirectTo: "/groups" };

const str = (fd: FormData, name: string): string | null => {
  const v = fd.get(name);
  return typeof v === "string" ? v : null;
};

/** Run a service call. GroupError text is shown to the user; anything else is logged and replaced by a generic message. */
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof GroupError) return { ok: false, error: err.message };
    console.error("Unhandled error in group action", err);
    return { ok: false, error: GENERIC_FAILURE };
  }
}

type Ctx = { user: AuthedUser; group: svc.PublicGroup; me: svc.Membership; actor: svc.Actor };

async function member(groupId: number): Promise<Ctx | null> {
  const user = await requireUser();
  const access = await svc.getAccess(groupId, user.uid);
  return access ? { user, ...access, actor: svc.actorOf(access.me) } : null;
}

function refresh(groupId: number) {
  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");
}

export async function createGroupAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const r = await attempt(() =>
    svc.createGroup({
      ownerId: user.uid,
      ownerName: user.name,
      name: str(formData, "name"),
      description: str(formData, "description"),
      currency: str(formData, "currency"),
      password: str(formData, "password"),
    }),
  );
  if (!r.ok) return r;
  revalidatePath("/groups");
  return {
    ok: true,
    message: "Group created. Share its invite code and password with the people you want in.",
    redirectTo: `/groups/${r.value}`,
  };
}

export async function joinGroupAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const key = `join:${user.uid}`;
  const wait = joinThrottle.retryAfter(key);
  if (wait) return { ok: false, error: `Too many failed attempts. Try again in ${Math.max(1, Math.floor(wait / 60))} min.` };
  const r = await attempt(() =>
    svc.joinGroup({ userId: user.uid, userName: user.name, code: str(formData, "code"), password: str(formData, "password") }),
  );
  if (!r.ok) {
    // Only wrong code/password counts toward the lockout, not infrastructure errors.
    if (r.error !== GENERIC_FAILURE) joinThrottle.recordFailure(key);
    return r;
  }
  joinThrottle.reset(key);
  revalidatePath("/groups");
  const { group, already } = r.value;
  return {
    ok: true,
    kind: already ? "info" : "success",
    message: already ? `You're already in ${group.name}.` : `You joined ${group.name}.`,
    redirectTo: `/groups/${group.id}`,
  };
}

export async function deleteGroupAction(groupId: number, formData: FormData): Promise<ActionResult> {
  const c = await member(groupId);
  if (!c) return NOT_FOUND;
  const r = await attempt(() => svc.deleteGroup(c.group, c.actor, str(formData, "confirm_name")));
  if (!r.ok) return r;
  revalidatePath("/groups");
  return { ok: true, message: `${c.group.name} and all of its data were deleted.`, redirectTo: "/groups" };
}

export async function addMemberAction(groupId: number, formData: FormData): Promise<ActionResult> {
  const c = await member(groupId);
  if (!c) return NOT_FOUND;
  const r = await attempt(() => svc.addMemberByEmail(c.group, c.actor, str(formData, "email")));
  if (!r.ok) return r;
  refresh(groupId);
  return { ok: true, message: `${r.value} is now in the group.` };
}

export async function removeMemberAction(groupId: number, userId: number): Promise<ActionResult> {
  const c = await member(groupId);
  if (!c) return NOT_FOUND;
  const r = await attempt(() => svc.removeMember(c.group, c.actor, Number(userId)));
  if (!r.ok) return r;
  refresh(groupId);
  return { ok: true, message: `${r.value} was removed from the group.` };
}

export async function leaveGroupAction(groupId: number): Promise<ActionResult> {
  const c = await member(groupId);
  if (!c) return NOT_FOUND;
  const r = await attempt(() => svc.removeMember(c.group, c.actor, c.me.user_id));
  if (!r.ok) return r;
  revalidatePath("/groups");
  return { ok: true, message: `You left ${c.group.name}.`, redirectTo: "/groups" };
}

export async function addExpenseAction(groupId: number, formData: FormData): Promise<ActionResult> {
  const c = await member(groupId);
  if (!c) return NOT_FOUND;
  const r = await attempt(() => svc.addExpense(c.group, c.actor, formData));
  if (!r.ok) return r;
  refresh(groupId);
  return { ok: true, message: "Expense added and split." };
}

export async function deleteExpenseAction(groupId: number, expenseId: number): Promise<ActionResult> {
  const c = await member(groupId);
  if (!c) return NOT_FOUND;
  const r = await attempt(() => svc.deleteExpense(c.group, c.actor, Number(expenseId)));
  if (!r.ok) return r;
  refresh(groupId);
  return { ok: true, message: `Deleted ${r.value}.` };
}

export async function settleAction(groupId: number, formData: FormData): Promise<ActionResult> {
  const c = await member(groupId);
  if (!c) return NOT_FOUND;
  const r = await attempt(async () => {
    const payer = Number(str(formData, "payer_id"));
    const receiver = Number(str(formData, "receiver_id"));
    if (!Number.isInteger(payer) || !Number.isInteger(receiver) || !str(formData, "payer_id") || !str(formData, "receiver_id")) {
      throw new GroupError("Choose who is paying whom.");
    }
    const amount = parseAmount(str(formData, "amount"), c.group.currency, { label: "Amount" });
    return svc.recordSettlement(c.group, c.actor, payer, receiver, amount);
  });
  if (!r.ok) return r;
  refresh(groupId);
  return { ok: true, message: `Recorded: ${r.value[0]} paid ${r.value[1]}.` };
}
