"""MongoDB-backed group expense business logic for Gen-ZSplit."""
from __future__ import annotations

import logging
import re
import secrets
from datetime import date, datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from db import next_id
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


def _active_member_names(db, group_id):
    out = {}
    for m in db.group_members.find({"group_id": group_id, "status": "active"}):
        u = db.users.find_one({"id": m["user_id"]}, {"name": 1})
        if u:
            out[m["user_id"]] = u["name"]
    return out


def normalize_invite_code(raw):
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def display_invite_code(code):
    return f"{code[:4]}-{code[4:]}" if len(code) == 8 else code


def _new_invite_code():
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(8))


def _log(db, group_id, actor_id, kind, text, expense_id=None):
    db.group_activity.insert_one({
        "id": next_id(db, "group_activity"), "group_id": group_id,
        "actor_id": actor_id, "kind": kind, "description": text,
        "expense_id": expense_id, "created_at": _now(),
    })


def get_group(db, group_id):
    return db.groups.find_one({"id": int(group_id)})


def get_membership(db, group_id, user_id):
    m = db.group_members.find_one({"group_id": int(group_id), "user_id": int(user_id), "status": "active"})
    if not m:
        return None
    u = db.users.find_one({"id": int(user_id)})
    if not u:
        return None
    return {**m, "name": u.get("name", ""), "email": u.get("email", "")}


def list_user_groups(db, user_id):
    result = []
    memberships = list(db.group_members.find({"user_id": int(user_id), "status": "active"}))
    for m in memberships:
        g = db.groups.find_one({"id": m["group_id"]})
        if not g:
            continue
        members = list(db.group_members.find({"group_id": g["id"], "status": "active"}))
        expenses = list(db.group_expenses.find({"group_id": g["id"], "deleted_at": None}))
        splits = list(db.expense_splits.find({"group_id": g["id"]}))
        settlements = list(db.settlements.find({"group_id": g["id"]}))
        paid = sum(e["amount_minor"] for e in expenses if e["paid_by"] == int(user_id))
        share = sum(s["share_minor"] for s in splits if s["user_id"] == int(user_id)
                    and any(e["id"] == s["expense_id"] for e in expenses))
        sent = sum(t["amount_minor"] for t in settlements if t["payer_id"] == int(user_id))
        received = sum(t["amount_minor"] for t in settlements if t["receiver_id"] == int(user_id))
        result.append({
            "id": g["id"], "name": g["name"], "description": g.get("description", ""),
            "currency": g.get("currency", "INR"), "role": m["role"],
            "member_count": len(members), "expense_count": len(expenses),
            "total_minor": sum(e["amount_minor"] for e in expenses),
            "net_minor": paid - share + sent - received,
            "_activity_sort": max([a.get("id", 0) for a in db.group_activity.find({"group_id": g["id"]})] or [0]),
        })
    result.sort(key=lambda g: (g["_activity_sort"], g["id"]), reverse=True)
    for row in result:
        row.pop("_activity_sort", None)
    return result


def list_members(db, group_id):
    result = []
    for m in db.group_members.find({"group_id": int(group_id), "status": "active"}):
        u = db.users.find_one({"id": m["user_id"]})
        if u:
            result.append({"user_id": m["user_id"], "role": m["role"],
                           "joined_at": m.get("joined_at", ""), "name": u["name"], "email": u["email"]})
    result.sort(key=lambda x: (x["role"] != "owner", x["name"].lower()))
    return result


