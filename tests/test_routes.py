"""End-to-end through Flask: real forms, real CSRF, real sessions."""
import os
import re
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import init_db  # noqa: E402


def make_app():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    raw = sqlite3.connect(path)
    init_db.build(raw)
    raw.commit()
    raw.close()
    os.environ["DATABASE_PATH"] = path
    for m in [m for m in sys.modules if m in ("app", "db") or m.startswith("groupsplit")]:
        del sys.modules[m]
    import app as A
    A.app.config.update(TESTING=True, DATABASE=path)
    return A.app, path


class Client:
    def __init__(self, app, name, email):
        self.c = app.test_client()
        self.c.post("/register", data=dict(name=name, email=email, password="pw123456"))
        self.c.post("/login", data=dict(email=email, password="pw123456"))

    def token(self, url="/groups/"):
        html = self.c.get(url).get_data(as_text=True)
        return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)

    def post(self, url, data=None, token=True, **kw):
        data = dict(data or {})
        if token:
            data["csrf_token"] = self.token()
        return self.c.post(url, data=data, **kw)


class Routes(unittest.TestCase):
    def setUp(self):
        self.app, self.path = make_app()
        self.alice = Client(self.app, "Alice", "alice@x.com")
        self.bob = Client(self.app, "Bob", "bob@x.com")
        self.eve = Client(self.app, "Eve", "eve@x.com")
        self.db = sqlite3.connect(self.path)

    def tearDown(self):
        self.db.close()
        os.remove(self.path)

    def n(self, table):
        return self.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def create(self):
        r = self.alice.post("/groups/create", dict(name="Goa", password="secret1", currency="INR"))
        self.assertEqual(r.status_code, 302)
        code = self.db.execute("SELECT invite_code FROM groups").fetchone()[0]
        return code

    def test_unauthenticated_redirects_to_login(self):
        r = self.app.test_client().get("/groups/")
        self.assertEqual((r.status_code, r.headers["Location"]), (302, "/login"))

    def test_csrf_is_required_on_every_post(self):
        for url in ["/groups/create", "/groups/join", "/groups/1/expenses", "/groups/1/settle",
                    "/groups/1/delete", "/groups/1/leave", "/groups/1/members"]:
            r = self.alice.post(url, dict(name="x", password="secret1"), token=False)
            self.assertEqual(r.status_code, 302, url)
        self.assertEqual(self.n("groups"), 0)

    def test_full_workflow(self):
        code = self.create()
        gid = 1
        # join: wrong password rejected, right one accepted, via lower-case code with a hyphen
        self.bob.post("/groups/join", dict(code=code, password="nope-nope"))
        self.assertEqual(self.n("group_members"), 1)
        r = self.bob.post("/groups/join", dict(code=f"{code[:4]}-{code[4:]}".lower(), password="secret1"), follow_redirects=True)
        self.assertEqual(self.n("group_members"), 2)
        self.assertIn("You joined Goa", r.get_data(as_text=True))

        # add an equal expense through the real form
        r = self.alice.post(f"/groups/{gid}/expenses", dict(title="Dinner", amount="1,200.50", paid_by="1", category="Food",
                            split_method="equal", expense_date="", participants=["1", "2"]), follow_redirects=True)
        html = r.get_data(as_text=True)
        self.assertIn("Expense added and split", html)
        self.assertIn("You're owed", html)        # Alice paid (static text, not escaped)
        self.assertIn("₹600.25", html)
        self.assertEqual(self.n("expense_splits"), 2)

        # Bob's page shows what HE owes
        html = self.bob.c.get(f"/groups/{gid}").get_data(as_text=True)
        self.assertIn("You owe", html)

        # validation failure: 422, modal reopened, error inside it, input preserved, nothing saved
        r = self.alice.post(f"/groups/{gid}/expenses", dict(title="Cab", amount="100", paid_by="1", split_method="percentage",
                            participants=["1", "2"], percent_1="60", percent_2="60"))
        html = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 422)
        self.assertIn("data-autoopen", html)
        self.assertIn("120%", html)
        self.assertIn('value="Cab"', html)
        self.assertIn('name="percent_1" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Percent for Alice" value="60"', html)
        self.assertEqual(self.n("group_expenses"), 1)

        # bystander cannot record a payment; bob can
        self.eve.post("/groups/join", dict(code=code, password="secret1"))
        r = self.eve.post(f"/groups/{gid}/settle", dict(payer_id="2", receiver_id="1", amount="10"), follow_redirects=True)
        self.assertIn("Only the payer", r.get_data(as_text=True))
        r = self.bob.post(f"/groups/{gid}/settle", dict(payer_id="2", receiver_id="1", amount="600.25"), follow_redirects=True)
        self.assertIn("Recorded", r.get_data(as_text=True))
        self.assertIn("all square", self.bob.c.get(f"/groups/{gid}").get_data(as_text=True))

        # expense deletion: eve (not creator, not owner) refused; owner allowed
        r = self.eve.post(f"/groups/{gid}/expenses/1/delete", follow_redirects=True)
        self.assertIn("Only the person who added", r.get_data(as_text=True))
        self.alice.post(f"/groups/{gid}/expenses/1/delete")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM group_expenses WHERE deleted_at IS NULL").fetchone()[0], 0)

        # group delete: wrong confirmation refused, right one cascades everything
        self.alice.post(f"/groups/{gid}/delete", dict(confirm_name="goa"))
        self.assertEqual(self.n("groups"), 1)
        self.alice.post(f"/groups/{gid}/delete", dict(confirm_name="Goa"))
        for t in ("groups", "group_members", "group_expenses", "expense_splits", "settlements", "group_activity"):
            self.assertEqual(self.n(t), 0, t)

    def test_non_members_cannot_see_or_touch_a_group(self):
        self.create()
        for method, url in [("get", "/groups/1"), ("post", "/groups/1/expenses"), ("post", "/groups/1/settle"),
                            ("post", "/groups/1/delete"), ("get", "/groups/999")]:
            r = self.eve.c.get(url, follow_redirects=True) if method == "get" else self.eve.post(url, {}, follow_redirects=True)
            self.assertIn("couldn&#39;t find that group", r.get_data(as_text=True), url)   # same message: no enumeration
        self.assertEqual(self.n("groups"), 1)

    def test_html_is_escaped(self):
        self.alice.post("/groups/create", dict(name="<script>alert(1)</script>", description="<img src=x onerror=1>",
                                               password="secret1", currency="INR"))
        html = self.alice.c.get("/groups/").get_data(as_text=True)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertNotIn("<img src=x", html)
        self.assertIn("&lt;script&gt;", html)

    def test_join_is_throttled_after_five_failures(self):
        code = self.create()
        for _ in range(5):
            self.bob.post("/groups/join", dict(code=code, password="wrong-pass"))
        r = self.bob.post("/groups/join", dict(code=code, password="secret1"), follow_redirects=True)
        self.assertIn("Too many failed attempts", r.get_data(as_text=True))
        self.assertEqual(self.n("group_members"), 1)

    def test_pages_render_empty_and_populated(self):
        self.assertEqual(self.alice.c.get("/groups/").status_code, 200)
        self.assertIn("No groups yet", self.alice.c.get("/groups/").get_data(as_text=True))
        self.create()
        self.assertIn("Goa", self.alice.c.get("/groups/").get_data(as_text=True))
        self.assertEqual(self.alice.c.get("/groups/1?page=abc").status_code, 200)
        self.assertEqual(self.alice.c.get("/groups/1?page=999").status_code, 200)


class LegacyStillWorks(unittest.TestCase):
    """The personal tracker must be unaffected by the new FK pragma / paths."""
    def test_register_login_add_expense_dashboard_logout(self):
        app, path = make_app()
        try:
            c = Client(app, "Zed", "zed@x.com").c
            self.assertEqual(c.post("/add_expense", data=dict(title="Tea", amount="20", category="Food", date="2026-10-01")).status_code, 302)
            r = c.get("/dashboard")
            self.assertEqual(r.status_code, 200)
            self.assertIn("Tea", r.get_data(as_text=True))
            self.assertIn("/groups/", r.get_data(as_text=True))       # nav link resolved to the new endpoint
            self.assertEqual(c.get("/logout").status_code, 302)
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
