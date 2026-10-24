"""Try to break the database. Every one of these must be refused by SQLite itself,
independent of any Flask validation."""
import os
import sqlite3
import unittest

from tests.helpers import add_users, counts, fresh_db
from groupsplit import services


class Integrity(unittest.TestCase):
    def setUp(self):
        self.conn, self.path = fresh_db()
        self.a, self.b, self.c = add_users(self.conn, "Alice", "Bob", "Cara")
        self.g1 = services.create_group(self.conn, owner_id=self.a, owner_name="Alice", name="Goa",
                                        description="", currency="INR", password="secret1")
        self.g2 = services.create_group(self.conn, owner_id=self.b, owner_name="Bob", name="Flat",
                                        description="", currency="INR", password="secret2")

    def tearDown(self):
        self.conn.close()
        os.remove(self.path)

    def test_foreign_keys_are_enforced_on_every_connection(self):
        self.assertEqual(self.conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)

    def expense(self, group, payer, amount=1000, date="2026-10-01", method="equal"):
        return self.conn.execute(
            "INSERT INTO group_expenses (group_id, paid_by, title, amount_minor, expense_date, split_method, created_by) "
            "VALUES (?,?,?,?,?,?,?)", (group, payer, "x", amount, date, method, payer))

    def test_expense_cannot_be_paid_by_a_non_member(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.expense(self.g1, self.c)           # Cara is in no group
        with self.assertRaises(sqlite3.IntegrityError):
            self.expense(self.g1, self.b)           # Bob owns g2, not a member of g1

    def test_split_cannot_belong_to_a_non_member_or_other_groups_member(self):
        eid = self.expense(self.g1, self.a).lastrowid
        for uid in (self.b, self.c):
            with self.assertRaises(sqlite3.IntegrityError):
                self.conn.execute("INSERT INTO expense_splits (expense_id, group_id, user_id, share_minor) "
                                  "VALUES (?,?,?,?)", (eid, self.g1, uid, 500))

    def test_split_cannot_claim_a_different_group_than_its_expense(self):
        eid = self.expense(self.g1, self.a).lastrowid
        with self.assertRaises(sqlite3.IntegrityError):  # Bob IS in g2, but expense is in g1
            self.conn.execute("INSERT INTO expense_splits (expense_id, group_id, user_id, share_minor) "
                              "VALUES (?,?,?,?)", (eid, self.g2, self.b, 500))

    def test_settlement_between_non_members_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("INSERT INTO settlements (group_id, payer_id, receiver_id, amount_minor, created_by) "
                              "VALUES (?,?,?,?,?)", (self.g1, self.a, self.c, 100, self.a))

    def test_check_constraints(self):
        for kwargs in [dict(amount=0), dict(amount=-5), dict(date="2026-13-45"), dict(date="not-a-date"),
                       dict(method="random")]:
            with self.subTest(**kwargs), self.assertRaises(sqlite3.IntegrityError):
                self.expense(self.g1, self.a, **kwargs)
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("INSERT INTO settlements (group_id, payer_id, receiver_id, amount_minor, created_by) "
                              "VALUES (?,?,?,?,?)", (self.g1, self.a, self.a, 100, self.a))
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE groups SET currency='BTC' WHERE id=?", (self.g1,))

    def test_one_active_owner_per_group(self):
        self.conn.execute("INSERT INTO group_members (group_id, user_id, role) VALUES (?,?, 'member')", (self.g1, self.c))
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE group_members SET role='owner' WHERE group_id=? AND user_id=?", (self.g1, self.c))

    def test_invite_code_unique_and_membership_unique(self):
        code = self.conn.execute("SELECT invite_code FROM groups WHERE id=?", (self.g1,)).fetchone()[0]
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE groups SET invite_code=? WHERE id=?", (code, self.g2))
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("INSERT INTO group_members (group_id, user_id) VALUES (?,?)", (self.g1, self.a))

    def test_member_with_financial_history_cannot_be_hard_deleted(self):
        services.add_member_by_email(self.conn, group=services.get_group(self.conn, self.g1),
                                     actor=services.get_membership(self.conn, self.g1, self.a), email="bob@example.com")
        self.conn.execute("INSERT INTO group_expenses (group_id, paid_by, title, amount_minor, expense_date, split_method, created_by)"
                          " VALUES (?,?,?,?,?,?,?)", (self.g1, self.b, "t", 100, "2026-10-01", "equal", self.b))
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("DELETE FROM users WHERE id=?", (self.b,))

    def test_deleting_a_group_leaves_zero_orphans(self):
        g = services.get_group(self.conn, self.g1)
        owner = services.get_membership(self.conn, self.g1, self.a)
        services.add_member_by_email(self.conn, group=g, actor=owner, email="bob@example.com")
        services.add_member_by_email(self.conn, group=g, actor=owner, email="cara@example.com")
        from werkzeug.datastructures import MultiDict
        for method, extra in [("equal", {}), ("exact", {"exact_1": "40", "exact_2": "35", "exact_3": "25"}),
                              ("percentage", {"percent_1": "50", "percent_2": "30", "percent_3": "20"})]:
            f = MultiDict({"title": method, "amount": "100", "paid_by": str(self.a), "split_method": method,
                           "category": "Food", **{k.replace("_1", f"_{self.a}").replace("_2", f"_{self.b}").replace("_3", f"_{self.c}"): v for k, v in extra.items()}})
            for uid in (self.a, self.b, self.c):
                f.add("participants", str(uid))
            services.add_expense(self.conn, group=g, actor=owner, form=f)
        services.record_settlement(self.conn, group=g, actor=owner, payer_id=self.b, receiver_id=self.a, amount_minor=1000)
        before = counts(self.conn)
        self.assertTrue(all(before[t] > 0 for t in before), before)
        other = counts(self.conn)["groups"]
        services.delete_group(self.conn, group=g, actor=owner, confirm_name="Goa")
        after = counts(self.conn)
        self.assertEqual(after["groups"], other - 1)
        # only g2's own rows (1 member + 1 'created' activity) may remain
        self.assertEqual((after["group_members"], after["group_expenses"], after["expense_splits"], after["settlements"]),
                         (1, 0, 0, 0))
        self.assertEqual(self.conn.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
