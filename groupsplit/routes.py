"""HTTP layer for Gen-ZSplit groups.  Thin by design: parse, call a service,
flash the outcome, redirect.  All rules live in services.py."""
from __future__ import annotations

from datetime import date
from functools import wraps

from flask import (Blueprint, current_app, flash, redirect, render_template,
                   request, session, url_for)

from db import get_db
from . import money, services
from .errors import GroupError
from .security import join_throttle, verify_csrf

bp = Blueprint("groups", __name__, url_prefix="/groups")

GENERIC_FAILURE = "Something went wrong on our side. Nothing was saved. Please try again."


# ------------------------------------------------------------------ guards
@bp.before_request
def _guard():
    if "user_id" not in session:
        return redirect(url_for("login"))
    if request.method == "POST" and not verify_csrf():
        flash("Your session expired. Please try that again.", "error")
        return redirect(url_for("groups.index"))


def member_required(view):
    """Resolve <group_id> into (group, me) or bounce.  Non-members and missing
    groups get the *same* message so group ids can't be enumerated."""
    @wraps(view)
    def wrapped(group_id, **kwargs):
        conn = get_db()
        me = services.get_membership(conn, group_id, session["user_id"])
        group = services.get_group(conn, group_id) if me else None
        if not me or not group:
            flash("We couldn't find that group.", "error")
            return redirect(url_for("groups.index"))
        return view(group=group, me=me, **kwargs)
    return wrapped


def attempt(fn):
    """Run a service call.  -> (ok, value).  GroupError text is shown to the
    user; anything else is logged with a traceback and replaced by a generic
    message (transaction() has already rolled the database back)."""
    try:
        return True, fn()
    except GroupError as exc:
        flash(str(exc), "error")
    except Exception:  # noqa: BLE001 - last line of defence, logged below
        current_app.logger.exception("Unhandled error in %s", request.endpoint)
        flash(GENERIC_FAILURE, "error")
    return False, None


# ------------------------------------------------------------------- pages
@bp.route("/")
def index():
    rows = services.list_user_groups(get_db(), session["user_id"])
    return render_template("groups.html", groups=rows, currencies=list(money.CURRENCIES))


def _render_detail(group, me, *, form=None, open_modal=None, error=None, status=200):
    conn = get_db()
    page = request.args.get("page", 1, type=int) or 1
    balances, transfers = services.compute_balances(conn, group["id"])
    expenses, pager = services.list_expenses(conn, group["id"], me["user_id"], page)
    my_net = next((b["net"] for b in balances if b["user_id"] == me["user_id"]), 0)
    reach = max([abs(b["net"]) for b in balances] + [1])  # scale for the balance spine
    html = render_template(
        "group_detail.html",
        group=group, me=me, is_owner=me["role"] == "owner",
        members=services.list_members(conn, group["id"]),
        balances=balances, transfers=transfers, my_net=my_net, reach=reach,
        expenses=expenses, pager=pager,
        total_minor=services.group_total(conn, group["id"]),
        activity=services.list_activity(conn, group["id"]),
        categories=services.CATEGORIES, today=date.today().isoformat(),
        form=form or {}, open_modal=open_modal, error=error,
    )
    return html, status


@bp.route("/<int:group_id>")
@member_required
def detail(group, me):
    return _render_detail(group, me, open_modal="expense" if request.args.get("add") else None)


# ----------------------------------------------------------------- groups
@bp.route("/create", methods=["POST"])
def create():
    ok, gid = attempt(lambda: services.create_group(
        get_db(), owner_id=session["user_id"], owner_name=session["user_name"],
        name=request.form.get("name"), description=request.form.get("description"),
        currency=request.form.get("currency"), password=request.form.get("password")))
    if not ok:
        return redirect(url_for("groups.index"))
    flash("Group created. Share its invite code and password with the people you want in.", "success")
    return redirect(url_for("groups.detail", group_id=gid))