def list_expenses(db, group_id, user_id, page=1):
    live = list(db.group_expenses.find({"group_id": int(group_id), "deleted_at": None}))
    live.sort(key=lambda e: (e.get("expense_date", ""), e["id"]), reverse=True)
    total = len(live)
    pages = max(1, -(-total // PAGE_SIZE))
    page = min(max(1, int(page or 1)), pages)
    page_rows = live[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]
    rows = []
    for e in page_rows:
        payer = db.users.find_one({"id": e["paid_by"]}, {"name": 1}) or {}
        splits = list(db.expense_splits.find({"expense_id": e["id"]}))
        my_split = next((s["share_minor"] for s in splits if s["user_id"] == int(user_id)), None)
        rows.append({
            **e, "payer_name": payer.get("name", ""), "split_count": len(splits),
            "my_share_minor": my_split,
        })
    return rows, {"page": page, "pages": pages, "total": total}


def group_total(db, group_id):
    return sum(e["amount_minor"] for e in db.group_expenses.find(
        {"group_id": int(group_id), "deleted_at": None}))


def list_activity(db, group_id, limit=20):
    rows = list(db.group_activity.find({"group_id": int(group_id)}))
    rows.sort(key=lambda a: a.get("id", 0), reverse=True)
    return [{"kind": a["kind"], "description": a["description"], "created_at": a.get("created_at", "")}
            for a in rows[:int(limit)]]


def compute_balances(db, group_id):
    members = list(db.group_members.find({"group_id": int(group_id)}))
    book = {}
    for m in members:
        u = db.users.find_one({"id": m["user_id"]}, {"name": 1})
        if u:
            book[m["user_id"]] = {"user_id": m["user_id"], "name": u["name"],
                                  "active": m.get("status") == "active",
                                  "paid": 0, "share": 0, "sent": 0, "received": 0}
    expenses = list(db.group_expenses.find({"group_id": int(group_id), "deleted_at": None}))
    for e in expenses:
        if e["paid_by"] in book:
            book[e["paid_by"]]["paid"] += e["amount_minor"]
    for s in db.expense_splits.find({"group_id": int(group_id)}):
        if s["user_id"] in book and any(e["id"] == s["expense_id"] for e in expenses):
            book[s["user_id"]]["share"] += s["share_minor"]
    for t in db.settlements.find({"group_id": int(group_id)}):
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
        code = _new_invite_code()
        if db.groups.find_one({"invite_code": code}):
            continue
        gid = next_id(db, "groups")
        db.groups.insert_one({"id": gid, "name": name, "description": description,
            "invite_code": code, "password_hash": generate_password_hash(password),
            "owner_id": int(owner_id), "currency": currency, "created_at": _now()})
        db.group_members.insert_one({"group_id": gid, "user_id": int(owner_id), "role": "owner",
                                      "status": "active", "joined_at": _now()})
        _log(db, gid, int(owner_id), "group_created", f"{owner_name} created {name}.")
        return gid
    raise GroupError("Couldn't generate an invite code. Please try again.")


def join_group(db, *, user_id, user_name, code, password):
    code = normalize_invite_code(code)
    group = db.groups.find_one({"invite_code": code})
    if not group or not check_password_hash(group["password_hash"], password or ""):
        raise GroupError("That invite code and password don't match a group.")
    existing = db.group_members.find_one({"group_id": group["id"], "user_id": int(user_id)})
    if existing and existing.get("status") == "active":
        return group, True
    if existing:
        db.group_members.update_one({"_id": existing["_id"]},
                                    {"$set": {"status": "active", "joined_at": _now()}})
    else:
        db.group_members.insert_one({"group_id": group["id"], "user_id": int(user_id),
                                     "role": "member", "status": "active", "joined_at": _now()})
    _log(db, group["id"], int(user_id), "member_joined", f"{user_name} joined the group.")
    return group, False


def add_member_by_email(db, *, group, actor, email):
    if actor["role"] != "owner":
        raise GroupError("Only the group owner can add people by email.")
    email = (email or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 254:
        raise GroupError("Enter a valid email address.")
    user = db.users.find_one({"email": email})
    if not user:
        raise GroupError("No account uses that email yet. Ask them to register, or share the invite code instead.")
    existing = db.group_members.find_one({"group_id": group["id"], "user_id": user["id"]})
    if existing and existing.get("status") == "active":
        raise GroupError(f"{user['name']} is already in this group.")
    if existing:
        db.group_members.update_one({"_id": existing["_id"]}, {"$set": {"status": "active", "joined_at": _now()}})
    else:
        db.group_members.insert_one({"group_id": group["id"], "user_id": user["id"],
                                     "role": "member", "status": "active", "joined_at": _now()})
    _log(db, group["id"], actor["user_id"], "member_added", f"{actor['name']} added {user['name']}.")
    return user["name"]


def remove_member(db, *, group, actor, target_id):
    target_id = int(target_id)
    leaving = target_id == int(actor["user_id"])
    if not leaving and actor["role"] != "owner":
        raise GroupError("Only the group owner can remove people.")
    target = db.group_members.find_one({"group_id": group["id"], "user_id": target_id, "status": "active"})
    if not target:
        raise GroupError("That person isn't an active member of this group.")
    if target["role"] == "owner":
        raise GroupError("The owner can't leave or be removed. Delete the group instead.")
    rows, _ = compute_balances(db, group["id"])
    net = next((b["net"] for b in rows if b["user_id"] == target_id), 0)
    if net:
        amt = money.format_amount(abs(net), group["currency"])
        if leaving:
            state = f"You're owed {amt}" if net > 0 else f"You owe {amt}"
            raise GroupError(f"{state}. Settle up before leaving.")
        user = db.users.find_one({"id": target_id}) or {"name": "This member"}
        state = f"{user['name']} is owed {amt}" if net > 0 else f"{user['name']} owes {amt}"
        raise GroupError(f"{state}. Settle up before removing them.")
    db.group_members.update_one({"_id": target["_id"]}, {"$set": {"status": "removed"}})
    user = db.users.find_one({"id": target_id}) or {"name": "Member"}
    text = f"{user['name']} left the group." if leaving else f"{actor['name']} removed {user['name']}."
    _log(db, group["id"], actor["user_id"], "member_left" if leaving else "member_removed", text)
    return user["name"]


def delete_group(db, *, group, actor, confirm_name):
    if actor["role"] != "owner":
        raise GroupError("Only the group owner can delete the group.")
    if (confirm_name or "").strip() != group["name"]:
        raise GroupError("Type the group name exactly to confirm deletion.")
    gid = group["id"]
    for collection in ("group_members", "group_expenses", "expense_splits", "settlements", "group_activity"):
        db[collection].delete_many({"group_id": gid})
    db.groups.delete_one({"id": gid})


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
        offset = db.group_expenses.count_documents({"group_id": group["id"]})
        shares = money.split_equal(amount, participants, offset)
    elif method == "exact":
        amounts = {uid: money.parse_amount(form.get(f"exact_{uid}"), currency,
                   label=f"{names[uid]}'s amount", allow_zero=True) for uid in participants}
        shares = money.split_exact(amount, amounts, currency)
    else:
        bps = {uid: money.parse_percent_bp(form.get(f"percent_{uid}"), label=f"{names[uid]}'s percentage")
               for uid in participants}
        shares = money.split_percent(amount, bps)
    eid = next_id(db, "group_expenses")
    db.group_expenses.insert_one({"id": eid, "group_id": group["id"], "paid_by": paid_by,
        "title": title, "amount_minor": amount, "category": category, "expense_date": when.isoformat(),
        "split_method": method, "notes": notes, "created_by": actor["user_id"],
        "deleted_at": None, "deleted_by": None, "created_at": _now()})
    db.expense_splits.insert_many([{"id": next_id(db, "expense_splits"), "expense_id": eid,
        "group_id": group["id"], "user_id": uid, "share_minor": share, "share_bp": bps.get(uid)}
        for uid, share in shares.items()])
    _log(db, group["id"], actor["user_id"], "expense_added",
         f"{actor['name']} added {title} for {money.format_amount(amount, currency)}.", eid)
    return eid


def delete_expense(db, *, group, actor, expense_id):
    exp = db.group_expenses.find_one({"id": int(expense_id), "group_id": group["id"], "deleted_at": None})
    if not exp:
        raise GroupError("That expense no longer exists.")
    if exp["created_by"] != actor["user_id"] and actor["role"] != "owner":
        raise GroupError("Only the person who added an expense, or the group owner, can delete it.")
    db.group_expenses.update_one({"_id": exp["_id"]}, {"$set": {"deleted_at": _now(), "deleted_by": actor["user_id"]}})
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
    db.settlements.insert_one({"id": next_id(db, "settlements"), "group_id": group["id"],
        "payer_id": payer_id, "receiver_id": receiver_id, "amount_minor": amount_minor,
        "created_by": actor["user_id"], "created_at": _now()})
    _log(db, group["id"], actor["user_id"], "settlement",
         f"{names[payer_id]} paid {names[receiver_id]} {money.format_amount(amount_minor, group['currency'])}.")
    return names[payer_id], names[receiver_id]
