"""Pure money maths for group splitting - no Flask, no database.

All amounts are **integer minor units** (paise, cents).  Every splitting
function guarantees ``sum(shares) == total`` exactly; the property tests in
``tests/test_money.py`` hammer that with thousands of random inputs.
"""
from __future__ import annotations

import re
from decimal import Decimal

from .errors import GroupError

# currency -> (display prefix, decimal places)
CURRENCIES: dict[str, tuple[str, int]] = {
    "INR": ("\u20b9", 2),
    "USD": ("$", 2),
    "EUR": ("\u20ac", 2),
    "GBP": ("\u00a3", 2),
    "AED": ("AED\u00a0", 2),
    "JPY": ("\u00a5", 0),
}

MAX_MAJOR_UNITS = Decimal("10000000")  # 1 crore: a sanity ceiling, not a business rule


class MoneyError(GroupError):
    """A user-facing money validation problem. The message is safe to flash."""


def exponent(currency: str) -> int:
    return CURRENCIES.get(currency, CURRENCIES["INR"])[1]


# ----------------------------------------------------------------- parsing
_NUMBER = re.compile(r"^[0-9]+(\.[0-9]+)?$")


def _clean_number(raw: str | None, label: str) -> Decimal:
    """Strict plain-decimal parse: digits with an optional fraction.  No
    exponents ('1e999999'), no NaN/Infinity, no signs, no whitespace tricks."""
    text = (raw or "").replace(",", "").strip()
    if not text:
        raise MoneyError(f"{label} is required.")
    if text.startswith("-"):
        raise MoneyError(f"{label} cannot be negative.")
    if not _NUMBER.match(text) or len(text) > 20:
        raise MoneyError(f"{label} must be a number.")
    return Decimal(text)


def parse_amount(raw: str | None, currency: str = "INR", *, label: str = "Amount",
                 allow_zero: bool = False) -> int:
    """'1,250.50' -> 125050 (minor units)."""
    value = _clean_number(raw, label)
    exp = exponent(currency)
    if value != value.quantize(Decimal(1).scaleb(-exp)):
        places = "whole numbers only" if exp == 0 else f"at most {exp} decimal places"
        raise MoneyError(f"{label} allows {places}.")
    if value == 0 and not allow_zero:
        raise MoneyError(f"{label} must be greater than zero.")
    if value > MAX_MAJOR_UNITS:
        raise MoneyError(f"{label} is too large.")
    return int(value.scaleb(exp))


def parse_percent_bp(raw: str | None, *, label: str) -> int:
    """'33.33' -> 3333 basis points (1% = 100 bp). Max 2 decimals."""
    value = _clean_number(raw, label)
    if value > 100:
        raise MoneyError(f"{label} cannot be more than 100%.")
    if value != value.quantize(Decimal("0.01")):
        raise MoneyError(f"{label} allows at most 2 decimal places.")
    return int(value.scaleb(2))


# -------------------------------------------------------------- formatting
def _group_digits(digits: str, indian: bool) -> str:
    if len(digits) <= 3:
        return digits
    if not indian:
        out = []
        while digits:
            out.append(digits[-3:])
            digits = digits[:-3]
        return ",".join(reversed(out))
    head, tail = digits[:-3], digits[-3:]
    parts = []
    while head:
        parts.append(head[-2:])
        head = head[:-2]
    return ",".join(reversed(parts)) + "," + tail


def format_amount(minor: int, currency: str = "INR", *, signed: bool = False) -> str:
    """125050 -> '\u20b91,250.50' (Indian digit grouping for INR)."""
    symbol, exp = CURRENCIES.get(currency, CURRENCIES["INR"])
    sign = "-" if minor < 0 else ("+" if signed and minor > 0 else "")
    mag = abs(int(minor))
    whole, frac = divmod(mag, 10 ** exp) if exp else (mag, 0)
    body = _group_digits(str(whole), indian=(currency == "INR"))
    if exp:
        body += "." + str(frac).zfill(exp)
    return f"{sign}{symbol}{body}"


def to_input_value(minor: int, currency: str) -> str:
    """Plain machine value for <input value=...> (no symbol, no commas)."""
    exp = exponent(currency)
    if not exp:
        return str(minor)
    whole, frac = divmod(minor, 10 ** exp)
    return f"{whole}.{str(frac).zfill(exp)}"


# ---------------------------------------------------------------- splitting
def split_equal(total: int, user_ids: list[int], offset: int = 0) -> dict[int, int]:
    """Equal split. The indivisible remainder (always < len(user_ids) minor
    units) is handed out one unit at a time starting at ``offset`` so the same
    person does not absorb every stray paisa across many expenses."""
    n = len(user_ids)
    if n == 0:
        raise MoneyError("Select at least one person to split with.")
    ordered = sorted(user_ids)
    base, remainder = divmod(total, n)
    shares = {uid: base for uid in ordered}
    for i in range(remainder):
        shares[ordered[(offset + i) % n]] += 1
    return shares


def split_exact(total: int, amounts: dict[int, int], currency: str = "INR") -> dict[int, int]:
    diff = total - sum(amounts.values())
    if diff:
        how = "short of" if diff > 0 else "over"
        raise MoneyError(
            f"Amounts are {format_amount(abs(diff), currency)} {how} the total "
            f"{format_amount(total, currency)}. They must add up exactly."
        )
    return dict(amounts)


def split_percent(total: int, bps: dict[int, int]) -> dict[int, int]:
    """Largest-remainder apportionment: floor every share, then give the
    leftover units to the people with the biggest fractional remainders."""
    got = sum(bps.values())
    if got != 10000:
        raise MoneyError(f"Percentages add up to {got / 100:g}%. They must total exactly 100%.")
    floors, rems = {}, []
    for uid in sorted(bps):
        numer = total * bps[uid]
        floors[uid], rem = divmod(numer, 10000)
        rems.append((-rem, uid))
    leftover = total - sum(floors.values())
    rems.sort()  # biggest remainder first; user id breaks ties deterministically
    for _, uid in rems[:leftover]:
        floors[uid] += 1
    return floors


# --------------------------------------------------------- debt simplification
def simplify_debts(nets: dict[int, int]) -> list[tuple[int, int, int]]:
    """Greedy min-cash-flow. ``nets[uid] > 0`` means the group owes uid.
    Returns [(from_uid, to_uid, amount)] using at most n-1 transfers."""
    creditors = sorted(((a, u) for u, a in nets.items() if a > 0), key=lambda x: (-x[0], x[1]))
    debtors = sorted(((-a, u) for u, a in nets.items() if a < 0), key=lambda x: (-x[0], x[1]))
    creditors = [list(c) for c in creditors]
    debtors = [list(d) for d in debtors]
    transfers, i, j = [], 0, 0
    while i < len(debtors) and j < len(creditors):
        pay = min(debtors[i][0], creditors[j][0])
        if pay > 0:
            transfers.append((debtors[i][1], creditors[j][1], pay))
        debtors[i][0] -= pay
        creditors[j][0] -= pay
        if debtors[i][0] == 0:
            i += 1
        if creditors[j][0] == 0:
            j += 1
    return transfers
