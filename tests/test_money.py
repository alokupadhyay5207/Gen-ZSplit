"""Property tests: whatever the inputs, shares must sum to the total exactly."""
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from groupsplit import money  # noqa: E402
from groupsplit.errors import GroupError  # noqa: E402


class SplitProperties(unittest.TestCase):
    def setUp(self):
        self.rng = random.Random(20261011)

    def test_equal_always_sums_and_is_fair(self):
        for _ in range(5000):
            total = self.rng.randint(1, 10**9)
            ids = self.rng.sample(range(1, 500), self.rng.randint(1, 40))
            shares = money.split_equal(total, ids, offset=self.rng.randint(0, 99))
            self.assertEqual(sum(shares.values()), total)
            self.assertLessEqual(max(shares.values()) - min(shares.values()), 1)
            self.assertEqual(set(shares), set(ids))

    def test_equal_remainder_rotates(self):
        """The stray paisa must not always land on the same person."""
        ids = [1, 2, 3]
        extras = [max(money.split_equal(100, ids, offset=k), key=lambda u: money.split_equal(100, ids, offset=k)[u])
                  for k in range(3)]
        self.assertEqual(sorted(extras), [1, 2, 3])

    def test_percentage_always_sums(self):
        for _ in range(5000):
            n = self.rng.randint(1, 12)
            ids = list(range(1, n + 1))
            cuts = sorted(self.rng.randint(0, 10000) for _ in range(n - 1))
            bps = [b - a for a, b in zip([0] + cuts, cuts + [10000])]
            total = self.rng.randint(1, 10**9)
            shares = money.split_percent(total, dict(zip(ids, bps)))
            self.assertEqual(sum(shares.values()), total)
            for uid, bp in zip(ids, bps):  # never off by more than one unit from the exact ratio
                self.assertLessEqual(abs(shares[uid] - total * bp / 10000), 1)

    def test_percentage_one_third_each(self):
        shares = money.split_percent(10000, {1: 3333, 2: 3333, 3: 3334})
        self.assertEqual(sum(shares.values()), 10000)

    def test_percentage_must_total_100(self):
        with self.assertRaisesRegex(GroupError, "99.99%"):
            money.split_percent(10000, {1: 5000, 2: 4999})

    def test_exact_mismatch_message_is_human(self):
        with self.assertRaisesRegex(GroupError, r"₹10\.00 short of the total ₹100\.00"):
            money.split_exact(10000, {1: 3000, 2: 6000}, "INR")

    def test_simplify_settles_everyone_to_zero(self):
        for _ in range(3000):
            n = self.rng.randint(2, 15)
            vals = [self.rng.randint(-10**6, 10**6) for _ in range(n - 1)]
            vals.append(-sum(vals))
            nets = dict(enumerate(vals, start=1))
            transfers = money.simplify_debts(nets)
            self.assertLessEqual(len(transfers), n - 1)
            after = dict(nets)
            for f, t, a in transfers:
                self.assertGreater(a, 0)
                after[f] += a
                after[t] -= a
            self.assertTrue(all(v == 0 for v in after.values()))


class Parsing(unittest.TestCase):
    def test_good_values(self):
        self.assertEqual(money.parse_amount("1,250.50"), 125050)
        self.assertEqual(money.parse_amount(" 12 "), 1200)
        self.assertEqual(money.parse_amount("500", "JPY"), 500)
        self.assertEqual(money.parse_amount("0", allow_zero=True), 0)
        self.assertEqual(money.parse_percent_bp("33.33", label="P"), 3333)

    def test_hostile_values(self):
        for bad in ["", "abc", "NaN", "Infinity", "-5", "0", "0.001", "1e999999", "1e3", "10000001",
                    "99999999999999999999999", "1.2.3", "--1", "1 2", "٣"]:
            with self.subTest(bad=bad), self.assertRaises(GroupError):
                money.parse_amount(bad)

    def test_jpy_has_no_decimals(self):
        with self.assertRaises(GroupError):
            money.parse_amount("10.5", "JPY")

    def test_percent_bounds(self):
        for bad in ["", "-1", "100.01", "1.234", "x"]:
            with self.subTest(bad=bad), self.assertRaises(GroupError):
                money.parse_percent_bp(bad, label="P")


class Formatting(unittest.TestCase):
    def test_indian_grouping(self):
        self.assertEqual(money.format_amount(12505000, "INR"), "₹1,25,050.00")
        self.assertEqual(money.format_amount(99999999, "INR"), "₹9,99,999.99")
        self.assertEqual(money.format_amount(100, "INR"), "₹1.00")
        self.assertEqual(money.format_amount(0, "INR"), "₹0.00")

    def test_western_grouping_and_signs(self):
        self.assertEqual(money.format_amount(123456789, "USD"), "$1,234,567.89")
        self.assertEqual(money.format_amount(-100, "USD"), "-$1.00")
        self.assertEqual(money.format_amount(100, "USD", signed=True), "+$1.00")
        self.assertEqual(money.format_amount(500, "JPY"), "¥500")

    def test_roundtrip(self):
        for minor in (1, 99, 100, 123456, 10**9):
            self.assertEqual(money.parse_amount(money.to_input_value(minor, "INR")), minor)


if __name__ == "__main__":
    unittest.main()
