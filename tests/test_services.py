import os
import unittest
from unittest import mock

from werkzeug.datastructures import MultiDict

from tests.helpers import add_users, counts, fresh_db
from groupsplit import services
from groupsplit.errors import GroupError


def form(title="Dinner", amount="300", paid_by=None, method="equal", people=(), **extra):
    f = MultiDict({"title": title, "amount": amount, "paid_by": str(paid_by), "split_method": method,
                   "category": "Food", **extra})
    for p in people:
        f.add("participants", str(p))
    return f


class Workflow(unittest.TestCase):
    def setUp(self):
        self.conn, self.path = fresh_db()
        self.a, self.b, self.c, self.d = add_users(self.conn, "Alice", "Bob", "Cara", "Dev")
        self.gid = services.create_group(self.conn, owner_id=self.a, owner_name="Alice", name="Goa Trip",
                                         description="", currency="INR", password="secret1")
        self.group = services.get_group(self.conn, self.gid)
        self.owner = services.get_membership(self.conn, self.gid, self.a)
        for email in ("bob@example.com", "cara@example.com"):
            services.add_member_by_email(self.conn, group=self.group, actor=self.owner, email=email)
        self.bob = services.get_membership(self.conn, self.gid, self.b)
        self.cara = services.get_membership(self.conn, self.gid, self.c)

    def tearDown(self):
        self.conn.close()
        os.remove(self.path)

    def net(self):
        rows, transfers = services.compute_balances(self.conn, self.gid)
        return {r["name"]: r["net"] for r in rows}, transfers

    # ---- joining
    def test_join_by_code_and_password_only(self):
        code = self.group["invite_code"]
        with self.assertRaisesRegex(GroupError, "don't match"):
            services.join_group(self.conn, user_id=self.d, user_name="Dev", code=code, password="wrong!!")
        with self.assertRaisesRegex(GroupError, "don't match"):          # same message: no probing
            services.join_group(self.conn, user_id=self.d, user_name="Dev", code="ZZZZZZZZ", password="secret1")
        g, already = services.join_group(self.conn, user_id=self.d, user_name="Dev",
                                         code=services.display_invite_code(code).lower(), password="secret1")
        self.assertEqual((g["id"], already), (self.gid, False))
        _, already = services.join_group(self.conn, user_id=self.d, user_name="Dev", code=code, password="secret1")
        self.assertTrue(already)

    def test_two_groups_with_the_same_name_are_both_joinable(self):
        """Regression: the old join-by-name made the second group unreachable."""
        g2 = services.create_group(self.conn, owner_id=self.d, owner_name="Dev", name="Goa Trip",
                                   description="", currency="INR", password="other-pw")
        code2 = services.get_group(self.conn, g2)["invite_code"]
        g, _ = services.join_group(self.conn, user_id=self.b, user_name="Bob", code=code2, password="other-pw")
        self.assertEqual(g["id"], g2)

    def test_group_validation(self):
        kw = dict(owner_id=self.a, owner_name="Alice", description="", currency="INR", password="secret1")
        for bad in [dict(name="x"), dict(name="y" * 61), dict(name="   "), dict(currency="BTC"),
                    dict(password="short"), dict(description="d" * 281)]:
            with self.subTest(**bad), self.assertRaises(GroupError):
                services.create_group(self.conn, **{**kw, "name": "Valid", **bad})

    # ---- members
    def test_add_member_validation(self):
        for email, msg in [("nobody@example.com", "No account"), ("not-an-email", "valid email"),
                           ("bob@example.com", "already in")]:
            with self.subTest(email=email), self.assertRaisesRegex(GroupError, msg):
                services.add_member_by_email(self.conn, group=self.group, actor=self.owner, email=email)
        with self.assertRaisesRegex(GroupError, "Only the group owner"):
            services.add_member_by_email(self.conn, group=self.group, actor=self.bob, email="dev@example.com")

    def test_remove_and_leave_blocked_while_money_is_owed(self):
        services.add_expense(self.conn, group=self.group, actor=self.owner,
                             form=form(paid_by=self.a, people=[self.a, self.b, self.c]))
        with self.assertRaisesRegex(GroupError, "owes ₹100.00"):
            services.remove_member(self.conn, group=self.group, actor=self.owner, target_id=self.b)
        with self.assertRaisesRegex(GroupError, "You owe ₹100.00"):
            services.remove_member(self.conn, group=self.group, actor=self.bob, target_id=self.b)
        with self.assertRaisesRegex(GroupError, "Only the group owner"):
            services.remove_member(self.conn, group=self.group, actor=self.bob, target_id=self.c)
        with self.assertRaisesRegex(GroupError, "owner can't leave"):
            services.remove_member(self.conn, group=self.group, actor=self.owner, target_id=self.a)

    def test_leave_after_settling_then_rejoin(self):
        services.add_expense(self.conn, group=self.group, actor=self.owner,
                             form=form(paid_by=self.a, people=[self.a, self.b, self.c]))
        services.record_settlement(self.conn, group=self.group, actor=self.bob, payer_id=self.b,
                                   receiver_id=self.a, amount_minor=10000)
        services.remove_member(self.conn, group=self.group, actor=self.bob, target_id=self.b)
        self.assertIsNone(services.get_membership(self.conn, self.gid, self.b))
        self.assertEqual(self.net()[0].get("Bob"), None)           # gone from the live ledger
        services.join_group(self.conn, user_id=self.b, user_name="Bob", code=self.group["invite_code"], password="secret1")
        self.assertIsNotNone(services.get_membership(self.conn, self.gid, self.b))
        self.assertEqual(self.net()[0]["Bob"], 0)                  # history intact, balanced

    # ---- expenses
    def test_equal_split_three_ways_conserves_every_paisa(self):
        services.add_expense(self.conn, group=self.group, actor=self.owner,
                             form=form(amount="100", paid_by=self.a, people=[self.a, self.b, self.c]))
        nets, _ = self.net()
        self.assertEqual(sum(nets.values()), 0)
        # 10000 / 3 = 3333 r1: the stray paisa goes to the first person (offset 0 = Alice, who also paid)
        self.assertEqual((nets["Alice"], nets["Bob"], nets["Cara"]), (6666, -3333, -3333))
        # ...and rotates: the NEXT expense's stray paisa goes to Bob, so nobody is always the one who loses it
        services.add_expense(self.conn, group=self.group, actor=self.owner,
                             form=form(amount="100", paid_by=self.a, people=[self.a, self.b, self.c]))
        shares = [r[0] for r in self.conn.execute(
            "SELECT share_minor FROM expense_splits WHERE expense_id=(SELECT MAX(id) FROM group_expenses) ORDER BY user_id")]
        self.assertEqual(shares, [3333, 3334, 3333])

    def test_exact_and_percentage(self):
        ids = [self.a, self.b, self.c]
        services.add_expense(self.conn, group=self.group, actor=self.owner, form=form(
            amount="100", paid_by=self.a, method="exact", people=ids,
            **{f"exact_{self.a}": "10", f"exact_{self.b}": "30.50", f"exact_{self.c}": "59.50"}))
        services.add_expense(self.conn, group=self.group, actor=self.owner, form=form(
            amount="100", paid_by=self.b, method="percentage", people=ids,
            **{f"percent_{self.a}": "33.33", f"percent_{self.b}": "33.33", f"percent_{self.c}": "33.34"}))
        nets, _ = self.net()
        self.assertEqual(sum(nets.values()), 0)
        bps = self.conn.execute("SELECT share_bp FROM expense_splits WHERE share_bp IS NOT NULL ORDER BY share_bp").fetchall()
        self.assertEqual([r[0] for r in bps], [3333, 3333, 3334])

    def test_invalid_splits_are_rejected_with_helpful_text_and_save_nothing(self):
        ids = [self.a, self.b]
        cases = [
            (dict(method="exact", **{f"exact_{self.a}": "10", f"exact_{self.b}": "10"}), "short of"),
            (dict(method="exact", **{f"exact_{self.a}": "10"}), "Bob's amount is required"),
            (dict(method="exact", **{f"exact_{self.a}": "x", f"exact_{self.b}": "1"}), "must be a number"),
            (dict(method="percentage", **{f"percent_{self.a}": "50", f"percent_{self.b}": ""}), "Bob's percentage is required"),
            (dict(method="percentage", **{f"percent_{self.a}": "60", f"percent_{self.b}": "60"}), "120%"),
            (dict(method="bogus"), "valid split method"),
            (dict(amount="0"), "greater than zero"),
            (dict(amount="1e999999"), "must be a number"),
            (dict(title="  "), "title"),
            (dict(expense_date="2026-02-30"), "valid date"),
            (dict(expense_date="1999-01-01"), "out of range"),
        ]
        for extra, msg in cases:
            with self.subTest(msg=msg), self.assertRaisesRegex(GroupError, msg):
                services.add_expense(self.conn, group=self.group, actor=self.owner,
                                     form=form(**{"paid_by": self.a, "people": ids, "amount": "100", **extra}))
        self.assertEqual(counts(self.conn)["group_expenses"], 0)
        self.assertEqual(counts(self.conn)["expense_splits"], 0)

    def test_payer_and_participants_must_be_active_members(self):
        with self.assertRaisesRegex(GroupError, "who paid"):
            services.add_expense(self.conn, group=self.group, actor=self.owner,
                                 form=form(paid_by=self.d, people=[self.a]))
        with self.assertRaisesRegex(GroupError, "active member"):
            services.add_expense(self.conn, group=self.group, actor=self.owner,
                                 form=form(paid_by=self.a, people=[self.a, self.d]))
        with self.assertRaisesRegex(GroupError, "at least one"):
            services.add_expense(self.conn, group=self.group, actor=self.owner, form=form(paid_by=self.a))

    def test_failure_midway_rolls_back_the_whole_expense(self):
        """If anything after the INSERTs blows up, no half-saved expense may remain."""
        with mock.patch.object(services, "_log", side_effect=RuntimeError("disk on fire")):
            with self.assertRaises(RuntimeError):
                services.add_expense(self.conn, group=self.group, actor=self.owner,
                                     form=form(paid_by=self.a, people=[self.a, self.b]))
        self.assertEqual((counts(self.conn)["group_expenses"], counts(self.conn)["expense_splits"]), (0, 0))
        self.assertFalse(self.conn.in_transaction)
        services.add_expense(self.conn, group=self.group, actor=self.owner,
                             form=form(paid_by=self.a, people=[self.a, self.b]))   # connection still usable

    def test_delete_expense_permissions_and_effect(self):
        eid = services.add_expense(self.conn, group=self.group, actor=self.bob,
                                   form=form(paid_by=self.b, people=[self.a, self.b, self.c]))
        with self.assertRaisesRegex(GroupError, "Only the person who added"):
            services.delete_expense(self.conn, group=self.group, actor=self.cara, expense_id=eid)
        self.assertNotEqual(self.net()[0]["Bob"], 0)
        services.delete_expense(self.conn, group=self.group, actor=self.owner, expense_id=eid)   # owner may
        self.assertEqual(set(self.net()[0].values()), {0})
        with self.assertRaisesRegex(GroupError, "no longer exists"):
            services.delete_expense(self.conn, group=self.group, actor=self.owner, expense_id=eid)

    # ---- settlements
    def test_settlement_rules(self):
        services.add_expense(self.conn, group=self.group, actor=self.owner,
                             form=form(amount="90", paid_by=self.a, people=[self.a, self.b, self.c]))   # B,C owe A 30 each
        S = lambda **kw: services.record_settlement(self.conn, group=self.group, **kw)  # noqa: E731
        with self.assertRaisesRegex(GroupError, "more than"):
            S(actor=self.bob, payer_id=self.b, receiver_id=self.a, amount_minor=3001)
        with self.assertRaisesRegex(GroupError, "doesn't owe"):
            S(actor=self.owner, payer_id=self.a, receiver_id=self.b, amount_minor=100)       # wrong direction
        with self.assertRaisesRegex(GroupError, "Only the payer"):
            S(actor=self.cara, payer_id=self.b, receiver_id=self.a, amount_minor=100)        # bystander
        with self.assertRaisesRegex(GroupError, "different people"):
            S(actor=self.bob, payer_id=self.b, receiver_id=self.b, amount_minor=100)
        with self.assertRaisesRegex(GroupError, "active members"):
            S(actor=self.owner, payer_id=self.d, receiver_id=self.a, amount_minor=100)
        S(actor=self.bob, payer_id=self.b, receiver_id=self.a, amount_minor=1000)           # partial: fine
        S(actor=self.owner, payer_id=self.c, receiver_id=self.a, amount_minor=3000)         # owner may record for others
        nets, transfers = self.net()
        self.assertEqual(nets, {"Alice": 2000, "Bob": -2000, "Cara": 0})
        self.assertEqual([(t["from_name"], t["to_name"], t["amount"]) for t in transfers], [("Bob", "Alice", 2000)])
        S(actor=self.bob, payer_id=self.b, receiver_id=self.a, amount_minor=2000)
        self.assertEqual(set(self.net()[0].values()), {0})

    def test_group_deletion_needs_owner_and_exact_name(self):
        with self.assertRaisesRegex(GroupError, "Only the group owner"):
            services.delete_group(self.conn, group=self.group, actor=self.bob, confirm_name="Goa Trip")
        with self.assertRaisesRegex(GroupError, "exactly"):
            services.delete_group(self.conn, group=self.group, actor=self.owner, confirm_name="goa trip")
        services.delete_group(self.conn, group=self.group, actor=self.owner, confirm_name="Goa Trip")
        self.assertIsNone(services.get_group(self.conn, self.gid))

    def test_user_group_list_shows_my_net_without_extra_queries(self):
        services.add_expense(self.conn, group=self.group, actor=self.owner,
                             form=form(amount="90", paid_by=self.a, people=[self.a, self.b, self.c]))
        mine = {r["name"]: r["net_minor"] for r in services.list_user_groups(self.conn, self.a)}
        theirs = {r["name"]: r["net_minor"] for r in services.list_user_groups(self.conn, self.b)}
        self.assertEqual((mine["Goa Trip"], theirs["Goa Trip"]), (6000, -3000))
        self.assertEqual(services.list_user_groups(self.conn, self.d), [])


if __name__ == "__main__":
    unittest.main()
