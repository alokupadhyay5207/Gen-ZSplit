"""Supabase-backed group expense business logic for Gen-ZSplit."""
from __future__ import annotations

import logging
import re
import secrets
from datetime import date, datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from db import DuplicateKeyError, count, delete, fetch, get_one, insert, update
from . import money
from .errors import GroupError

log = logging.getLogger(__name__)
CATEGORIES = ["Food", "Travel", "Hotel", "Shopping", "Utilities", "Entertainment", "Other"]
SPLIT_METHODS = ("equal", "exact", "percentage")
_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PAGE_SIZE = 12


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _users_by_id(db, user_ids, columns="id,name,email"):
    """One query for many users -> {id: row}. Never selects the password hash."""
    ids = sorted({int(i) for i in user_ids})
    if not ids:
        return {}
    return {u["id"]: u for u in fetch(db, "users", {"id": ids}, columns=columns)}


def _active_member_names(db, group_id):
    members = fetch(db, "group_members", {"group_id": int(group_id), "status": "active"})
    users = _users_by_id(db, [m["user_id"] for m in members], "id,name")
    return {m["user_id"]: users[m["user_id"]]["name"] for m in members if m["user_id"] in users}


def normalize_invite_code(raw):
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def display_invite_code(code):
    return f"{code[:4]}-{code[4:]}" if len(code) == 8 else code


def _new_invite_code():
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(8))


def _log(db, group_id, actor_id, kind, text, expense_id=None):
    """Write an activity line. Best effort: a failure here must not undo the real action."""
    try:
        insert(db, "group_activity", {"group_id": group_id, "actor_id": actor_id, "kind": kind,
                                      "description": text, "expense_id": expense_id,
                                      "created_at": _now()})
    except Exception:  # noqa: BLE001
        log.exception("Could not write group activity")


def get_group(db, group_id):
    return get_one(db, "groups", {"id": int(group_id)})


def get_membership(db, group_id, user_id):
    m = get_one(db, "group_members", {"group_id": int(group_id), "user_id": int(user_id), "status": "active"})
    if not m:
        return None
    u = get_one(db, "users", {"id": int(user_id)}, columns="id,name,email")
    if not u:
        return None
    return {**m, "name": u.get("name", ""), "email": u.get("email", "")}


def list_user_groups(db, user_id):
    uid = int(user_id)
    memberships = fetch(db, "group_members", {"user_id": uid, "status": "active"})
    if not memberships:
        return []
    gids = [m["group_id"] for m in memberships]
    groups = {g["id"]: g for g in fetch(db, "groups", {"id": gids})}
    members = fetch(db, "group_members", {"group_id": gids, "status": "active"})
    expenses = fetch(db, "group_expenses", {"group_id": gids, "deleted_at": None}, order=[("id", False)])
    splits = fetch(db, "expense_splits", {"group_id": gids}, order=[("id", False)])
    settlements = fetch(db, "settlements", {"group_id": gids}, order=[("id", False)])
    activity = fetch(db, "group_activity", {"group_id": gids}, columns="id,group_id", order=[("id", False)])
    result = []
    for m in memberships:
        g = groups.get(m["group_id"])
        if not g:
            continue
        gid = g["id"]
        g_expenses = [e for e in expenses if e["group_id"] == gid]
        live_ids = {e["id"] for e in g_expenses}
        paid = sum(e["amount_minor"] for e in g_expenses if e["paid_by"] == uid)
        share = sum(s["share_minor"] for s in splits
                    if s["group_id"] == gid and s["user_id"] == uid and s["expense_id"] in live_ids)
        sent = sum(t["amount_minor"] for t in settlements if t["group_id"] == gid and t["payer_id"] == uid)
        received = sum(t["amount_minor"] for t in settlements if t["group_id"] == gid and t["receiver_id"] == uid)
        result.append({
            "id": gid, "name": g["name"], "description": g.get("description", ""),
            "currency": g.get("currency", "INR"), "role": m["role"],
            "member_count": sum(1 for x in members if x["group_id"] == gid),
            "expense_count": len(g_expenses),
            "total_minor": sum(e["amount_minor"] for e in g_expenses),
            "net_minor": paid - share + sent - received,
            "_activity_sort": max([a["id"] for a in activity if a["group_id"] == gid] or [0]),
        })
    result.sort(key=lambda g: (g["_activity_sort"], g["id"]), reverse=True)
    for row in result:
        row.pop("_activity_sort", None)
    return result


