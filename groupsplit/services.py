"""Business logic for groups, members, expenses and settlements.

Rules of the house
------------------
* Functions take an open sqlite3 connection and plain values - no Flask
  globals - so they are trivially testable.
* Every write runs inside ``db.transaction`` (BEGIN IMMEDIATE ... COMMIT) and
  re-checks its preconditions *inside* that lock, so two simultaneous requests
  cannot both pass the same check.
* Anything the user can fix raises ``GroupError`` with a sentence meant to be
  shown verbatim.  Anything else propagates (and the route logs it).
"""
from __future__ import annotations

import logging
import re
import secrets
import sqlite3
from datetime import date, timedelta

from werkzeug.security import check_password_hash, generate_password_hash

from db import transaction
from . import money
from .errors import GroupError

log = logging.getLogger(__name__)

CATEGORIES = ["Food", "Travel", "Hotel", "Shopping", "Utilities", "Entertainment", "Other"]
SPLIT_METHODS = ("equal", "exact", "percentage")
_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I look-alikes
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PAGE_SIZE = 12


# ------------------------------------------------------------------ helpers
def normalize_invite_code(raw: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def display_invite_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}" if len(code) == 8 else code


def _new_invite_code() -> str:
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(8))


def _log(conn, group_id, actor_id, kind, text, expense_id=None):
    conn.execute(
        "INSERT INTO group_activity (group_id, actor_id, kind, description, expense_id) "
        "VALUES (?, ?, ?, ?, ?)",
        (group_id, actor_id, kind, text, expense_id),
    )


def _active_member_names(conn, group_id) -> dict[int, str]:
    rows = conn.execute(
        "SELECT gm.user_id, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id "
        "WHERE gm.group_id = ? AND gm.status = 'active'",
        (group_id,),
    ).fetchall()
    return {r["user_id"]: r["name"] for r in rows}


# -------------------------------------------------------------------- reads
def get_group(conn, group_id):
    return conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()


def get_membership(conn, group_id, user_id):
    """The caller's *active* membership row, or None. This is the single
    authorisation gate for every group route."""
    return conn.execute(
        "SELECT gm.*, u.name, u.email FROM group_members gm JOIN users u ON u.id = gm.user_id "
        "WHERE gm.group_id = ? AND gm.user_id = ? AND gm.status = 'active'",
        (group_id, user_id),
    ).fetchone()


def list_user_groups(conn, user_id):
    """Every group the user belongs to, with the user's own net position in each
    (computed in SQL: no per-group round trips)."""
    return conn.execute(
        """
        SELECT g.id, g.name, g.description, g.currency, gm.role,
               (SELECT COUNT(*) FROM group_members m
                 WHERE m.group_id = g.id AND m.status = 'active')                 AS member_count,
               (SELECT COUNT(*) FROM group_expenses e
                 WHERE e.group_id = g.id AND e.deleted_at IS NULL)                AS expense_count,
               (SELECT COALESCE(SUM(e.amount_minor), 0) FROM group_expenses e
                 WHERE e.group_id = g.id AND e.deleted_at IS NULL)                AS total_minor,
               ( COALESCE((SELECT SUM(e.amount_minor) FROM group_expenses e
                            WHERE e.group_id = g.id AND e.deleted_at IS NULL
                              AND e.paid_by = :u), 0)
               - COALESCE((SELECT SUM(s.share_minor) FROM expense_splits s
                            JOIN group_expenses e ON e.id = s.expense_id
                            WHERE s.group_id = g.id AND e.deleted_at IS NULL
                              AND s.user_id = :u), 0)
               + COALESCE((SELECT SUM(t.amount_minor) FROM settlements t
                            WHERE t.group_id = g.id AND t.payer_id = :u), 0)
               - COALESCE((SELECT SUM(t.amount_minor) FROM settlements t
                            WHERE t.group_id = g.id AND t.receiver_id = :u), 0)
               )                                                                  AS net_minor
          FROM groups g
          JOIN group_members gm
            ON gm.group_id = g.id AND gm.user_id = :u AND gm.status = 'active'
         ORDER BY COALESCE((SELECT MAX(a.id) FROM group_activity a WHERE a.group_id = g.id), 0) DESC,
                  g.id DESC
        """,
        {"u": user_id},
    ).fetchall()