@bp.route("/join", methods=["POST"])
def join():
    key = f"join:{session['user_id']}"
    wait = join_throttle.retry_after(key)
    if wait:
        flash(f"Too many failed attempts. Try again in {max(1, wait // 60)} min.", "error")
        return redirect(url_for("groups.index"))
    try:
        group, already = services.join_group(
            get_db(), user_id=session["user_id"], user_name=session["user_name"],
            code=request.form.get("code"), password=request.form.get("password"))
    except GroupError as exc:
        join_throttle.record_failure(key)
        flash(str(exc), "error")
        return redirect(url_for("groups.index"))
    except Exception:  # noqa: BLE001
        current_app.logger.exception("Unhandled error joining group")
        flash(GENERIC_FAILURE, "error")
        return redirect(url_for("groups.index"))
    join_throttle.reset(key)
    flash(f"You're already in {group['name']}." if already else f"You joined {group['name']}.",
          "info" if already else "success")
    return redirect(url_for("groups.detail", group_id=group["id"]))


@bp.route("/<int:group_id>/delete", methods=["POST"])
@member_required
def delete(group, me):
    ok, _ = attempt(lambda: services.delete_group(
        get_db(), group=group, actor=me, confirm_name=request.form.get("confirm_name")))
    if ok:
        flash(f"{group['name']} and all of its data were deleted.", "success")
        return redirect(url_for("groups.index"))
    return redirect(url_for("groups.detail", group_id=group["id"]))


# ---------------------------------------------------------------- members
@bp.route("/<int:group_id>/members", methods=["POST"])
@member_required
def add_member(group, me):
    ok, name = attempt(lambda: services.add_member_by_email(
        get_db(), group=group, actor=me, email=request.form.get("email")))
    if ok:
        flash(f"{name} is now in the group.", "success")
    return redirect(url_for("groups.detail", group_id=group["id"]))


@bp.route("/<int:group_id>/members/<int:user_id>/remove", methods=["POST"])
@member_required
def remove_member(group, me, user_id):
    ok, name = attempt(lambda: services.remove_member(
        get_db(), group=group, actor=me, target_id=user_id))
    if ok:
        flash(f"{name} was removed from the group.", "success")
    return redirect(url_for("groups.detail", group_id=group["id"]))


@bp.route("/<int:group_id>/leave", methods=["POST"])
@member_required
def leave(group, me):
    ok, _ = attempt(lambda: services.remove_member(
        get_db(), group=group, actor=me, target_id=me["user_id"]))
    if ok:
        flash(f"You left {group['name']}.", "success")
        return redirect(url_for("groups.index"))
    return redirect(url_for("groups.detail", group_id=group["id"]))


# --------------------------------------------------------------- expenses
@bp.route("/<int:group_id>/expenses", methods=["POST"])
@member_required
def add_expense(group, me):
    try:
        services.add_expense(get_db(), group=group, actor=me, form=request.form)
    except GroupError as exc:
        error = str(exc)
    except Exception:  # noqa: BLE001 - logged; transaction() already rolled back
        current_app.logger.exception("Unhandled error adding expense")
        error = GENERIC_FAILURE
    else:
        flash("Expense added and split.", "success")
        return redirect(url_for("groups.detail", group_id=group["id"]))
    # Re-render with the modal open, the error shown INSIDE it (a native <dialog>
    # sits in the top layer, so a toast would be hidden) and every field intact,
    # instead of making the user retype a six-person split over one blank box.
    return _render_detail(group, me, form=request.form, open_modal="expense", error=error, status=422)


@bp.route("/<int:group_id>/expenses/<int:expense_id>/delete", methods=["POST"])
@member_required
def delete_expense(group, me, expense_id):
    ok, title = attempt(lambda: services.delete_expense(
        get_db(), group=group, actor=me, expense_id=expense_id))
    if ok:
        flash(f"Deleted {title}.", "success")
    return redirect(url_for("groups.detail", group_id=group["id"]))


# ------------------------------------------------------------ settlements
@bp.route("/<int:group_id>/settle", methods=["POST"])
@member_required
def settle(group, me):
    def run():
        try:
            payer, receiver = int(request.form["payer_id"]), int(request.form["receiver_id"])
        except (KeyError, ValueError):
            raise GroupError("Choose who is paying whom.") from None
        amount = money.parse_amount(request.form.get("amount"), group["currency"], label="Amount")
        return services.record_settlement(get_db(), group=group, actor=me, payer_id=payer,
                                          receiver_id=receiver, amount_minor=amount)
    ok, names = attempt(run)
    if ok:
        flash(f"Recorded: {names[0]} paid {names[1]}.", "success")
    return redirect(url_for("groups.detail", group_id=group["id"]))