def list_members(db, group_id):
    members = fetch(db, "group_members", {"group_id": int(group_id), "status": "active"})
    users = _users_by_id(db, [m["user_id"] for m in members])
    result = []
    for m in members:
        u = users.get(m["user_id"])
        if u:
            result.append({"user_id": m["user_id"], "role": m["role"],
                           "joined_at": m.get("joined_at", ""), "name": u["name"], "email": u["email"]})
    result.sort(key=lambda x: (x["role"] != "owner", x["name"].lower()))
    return result


def list_expenses(db, group_id, user_id, page=1):
    live = fetch(db, "group_expenses", {"group_id": int(group_id), "deleted_at": None},
                 order=[("expense_date", True), ("id", True)])
    total = len(live)
    pages = max(1, -(-total // PAGE_SIZE))
    page = min(max(1, int(page or 1)), pages)
    page_rows = live[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]
    payers = _users_by_id(db, [e["paid_by"] for e in page_rows], "id,name")
    splits = fetch(db, "expense_splits", {"expense_id": [e["id"] for e in page_rows]}) if page_rows else []
    rows = []
    for e in page_rows:
        e_splits = [s for s in splits if s["expense_id"] == e["id"]]
        my_split = next((s["share_minor"] for s in e_splits if s["user_id"] == int(user_id)), None)
        rows.append({
            **e, "payer_name": payers.get(e["paid_by"], {}).get("name", ""),
            "split_count": len(e_splits), "my_share_minor": my_split,
        })
    return rows, {"page": page, "pages": pages, "total": total}


def group_total(db, group_id):
    return sum(e["amount_minor"] for e in fetch(
        db, "group_expenses", {"group_id": int(group_id), "deleted_at": None}, columns="amount_minor",
        order=[("id", False)]))


def list_activity(db, group_id, limit=20):
    rows = fetch(db, "group_activity", {"group_id": int(group_id)}, order=[("id", True)], limit=int(limit))
    return [{"kind": a["kind"], "description": a["description"], "created_at": a.get("created_at", "")}
            for a in rows]


def compute_balances(db, group_id):
    gid = int(group_id)
    members = fetch(db, "group_members", {"group_id": gid})
    users = _users_by_id(db, [m["user_id"] for m in members], "id,name")
    book = {}
    for m in members:
        u = users.get(m["user_id"])
        if u:
            book[m["user_id"]] = {"user_id": m["user_id"], "name": u["name"],
                                  "active": m.get("status") == "active",
                                  "paid": 0, "share": 0, "sent": 0, "received": 0}
    expenses = fetch(db, "group_expenses", {"group_id": gid, "deleted_at": None},
                     columns="id,paid_by,amount_minor", order=[("id", False)])
    live_ids = {e["id"] for e in expenses}
    for e in expenses:
        if e["paid_by"] in book:
            book[e["paid_by"]]["paid"] += e["amount_minor"]
    for s in fetch(db, "expense_splits", {"group_id": gid}, order=[("id", False)]):
        if s["user_id"] in book and s["expense_id"] in live_ids:
            book[s["user_id"]]["share"] += s["share_minor"]
    for t in fetch(db, "settlements", {"group_id": gid}, order=[("id", False)]):
        if t["payer_id"] in book:
            book[t["payer_id"]]["sent"] += t["amount_minor"]
        if t["receiver_id"] in book:
            book[t["receiver_id"]]["received"] += t["amount_minor"]
    rows = []
    for b in book.values():
        b["net"] = b["paid"] - b["share"] + b["sent"] - b["received"]
        if b["active"] or b["net"]:
            rows.append(b)
    rows.sort(key=lambda b: (-b["net"], b["name"].lower()))
    names = {b["user_id"]: b["name"] for b in rows}
    transfers = [{"from_id": f, "from_name": names[f], "to_id": t, "to_name": names[t], "amount": a}
                 for f, t, a in money.simplify_debts({b["user_id"]: b["net"] for b in rows})]
    return rows, transfers


def create_group(db, *, owner_id, owner_name, name, description, currency, password):
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
    for _ in range(8):
        try:
            group = insert(db, "groups", {"name": name, "description": description,
                                          "invite_code": _new_invite_code(),
                                          "password_hash": generate_password_hash(password),
                                          "owner_id": int(owner_id), "currency": currency,
                                          "created_at": _now()})
        except DuplicateKeyError:
            continue  # invite code collision: try another code
        gid = group["id"]
        try:
            insert(db, "group_members", {"group_id": gid, "user_id": int(owner_id), "role": "owner",
                                         "status": "active", "joined_at": _now()})
        except Exception:
            delete(db, "groups", {"id": gid})  # undo the half-created group
            raise
        _log(db, gid, int(owner_id), "group_created", f"{owner_name} created {name}.")
        return gid
    raise GroupError("Couldn't generate an invite code. Please try again.")


def _reactivate_or_add(db, group_id, user_id, existing):
    """Mark a former member active again, or add a brand new member."""
    if existing:
        update(db, "group_members", {"group_id": group_id, "user_id": user_id},
               {"status": "active", "joined_at": _now()})
    else:
        insert(db, "group_members", {"group_id": group_id, "user_id": user_id, "role": "member",
                                     "status": "active", "joined_at": _now()})


def join_group(db, *, user_id, user_name, code, password):
    code = normalize_invite_code(code)
    group = get_one(db, "groups", {"invite_code": code}) if code else None
    if not group or not check_password_hash(group["password_hash"], password or ""):
        raise GroupError("That invite code and password don't match a group.")
    existing = get_one(db, "group_members", {"group_id": group["id"], "user_id": int(user_id)})
    if existing and existing.get("status") == "active":
        return group, True
    try:
        _reactivate_or_add(db, group["id"], int(user_id), existing)
    except DuplicateKeyError:
        return group, True  # double-click: already added a moment ago
    _log(db, group["id"], int(user_id), "member_joined", f"{user_name} joined the group.")
    return group, False


def add_member_by_email(db, *, group, actor, email):
    if actor["role"] != "owner":
        raise GroupError("Only the group owner can add people by email.")
    email = (email or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 254:
        raise GroupError("Enter a valid email address.")
    user = get_one(db, "users", {"email": email}, columns="id,name,email")
    if not user:
        raise GroupError("No account uses that email yet. Ask them to register, or share the invite code instead.")
    existing = get_one(db, "group_members", {"group_id": group["id"], "user_id": user["id"]})
    if existing and existing.get("status") == "active":
        raise GroupError(f"{user['name']} is already in this group.")
    _reactivate_or_add(db, group["id"], user["id"], existing)
    _log(db, group["id"], actor["user_id"], "member_added", f"{actor['name']} added {user['name']}.")
    return user["name"]


def remove_member(db, *, group, actor, target_id):
    target_id = int(target_id)
    leaving = target_id == int(actor["user_id"])
    if not leaving and actor["role"] != "owner":
        raise GroupError("Only the group owner can remove people.")
    target = get_one(db, "group_members", {"group_id": group["id"], "user_id": target_id, "status": "active"})
    if not target:
        raise GroupError("That person isn't an active member of this group.")
    if target["role"] == "owner":
        raise GroupError("The owner can't leave or be removed. Delete the group instead.")
    rows, _ = compute_balances(db, group["id"])
    net = next((b["net"] for b in rows if b["user_id"] == target_id), 0)
    user = get_one(db, "users", {"id": target_id}, columns="id,name") or {"name": "This member"}
    if net:
        amt = money.format_amount(abs(net), group["currency"])
        if leaving:
            state = f"You're owed {amt}" if net > 0 else f"You owe {amt}"
            raise GroupError(f"{state}. Settle up before leaving.")
        state = f"{user['name']} is owed {amt}" if net > 0 else f"{user['name']} owes {amt}"
        raise GroupError(f"{state}. Settle up before removing them.")
    update(db, "group_members", {"group_id": group["id"], "user_id": target_id}, {"status": "removed"})
    text = f"{user['name']} left the group." if leaving else f"{actor['name']} removed {user['name']}."
    _log(db, group["id"], actor["user_id"], "member_left" if leaving else "member_removed", text)
    return user["name"]


def delete_group(db, *, group, actor, confirm_name):
    if actor["role"] != "owner":
        raise GroupError("Only the group owner can delete the group.")
    if (confirm_name or "").strip() != group["name"]:
        raise GroupError("Type the group name exactly to confirm deletion.")
    gid = group["id"]
    for table in ("expense_splits", "settlements", "group_activity", "group_expenses", "group_members"):
        delete(db, table, {"group_id": gid})
    delete(db, "groups", {"id": gid})


def add_expense(db, *, group, actor, form):
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
    except (ValueError, TypeError):
        raise GroupError("Pick who paid and who is in the split.") from None
    if not participants:
        raise GroupError("Pick at least one person to split with.")
    method = form.get("split_method", "equal")
    if method not in SPLIT_METHODS:
        raise GroupError("Choose a valid split method.")
    names = _active_member_names(db, group["id"])
    if paid_by not in names:
        raise GroupError("The person who paid must be an active member of this group.")
    if not set(participants) <= set(names):
        raise GroupError("Everyone in the split must be an active member of this group.")
    bps = {}
    if method == "equal":
        offset = count(db, "group_expenses", {"group_id": group["id"]})
        shares = money.split_equal(amount, participants, offset)
    elif method == "exact":
        amounts = {uid: money.parse_amount(form.get(f"exact_{uid}"), currency,
                   label=f"{names[uid]}'s amount", allow_zero=True) for uid in participants}
        shares = money.split_exact(amount, amounts, currency)
    else:
        bps = {uid: money.parse_percent_bp(form.get(f"percent_{uid}"), label=f"{names[uid]}'s percentage")
               for uid in participants}
        shares = money.split_percent(amount, bps)
    expense = insert(db, "group_expenses", {"group_id": group["id"], "paid_by": paid_by,
        "title": title, "amount_minor": amount, "category": category, "expense_date": when.isoformat(),
        "split_method": method, "notes": notes, "created_by": actor["user_id"],
        "deleted_at": None, "deleted_by": None, "created_at": _now()})
    eid = expense["id"]
    try:
        insert(db, "expense_splits", [{"expense_id": eid, "group_id": group["id"], "user_id": uid,
                                       "share_minor": share, "share_bp": bps.get(uid)}
                                      for uid, share in shares.items()])
    except Exception:
        delete(db, "group_expenses", {"id": eid})  # no expense without its splits
        raise
    _log(db, group["id"], actor["user_id"], "expense_added",
         f"{actor['name']} added {title} for {money.format_amount(amount, currency)}.", eid)
    return eid


def delete_expense(db, *, group, actor, expense_id):
    exp = get_one(db, "group_expenses", {"id": int(expense_id), "group_id": group["id"], "deleted_at": None})
    if not exp:
        raise GroupError("That expense no longer exists.")
    if exp["created_by"] != actor["user_id"] and actor["role"] != "owner":
        raise GroupError("Only the person who added an expense, or the group owner, can delete it.")
    update(db, "group_expenses", {"id": exp["id"]}, {"deleted_at": _now(), "deleted_by": actor["user_id"]})
    _log(db, group["id"], actor["user_id"], "expense_deleted", f"{actor['name']} deleted {exp['title']}.", exp["id"])
    return exp["title"]


def record_settlement(db, *, group, actor, payer_id, receiver_id, amount_minor):
    payer_id, receiver_id = int(payer_id), int(receiver_id)
    if payer_id == receiver_id:
        raise GroupError("Payer and receiver must be different people.")
    if amount_minor <= 0:
        raise GroupError("Settlement amount must be greater than zero.")
    if actor["user_id"] not in (payer_id, receiver_id) and actor["role"] != "owner":
        raise GroupError("Only the payer, the receiver or the group owner can record a payment.")
    names = _active_member_names(db, group["id"])
    if payer_id not in names or receiver_id not in names:
        raise GroupError("Both people must be active members of this group.")
    rows, _ = compute_balances(db, group["id"])
    net = {b["user_id"]: b["net"] for b in rows}
    cap = min(max(0, -net.get(payer_id, 0)), max(0, net.get(receiver_id, 0)))
    if cap == 0:
        raise GroupError(f"{names[payer_id]} doesn't owe {names[receiver_id]} anything right now.")
    if amount_minor > cap:
        raise GroupError(f"That's more than {names[payer_id]} owes {names[receiver_id]}. "
                         f"The most you can record is {money.format_amount(cap, group['currency'])}.")
    insert(db, "settlements", {"group_id": group["id"], "payer_id": payer_id,
        "receiver_id": receiver_id, "amount_minor": amount_minor,
        "created_by": actor["user_id"], "created_at": _now()})
    _log(db, group["id"], actor["user_id"], "settlement",
         f"{names[payer_id]} paid {names[receiver_id]} {money.format_amount(amount_minor, group['currency'])}.")
    return names[payer_id], names[receiver_id]