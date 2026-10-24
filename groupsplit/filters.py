"""Jinja filters for the group templates."""
from __future__ import annotations

from datetime import date, datetime, timezone

from . import money, services


def money_filter(minor, currency="INR", signed=False):
    return money.format_amount(int(minor or 0), currency, signed=bool(signed))


def initials(name: str) -> str:
    parts = (name or "?").split()
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()


def hue(seed: str) -> int:
    """Stable colour for an avatar / group glyph, kept inside the brand's
    blue -> indigo -> violet -> magenta band so every hue sits in the palette."""
    return 205 + (sum(ord(c) * (i + 3) for i, c in enumerate(seed or "?")) % 130)


def ago(stamp: str) -> str:
    """'2026-10-11 09:30:00' (UTC, from SQLite) -> '5 min ago' / '3 h ago' / '12 Oct'."""
    try:
        then = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return stamp or ""
    secs = (datetime.now(timezone.utc) - then).total_seconds()
    if secs < 60:
        return "just now"
    if secs < 3600:
        return f"{int(secs // 60)} min ago"
    if secs < 86400:
        return f"{int(secs // 3600)} h ago"
    if secs < 7 * 86400:
        return f"{int(secs // 86400)} d ago"
    return f"{then.day} {then.strftime('%b')}"


def short_date(iso: str) -> str:
    try:
        d = date.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    return f"{d.day} {d.strftime('%b')}" + ("" if d.year == date.today().year else f" {d.year}")


def register(app):
    app.add_template_filter(money_filter, "money")
    app.add_template_filter(initials, "initials")
    app.add_template_filter(hue, "hue")
    app.add_template_filter(ago, "ago")
    app.add_template_filter(short_date, "short_date")
    app.add_template_filter(services.display_invite_code, "invite")
    app.jinja_env.globals["to_input_value"] = money.to_input_value
    app.jinja_env.globals["CURRENCY_SYMBOLS"] = {c: s.strip() for c, (s, _) in money.CURRENCIES.items()}
    app.jinja_env.globals["CURRENCY_EXPONENT"] = {c: e for c, (_, e) in money.CURRENCIES.items()}