def list_members(conn, group_id):
    return conn.execute(
        "SELECT gm.user_id, gm.role, gm.joined_at, u.name, u.email "
        "FROM group_members gm JOIN users u ON u.id = gm.user_id "
        "WHERE gm.group_id = ? AND gm.status = 'active' "
        "ORDER BY (gm.role = 'owner') DESC, lower(u.name)",
        (group_id,),
    ).fetchall()


def list_expenses(conn, group_id, user_id, page=1):
    """One page of live expenses + the caller's share of each."""
    total = conn.execute(
        "SELECT COUNT(*) FROM group_expenses WHERE group_id = ? AND deleted_at IS NULL",
        (group_id,),
    ).fetchone()[0]
    pages = max(1, -(-total // PAGE_SIZE))
    page = min(max(1, page), pages)
    rows = conn.execute(
        """
        SELECT e.id, e.title, e.amount_minor, e.category, e.expense_date, e.split_method,
               e.notes, e.paid_by, e.created_by, u.name AS payer_name,
               (SELECT COUNT(*) FROM expense_splits s WHERE s.expense_id = e.id) AS split_count,
               (SELECT s.share_minor FROM expense_splits s
                 WHERE s.expense_id = e.id AND s.user_id = :me)                    AS my_share_minor
          FROM group_expenses e
          JOIN users u ON u.id = e.paid_by
         WHERE e.group_id = :g AND e.deleted_at IS NULL
         ORDER BY e.expense_date DESC, e.id DESC
         LIMIT :limit OFFSET :offset
        """,
        {"me": user_id, "g": group_id, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE},
    ).fetchall()
    return rows, {"page": page, "pages": pages, "total": total}


def group_total(conn, group_id) -> int:
    """Sum of all live (non-deleted) expenses, in minor units."""
    return conn.execute(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM group_expenses "
        "WHERE group_id = ? AND deleted_at IS NULL", (group_id,)).fetchone()[0]


def list_activity(conn, group_id, limit=20):
    return conn.execute(
        "SELECT kind, description, created_at FROM group_activity "
        "WHERE group_id = ? ORDER BY id DESC LIMIT ?",
        (group_id, limit),
    ).fetchall()


def compute_balances(conn, group_id):
    """-> (rows, transfers).

    rows:      per active member {user_id, name, paid, share, net} in minor units,
               ``net > 0`` = the group owes them, ``net < 0`` = they owe the group.
    transfers: minimal-ish [{from_id, from_name, to_id, to_name, amount}] to settle up.

    Four set-based aggregate queries; no loop of per-expense queries.
    """
    members = conn.execute(
        "SELECT gm.user_id, gm.status, u.name FROM group_members gm "
        "JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?",
        (group_id,),
    ).fetchall()
    book = {m["user_id"]: {"user_id": m["user_id"], "name": m["name"], "active": m["status"] == "active",
                            "paid": 0, "share": 0, "sent": 0, "received": 0} for m in members}

    def add(sql, field):
        for r in conn.execute(sql, (group_id,)):
            if r[0] in book:
                book[r[0]][field] += r[1]

    add("SELECT paid_by, SUM(amount_minor) FROM group_expenses "
        "WHERE group_id = ? AND deleted_at IS NULL GROUP BY paid_by", "paid")
    add("SELECT s.user_id, SUM(s.share_minor) FROM expense_splits s "
        "JOIN group_expenses e ON e.id = s.expense_id "
        "WHERE e.group_id = ? AND e.deleted_at IS NULL GROUP BY s.user_id", "share")
    add("SELECT payer_id, SUM(amount_minor) FROM settlements WHERE group_id = ? GROUP BY payer_id", "sent")
    add("SELECT receiver_id, SUM(amount_minor) FROM settlements WHERE group_id = ? GROUP BY receiver_id", "received")

    rows = []
    for b in book.values():
        b["net"] = b["paid"] - b["share"] + b["sent"] - b["received"]
        if b["active"] or b["net"]:
            rows.append(b)
    rows.sort(key=lambda b: (-b["net"], b["name"].lower()))

    names = {b["user_id"]: b["name"] for b in rows}
    transfers = [
        {"from_id": f, "from_name": names[f], "to_id": t, "to_name": names[t], "amount": a}
        for f, t, a in money.simplify_debts({b["user_id"]: b["net"] for b in rows})
    ]
    return rows, transfers


# ------------------------------------------------------------------- groups
def create_group(conn, *, owner_id, owner_name, name, description, currency, password) -> int:
    name = (name or "").strip()
    description = (description or "").strip()
    currency = (currency or "INR").strip().upper()
    if not 2 <= len(name) <= 60:
        raise GroupError("Group name must be 2 to 60 characters.")
    if len(description) > 280:
        raise GroupError("Description can be at most 280 characters.")
    if currency not in money.CURRENCIES:
        raise GroupError("Choose a supported currency.")
    if not 6 <= len(password or "") <= 128:
        raise GroupError("Group password must be 6 to 128 characters.")

    pw_hash = generate_password_hash(password)
    for _ in range(8):  # invite-code collisions are astronomically rare; retry anyway
        try:
            with transaction(conn):
                cur = conn.execute(
                    "INSERT INTO groups (name, description, invite_code, password_hash, owner_id, currency) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (name, description, _new_invite_code(), pw_hash, owner_id, currency),
                )
                gid = cur.lastrowid
                conn.execute(
                    "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')",
                    (gid, owner_id),
                )
                _log(conn, gid, owner_id, "group_created", f"{owner_name} created {name}.")
            return gid
        except sqlite3.IntegrityError as exc:
            if "invite_code" not in str(exc):
                raise
    raise GroupError("Couldn't generate an invite code. Please try again.")


def join_group(conn, *, user_id, user_name, code, password):
    """Returns (group_row, already_member: bool). One generic error for a bad
    code *or* bad password so the form can't be used to probe which codes exist."""
    code = normalize_invite_code(code)
    with transaction(conn):
        group = conn.execute("SELECT * FROM groups WHERE invite_code = ?", (code,)).fetchone()
        if not group or not check_password_hash(group["password_hash"], password or ""):
            raise GroupError("That invite code and password don't match a group.")
        existing = conn.execute(
            "SELECT status FROM group_members WHERE group_id = ? AND user_id = ?",
            (group["id"], user_id),
        ).fetchone()
        if existing and existing["status"] == "active":
            return group, True
        if existing:
            conn.execute(
                "UPDATE group_members SET status = 'active', joined_at = datetime('now') "
                "WHERE group_id = ? AND user_id = ?", (group["id"], user_id))
        else:
            conn.execute(
                "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
                (group["id"], user_id))
        _log(conn, group["id"], user_id, "member_joined", f"{user_name} joined the group.")
    return group, False


def add_member_by_email(conn, *, group, actor, email):
    if actor["role"] != "owner":
        raise GroupError("Only the group owner can add people by email.")
    email = (email or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 254:
        raise GroupError("Enter a valid email address.")
    with transaction(conn):
        user = conn.execute("SELECT id, name FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            raise GroupError("No account uses that email yet. Ask them to register, "
                             "or share the invite code instead.")
        existing = conn.execute(
            "SELECT status FROM group_members WHERE group_id = ? AND user_id = ?",
            (group["id"], user["id"]),
        ).fetchone()
        if existing and existing["status"] == "active":
            raise GroupError(f"{user['name']} is already in this group.")
        if existing:
            conn.execute("UPDATE group_members SET status = 'active', joined_at = datetime('now') "
                         "WHERE group_id = ? AND user_id = ?", (group["id"], user["id"]))
        else:
            conn.execute("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
                         (group["id"], user["id"]))
        _log(conn, group["id"], actor["user_id"], "member_added",
             f"{actor['name']} added {user['name']}.")
    return user["name"]


def remove_member(conn, *, group, actor, target_id):
    """Owner removes someone, or a member leaves (target == actor).
    Refused while the person still owes or is owed money: that would silently
    break the books for everyone else."""
    leaving = target_id == actor["user_id"]
    if not leaving and actor["role"] != "owner":
        raise GroupError("Only the group owner can remove people.")
    with transaction(conn):
        target = conn.execute(
            "SELECT gm.role, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id "
            "WHERE gm.group_id = ? AND gm.user_id = ? AND gm.status = 'active'",
            (group["id"], target_id),
        ).fetchone()
        if not target:
            raise GroupError("That person isn't an active member of this group.")
        if target["role"] == "owner":
            raise GroupError("The owner can't leave or be removed. Delete the group instead.")
        rows, _ = compute_balances(conn, group["id"])
        net = next((b["net"] for b in rows if b["user_id"] == target_id), 0)
        if net:
            amt = money.format_amount(abs(net), group["currency"])
            if leaving:
                state = f"You're owed {amt}" if net > 0 else f"You owe {amt}"
                raise GroupError(f"{state}. Settle up before leaving.")
            state = f"{target['name']} is owed {amt}" if net > 0 else f"{target['name']} owes {amt}"
            raise GroupError(f"{state}. Settle up before removing them.")
        conn.execute("UPDATE group_members SET status = 'removed' WHERE group_id = ? AND user_id = ?",
                     (group["id"], target_id))
        text = (f"{target['name']} left the group." if leaving
                else f"{actor['name']} removed {target['name']}.")
        _log(conn, group["id"], actor["user_id"], "member_left" if leaving else "member_removed", text)
    return target["name"]


def delete_group(conn, *, group, actor, confirm_name):
    if actor["role"] != "owner":
        raise GroupError("Only the group owner can delete the group.")
    if (confirm_name or "").strip() != group["name"]:
        raise GroupError("Type the group name exactly to confirm deletion.")
    with transaction(conn):
        conn.execute("DELETE FROM groups WHERE id = ?", (group["id"],))  # cascades to everything


# ----------------------------------------------------------------- expenses
def add_expense(conn, *, group, actor, form) -> int:
    currency = group["currency"]
    title = (form.get("title") or "").strip()
    notes = (form.get("notes") or "").strip()
    if not title:
        raise GroupError("Give the expense a title.")
    if len(title) > 120:
        raise GroupError("Title can be at most 120 characters.")
    if len(notes) > 500:
        raise GroupError("Notes can be at most 500 characters.")
    category = form.get("category") if form.get("category") in CATEGORIES else "Other"
    amount = money.parse_amount(form.get("amount"), currency, label="Amount")

    raw_date = (form.get("expense_date") or "").strip() or date.today().isoformat()
    try:
        when = date.fromisoformat(raw_date)
    except ValueError:
        raise GroupError("Enter a valid date.") from None
    if not (date(2000, 1, 1) <= when <= date.today() + timedelta(days=366)):
        raise GroupError("That date is out of range.")

    try:
        paid_by = int(form.get("paid_by", ""))
        participants = list(dict.fromkeys(int(x) for x in form.getlist("participants")))
    except ValueError:
        raise GroupError("Pick who paid and who is in the split.") from None
    if not participants:
        raise GroupError("Pick at least one person to split with.")

    method = form.get("split_method", "equal")
    if method not in SPLIT_METHODS:
        raise GroupError("Choose a valid split method.")

    with transaction(conn):  # membership is re-read inside the write lock
        names = _active_member_names(conn, group["id"])
        if paid_by not in names:
            raise GroupError("The person who paid must be an active member of this group.")
        if not set(participants) <= set(names):
            raise GroupError("Everyone in the split must be an active member of this group.")

        bps: dict[int, int] = {}
        if method == "equal":
            offset = conn.execute(
                "SELECT COUNT(*) FROM group_expenses WHERE group_id = ?", (group["id"],)
            ).fetchone()[0]
            shares = money.split_equal(amount, participants, offset)
        elif method == "exact":
            amounts = {uid: money.parse_amount(form.get(f"exact_{uid}"), currency,
                                               label=f"{names[uid]}'s amount", allow_zero=True)
                       for uid in participants}
            shares = money.split_exact(amount, amounts, currency)
        else:
            bps = {uid: money.parse_percent_bp(form.get(f"percent_{uid}"),
                                               label=f"{names[uid]}'s percentage")
                   for uid in participants}
            shares = money.split_percent(amount, bps)

        try:
            cur = conn.execute(
                "INSERT INTO group_expenses (group_id, paid_by, title, amount_minor, category, "
                "expense_date, split_method, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)",
                (group["id"], paid_by, title, amount, category, when.isoformat(), method, notes,
                 actor["user_id"]),
            )
            eid = cur.lastrowid
            conn.executemany(
                "INSERT INTO expense_splits (expense_id, group_id, user_id, share_minor, share_bp) "
                "VALUES (?,?,?,?,?)",
                [(eid, group["id"], uid, share, bps.get(uid)) for uid, share in shares.items()],
            )
        except sqlite3.IntegrityError:
            log.exception("Integrity error saving expense in group %s", group["id"])
            raise GroupError("We couldn't save that expense. Check the details and try again.") from None
        _log(conn, group["id"], actor["user_id"], "expense_added",
             f"{actor['name']} added {title} for {money.format_amount(amount, currency)}.", eid)
    return eid


def delete_expense(conn, *, group, actor, expense_id):
    with transaction(conn):
        exp = conn.execute(
            "SELECT id, title, created_by FROM group_expenses "
            "WHERE id = ? AND group_id = ? AND deleted_at IS NULL",
            (expense_id, group["id"]),
        ).fetchone()
        if not exp:
            raise GroupError("That expense no longer exists.")
        if exp["created_by"] != actor["user_id"] and actor["role"] != "owner":
            raise GroupError("Only the person who added an expense, or the group owner, can delete it.")
        conn.execute("UPDATE group_expenses SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?",
                     (actor["user_id"], exp["id"]))
        _log(conn, group["id"], actor["user_id"], "expense_deleted",
             f"{actor['name']} deleted {exp['title']}.", exp["id"])
    return exp["title"]


# -------------------------------------------------------------- settlements
def record_settlement(conn, *, group, actor, payer_id, receiver_id, amount_minor):
    if payer_id == receiver_id:
        raise GroupError("Payer and receiver must be different people.")
    if amount_minor <= 0:
        raise GroupError("Settlement amount must be greater than zero.")
    if actor["user_id"] not in (payer_id, receiver_id) and actor["role"] != "owner":
        raise GroupError("Only the payer, the receiver or the group owner can record a payment.")
    currency = group["currency"]
    with transaction(conn):
        names = _active_member_names(conn, group["id"])
        if payer_id not in names or receiver_id not in names:
            raise GroupError("Both people must be active members of this group.")
        rows, _ = compute_balances(conn, group["id"])
        net = {b["user_id"]: b["net"] for b in rows}
        cap = min(max(0, -net.get(payer_id, 0)), max(0, net.get(receiver_id, 0)))
        if cap == 0:
            raise GroupError(f"{names[payer_id]} doesn't owe {names[receiver_id]} anything right now.")
        if amount_minor > cap:
            raise GroupError(f"That's more than {names[payer_id]} owes {names[receiver_id]}. "
                             f"The most you can record is {money.format_amount(cap, currency)}.")
        conn.execute(
            "INSERT INTO settlements (group_id, payer_id, receiver_id, amount_minor, created_by) "
            "VALUES (?,?,?,?,?)",
            (group["id"], payer_id, receiver_id, amount_minor, actor["user_id"]),
        )
        _log(conn, group["id"], actor["user_id"], "settlement",
             f"{names[payer_id]} paid {names[receiver_id]} {money.format_amount(amount_minor, currency)}.")
    return names[payer_id], names[receiver_id]
