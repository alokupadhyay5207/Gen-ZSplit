import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { deleteExpenseAction, leaveGroupAction, removeMemberAction, settleAction } from "@/actions/groups";
import { Avatar } from "@/components/Avatar";
import { ExpenseModal } from "@/components/ExpenseModal";
import { AddMemberDialog, DeleteGroupDialog } from "@/components/GroupDialogs";
import { Icon } from "@/components/Icon";
import { ActionForm, GzSubmit } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm";
import { AutoOpen, OpenModalButton } from "@/components/modal";
import { CopyButton } from "@/components/small";
import { ago, CATEGORY_HUE, displayInviteCode, FEED_ICON, hue, shortDate, SPLIT_LABEL } from "@/lib/format";
import { CATEGORIES, computeBalances, getAccess, listActivity, listExpenses, listMembers } from "@/lib/groups";
import { CURRENCY_EXPONENT, CURRENCY_SYMBOLS, formatAmount, toInputValue } from "@/lib/money";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Group · Gen-ZSplit" };

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  const { groupId } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(groupId)) notFound();
  const gid = Number(groupId);

  const access = await getAccess(gid, user.uid);
  if (!access) redirect("/groups?notice=group-not-found");
  const { group, me } = access;
  const isOwner = me.role === "owner";
  const cur = group.currency;
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;

  const [{ balances, transfers }, { rows: expenses, pager, totalMinor }, members, activity] = await Promise.all([
    computeBalances(gid),
    listExpenses(gid, me.user_id, page),
    listMembers(gid),
    listActivity(gid),
  ]);
  const myNet = balances.find((b) => b.user_id === me.user_id)?.net ?? 0;
  const reach = Math.max(1, ...balances.map((b) => Math.abs(b.net)));
  const state = myNet > 0 ? "owed" : myNet < 0 ? "owes" : "even";
  const money = (minor: number, signed = false) => formatAmount(minor, cur, signed);
  const h = (name: string) => ({ "--h": hue(name) }) as CSSProperties;

  return (
    <>
      {sp.add ? <AutoOpen modal="expense-modal" /> : null}
      <nav className="gz-crumbs" aria-label="Breadcrumb">
        <Link href="/groups">
          <Icon name="chev-left" /> All groups
        </Link>
      </nav>

      {/* ================= Hero: where do I stand? ================= */}
      <section className="gz-hero gz-glass" data-state={state} aria-labelledby="group-title">
        <div className="gz-hero-head">
          <span className="gz-glyph" style={h(group.name)} aria-hidden="true">
            {Array.from(group.name)[0]?.toUpperCase()}
          </span>
          <div>
            <h1 className="gz-h1" id="group-title">
              {group.name}
            </h1>
            <p className="gz-lede">{group.description || "Shared expenses for this group."}</p>
          </div>
          <div className="gz-hero-actions">
            <OpenModalButton modal="expense-modal" className="gz-btn gz-btn--primary">
              <Icon name="plus" /> Add expense
            </OpenModalButton>
          </div>
        </div>

        <div className="gz-position" aria-live="polite">
          {myNet > 0 ? (
            <>
              <p className="gz-position-label">You&apos;re owed</p>
              <p className="gz-position-amount">{money(myNet)}</p>
            </>
          ) : myNet < 0 ? (
            <>
              <p className="gz-position-label">You owe</p>
              <p className="gz-position-amount">{money(-myNet)}</p>
            </>
          ) : (
            <>
              <p className="gz-position-label">Your balance</p>
              <p className="gz-position-amount">{pager.total ? "All settled up" : "No expenses yet"}</p>
            </>
          )}
        </div>

        <div className="gz-spine-wrap">
          <h2 className="gz-h3">Where everyone stands</h2>
          <ul className="gz-spine">
            {balances.map((b) => (
              <li
                className="gz-spine-row"
                key={b.user_id}
                style={{ "--w": `${Number(((Math.abs(b.net) / reach) * 100).toFixed(1))}%` } as CSSProperties}
              >
                <div className="gz-spine-who">
                  <Avatar name={b.name} />
                  <span>
                    {b.name}
                    {b.user_id === me.user_id ? <span className="gz-faint"> (you)</span> : null}
                  </span>
                </div>
                <div className="gz-spine-track" aria-hidden="true">
                  {b.net !== 0 ? <span className={`gz-spine-bar ${b.net > 0 ? "is-owed" : "is-owes"}`} /> : null}
                </div>
                <div className={`gz-spine-amt ${b.net > 0 ? "is-owed" : b.net < 0 ? "is-owes" : ""}`.trim()}>
                  {b.net > 0 ? (
                    <>
                      <small>is owed</small>
                      {money(b.net)}
                    </>
                  ) : b.net < 0 ? (
                    <>
                      <small>owes</small>
                      {money(-b.net)}
                    </>
                  ) : (
                    <>
                      <small>settled</small>
                      {money(0)}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <dl className="gz-facts">
          <div>
            <dt>Total spent</dt>
            <dd>{money(totalMinor)}</dd>
          </div>
          <div>
            <dt>Expenses</dt>
            <dd>{pager.total}</dd>
          </div>
          <div>
            <dt>People</dt>
            <dd>{members.length}</dd>
          </div>
        </dl>
      </section>

      <div className="gz-cols">
        <div className="gz-stack">
          {/* ================= Settle up ================= */}
          <section className="gz-panel" aria-labelledby="settle-title">
            <div className="gz-panel-head">
              <h2 className="gz-h2" id="settle-title">
                Settle up
              </h2>
            </div>
            {transfers.length ? (
              <ul className="gz-transfers">
                {transfers.map((t) => (
                  <li className="gz-transfer" key={`${t.from_id}-${t.to_id}`}>
                    <Avatar name={t.from_name} />
                    <div className="gz-transfer-text">
                      <strong>{t.from_name}</strong> pays <strong>{t.to_name}</strong>
                      <small>Suggested to clear every balance</small>
                    </div>
                    <span className="gz-transfer-amt">{money(t.amount)}</span>
                    {isOwner || me.user_id === t.from_id || me.user_id === t.to_id ? (
                      <ActionForm action={settleAction.bind(null, gid)}>
                        <input type="hidden" name="payer_id" value={t.from_id} />
                        <input type="hidden" name="receiver_id" value={t.to_id} />
                        <input type="hidden" name="amount" value={toInputValue(t.amount, cur)} />
                        <GzSubmit className="gz-btn gz-btn--soft gz-btn--sm">
                          <Icon name="check" /> Mark as paid
                        </GzSubmit>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="gz-allclear">
                <Icon name="check-circle" />{" "}
                <span>
                  {pager.total ? "Nobody owes anybody. You're all square." : "Nothing to settle yet. Add an expense to get started."}
                </span>
              </div>
            )}
          </section>

          {/* ================= Expenses ================= */}
          <section className="gz-panel" aria-labelledby="exp-title">
            <div className="gz-panel-head">
              <h2 className="gz-h2" id="exp-title">
                Expenses
              </h2>
              <OpenModalButton modal="expense-modal" className="gz-btn gz-btn--soft gz-btn--sm">
                <Icon name="plus" /> Add
              </OpenModalButton>
            </div>
            {expenses.length ? (
              <>
                <div className="gz-table-wrap">
                  <table className="gz-table">
                    <caption className="gz-sr">Expenses in {group.name}, newest first</caption>
                    <thead>
                      <tr>
                        <th scope="col">Expense</th>
                        <th scope="col">Paid by</th>
                        <th scope="col" className="is-end">
                          Total
                        </th>
                        <th scope="col" className="is-end">
                          Your part
                        </th>
                        <th scope="col">
                          <span className="gz-sr">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((e) => {
                        const mine = e.my_share_minor;
                        const lent = e.amount_minor - (mine ?? 0);
                        return (
                          <tr key={e.id}>
                            <td data-label="Expense">
                              <div className="gz-table-title">{e.title}</div>
                              <div className="gz-table-sub">
                                <span className="gz-chip" style={{ "--h": CATEGORY_HUE[e.category] ?? 240 } as CSSProperties}>
                                  {e.category}
                                </span>
                                <span>{shortDate(e.expense_date)}</span>
                                <span>
                                  split {SPLIT_LABEL[e.split_method]} between {e.split_count}
                                </span>
                                <span className="gz-sr-mobile">paid by {e.payer_name}</span>
                              </div>
                            </td>
                            <td data-label="Paid by">
                              <span className="gz-payer">
                                <Avatar name={e.payer_name} />
                                {e.payer_name}
                              </span>
                            </td>
                            <td data-label="Total" className="is-end gz-money">
                              {money(e.amount_minor)}
                            </td>
                            <td data-label="Your part" className="is-end">
                              {e.paid_by === me.user_id ? (
                                lent > 0 ? (
                                  <span className="gz-money is-owed">You lent {money(lent)}</span>
                                ) : (
                                  <span className="gz-muted">Only you</span>
                                )
                              ) : mine ? (
                                <span className="gz-money is-owes">You owe {money(mine)}</span>
                              ) : (
                                <span className="gz-faint">Not involved</span>
                              )}
                            </td>
                            <td data-label="" className="is-end">
                              {e.created_by === me.user_id || isOwner ? (
                                <ConfirmButton
                                  className="gz-iconbtn gz-iconbtn--danger gz-iconbtn--sm"
                                  label={`Delete ${e.title}`}
                                  spec={{
                                    title: "Delete this expense?",
                                    body: `“${e.title}” will be removed and everyone's balance recalculated.`,
                                    button: "Delete expense",
                                    action: deleteExpenseAction.bind(null, gid, e.id),
                                  }}
                                >
                                  <Icon name="trash" />
                                </ConfirmButton>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {pager.pages > 1 ? (
                  <nav className="gz-pager" aria-label="Expense pages">
                    <span>
                      Page {pager.page} of {pager.pages}
                    </span>
                    <div>
                      <Link
                        className={`gz-btn gz-btn--ghost gz-btn--sm${pager.page <= 1 ? " is-off" : ""}`}
                        href={`/groups/${gid}?page=${Math.max(1, pager.page - 1)}`}
                      >
                        Newer
                      </Link>
                      <Link
                        className={`gz-btn gz-btn--ghost gz-btn--sm${pager.page >= pager.pages ? " is-off" : ""}`}
                        href={`/groups/${gid}?page=${Math.min(pager.pages, pager.page + 1)}`}
                      >
                        Older
                      </Link>
                    </div>
                  </nav>
                ) : null}
              </>
            ) : (
              <div className="gz-empty gz-empty--inline">
                <h3 className="gz-h3">No expenses yet</h3>
                <p>Add the first one and it will be split between the people you choose.</p>
                <div className="gz-btn-row">
                  <OpenModalButton modal="expense-modal" className="gz-btn gz-btn--primary gz-btn--sm">
                    <Icon name="plus" /> Add expense
                  </OpenModalButton>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ================= Side column ================= */}
        <aside className="gz-stack" aria-label="Group details">
          <section className="gz-panel gz-invite" aria-labelledby="invite-title">
            <h2 className="gz-h3" id="invite-title">
              Invite code
            </h2>
            <code className="gz-invite-code" id="invite-code">
              {displayInviteCode(group.invite_code)}
            </code>
            <CopyButton text={displayInviteCode(group.invite_code)} />
            <p className="gz-hint" style={{ marginTop: 12 }}>
              New people also need the group password you chose when creating it.
            </p>
          </section>

          <section className="gz-panel" aria-labelledby="members-title">
            <div className="gz-panel-head">
              <h2 className="gz-h2" id="members-title">
                People
              </h2>
              {isOwner ? (
                <OpenModalButton modal="member-modal" className="gz-btn gz-btn--soft gz-btn--sm">
                  <Icon name="user-plus" /> Add
                </OpenModalButton>
              ) : null}
            </div>
            <ul className="gz-members">
              {members.map((m) => (
                <li className="gz-member" key={m.user_id}>
                  <Avatar name={m.name} />
                  <div className="gz-member-info">
                    <strong>
                      {m.name}
                      {m.user_id === me.user_id ? " (you)" : ""}
                    </strong>
                    <small>
                      {m.role === "owner" ? "Owner" : "Member"}, {m.email}
                    </small>
                  </div>
                  {isOwner && m.role !== "owner" ? (
                    <ConfirmButton
                      className="gz-iconbtn gz-iconbtn--danger gz-iconbtn--sm"
                      label={`Remove ${m.name}`}
                      spec={{
                        title: `Remove ${m.name}?`,
                        body: "They keep their history, but can't see or add to the group unless they rejoin. This only works once their balance is settled.",
                        button: "Remove",
                        action: removeMemberAction.bind(null, gid, m.user_id),
                      }}
                    >
                      <Icon name="close" />
                    </ConfirmButton>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="gz-panel" aria-labelledby="activity-title">
            <div className="gz-panel-head">
              <h2 className="gz-h2" id="activity-title">
                Activity
              </h2>
            </div>
            <ol className="gz-feed">
              {activity.length ? (
                activity.map((a, i) => (
                  <li key={i}>
                    <span className="gz-feed-ico">
                      <Icon name={FEED_ICON[a.kind] ?? "info"} />
                    </span>
                    <div>
                      <p>{a.description}</p>
                      <small>{ago(a.created_at)}</small>
                    </div>
                  </li>
                ))
              ) : (
                <li>
                  <p className="gz-muted">Nothing yet.</p>
                </li>
              )}
            </ol>
          </section>

          <section className="gz-panel gz-danger">
            {isOwner ? (
              <>
                <p>Deleting the group permanently removes every expense, payment and member record.</p>
                <OpenModalButton modal="delete-modal" className="gz-btn gz-btn--danger gz-btn--sm">
                  <Icon name="trash" /> Delete group
                </OpenModalButton>
              </>
            ) : (
              <>
                <p>Leave this group once you have no balance left to settle.</p>
                <ConfirmButton
                  className="gz-btn gz-btn--danger gz-btn--sm"
                  spec={{
                    title: `Leave ${group.name}?`,
                    body: "You can rejoin later with the invite code and password.",
                    button: "Leave group",
                    action: leaveGroupAction.bind(null, gid),
                  }}
                >
                  <Icon name="logout" /> Leave group
                </ConfirmButton>
              </>
            )}
          </section>
        </aside>
      </div>

      <OpenModalButton modal="expense-modal" className="gz-btn gz-btn--primary gz-fab">
        <Icon name="plus" /> Add expense
      </OpenModalButton>

      <ExpenseModal
        groupId={gid}
        currency={cur}
        symbol={CURRENCY_SYMBOLS[cur] ?? cur}
        exponent={CURRENCY_EXPONENT[cur] ?? 2}
        members={members.map((m) => ({ user_id: m.user_id, name: m.name }))}
        meId={me.user_id}
        categories={CATEGORIES}
        today={new Date().toISOString().slice(0, 10)}
      />
      {isOwner ? (
        <>
          <AddMemberDialog groupId={gid} />
          <DeleteGroupDialog groupId={gid} groupName={group.name} />
        </>
      ) : null}
    </>
  );
}
