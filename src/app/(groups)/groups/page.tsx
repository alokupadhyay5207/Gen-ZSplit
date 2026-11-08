import Link from "next/link";
import type { CSSProperties } from "react";
import { CreateGroupDialog, JoinGroupDialog } from "@/components/GroupDialogs";
import { Icon } from "@/components/Icon";
import { OpenModalButton } from "@/components/modal";
import { ToastOnMount } from "@/components/toast";
import { hue } from "@/lib/format";
import { listUserGroups } from "@/lib/groups";
import { CURRENCY_CODES, CURRENCY_SYMBOLS, formatAmount } from "@/lib/money";
import { NOTICES } from "@/lib/notices";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Your groups · Gen-ZSplit" };

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const groups = await listUserGroups(user.uid);
  const code = typeof sp.notice === "string" ? sp.notice : "";
  const notice = NOTICES[code];

  return (
    <>
      {notice ? <ToastOnMount kind={notice.kind} message={notice.message} /> : null}
      <header className="gz-pagehead">
        <div>
          <h1 className="gz-h1">Your groups</h1>
          <p className="gz-lede">Split trips, flats and nights out without the awkward maths.</p>
        </div>
        <div className="gz-pagehead-actions">
          <OpenModalButton modal="join-modal" className="gz-btn gz-btn--ghost">
            <Icon name="key" /> Join with a code
          </OpenModalButton>
          <OpenModalButton modal="create-modal" className="gz-btn gz-btn--primary">
            <Icon name="plus" /> New group
          </OpenModalButton>
        </div>
      </header>

      {groups.length ? (
        <ul className="gz-grid">
          {groups.map((g) => (
            <li key={g.id}>
              <Link className="gz-gcard" href={`/groups/${g.id}`} style={{ "--h": hue(g.name) } as CSSProperties}>
                <div className="gz-gcard-top">
                  <span className="gz-glyph" aria-hidden="true">
                    {Array.from(g.name)[0]?.toUpperCase()}
                  </span>
                  <div className="gz-gcard-title">
                    <h2>{g.name}</h2>
                    <p>{g.description || "No description yet."}</p>
                  </div>
                  {g.role === "owner" ? <span className="gz-tag">Owner</span> : null}
                </div>
                <div className="gz-gcard-foot">
                  <p className="gz-gcard-meta">
                    {g.member_count} {g.member_count === 1 ? "person" : "people"}, {g.expense_count}{" "}
                    {g.expense_count === 1 ? "expense" : "expenses"}
                  </p>
                  {g.net_minor > 0 ? (
                    <p className="gz-pos is-owed">
                      You&apos;re owed <strong>{formatAmount(g.net_minor, g.currency)}</strong>
                    </p>
                  ) : g.net_minor < 0 ? (
                    <p className="gz-pos is-owes">
                      You owe <strong>{formatAmount(-g.net_minor, g.currency)}</strong>
                    </p>
                  ) : g.expense_count ? (
                    <p className="gz-pos">Settled up</p>
                  ) : (
                    <p className="gz-pos">No expenses yet</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <section className="gz-empty">
          <svg viewBox="0 0 120 90" aria-hidden="true">
            <defs>
              <linearGradient id="gz-e1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#818cf8" />
                <stop offset="1" stopColor="#6366f1" />
              </linearGradient>
              <linearGradient id="gz-e2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#c084fc" />
                <stop offset="1" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            <circle cx="46" cy="46" r="30" fill="url(#gz-e1)" opacity=".9" />
            <circle cx="76" cy="46" r="30" fill="url(#gz-e2)" opacity=".75" />
            <path
              d="M38 40h24m0 0-6-6m6 6-6 6M82 52H58m0 0 6-6m-6 6 6 6"
              fill="none"
              stroke="#0b0c26"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity=".85"
            />
          </svg>
          <h2 className="gz-h2">No groups yet</h2>
          <p>Create a group for your trip or flat, then share its invite code. Everyone&apos;s balance updates as expenses are added.</p>
          <div className="gz-btn-row">
            <OpenModalButton modal="create-modal" className="gz-btn gz-btn--primary">
              <Icon name="plus" /> Create your first group
            </OpenModalButton>
            <OpenModalButton modal="join-modal" className="gz-btn gz-btn--ghost">
              <Icon name="key" /> I have an invite code
            </OpenModalButton>
          </div>
        </section>
      )}

      <CreateGroupDialog currencies={CURRENCY_CODES} symbols={CURRENCY_SYMBOLS} />
      <JoinGroupDialog />
    </>
  );
}
