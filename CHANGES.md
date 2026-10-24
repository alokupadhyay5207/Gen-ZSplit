# Gen-ZSplit Phase 2: what was broken and what changed

## Bugs reproduced in the original code (each now has a regression test)

| # | Bug | Effect | Fix |
|---|-----|--------|-----|
| 1 | `PRAGMA foreign_keys` never enabled | Every `ON DELETE CASCADE` was ignored. Deleting a group left orphaned members, activity, expenses | `db.connect()` enables it on every connection |
| 2 | Joining a group by **name**, names not unique | Two groups called "Goa" -> the second was impossible to join | Unique 8-char invite code + password |
| 3 | Flash messages never rendered on group pages | Every error and success was silent | Toast system in the shell; errors for the expense form shown inside the modal |
| 4 | Money stored as `REAL` | Float drift; remainder always dumped on the last person | Integer minor units; largest-remainder splitting; remainder rotates between people |
| 5 | Blank exact/percent box -> raw `float('')` error text | Unhelpful, and unseen because of #3 | Strict parsing with messages like "Bob's percentage is required" |
| 6 | Connections leaked on non-ValueError exceptions; no rollback | Locked DB, half-written rows | Request-scoped connection; `BEGIN IMMEDIATE` ... `COMMIT`/`ROLLBACK` per write |
| 7 | Relative DB path (`"expense_tracker.db"`) | Launching from another directory silently created a second empty DB | Absolute path (override with `DATABASE_PATH`) |
| 8 | Per-expense query loop in balance calculation | N+1 queries | Four set-based aggregates; per-group net for the overview in one query |
| 9 | Any member could "settle" any pair | Authorisation gap | Only payer, receiver or owner |
| 10 | No CSRF on POST forms | Cross-site form posts | Per-session token verified on every group POST |
| 11 | Group password guessable without limit | Brute force | 5 failures / 10 min lockout, one generic error |
| 12 | No add / remove / leave member, no expense delete | Incomplete feature set | All added, balance-guarded |

Found while writing the new tests: `CHECK(date(x) = x)` silently accepts invalid dates (`CHECK(NULL)` passes), and `\d` in a Python regex accepts non-ASCII digits. Both fixed.

## Schema decisions you may want to review
- Tables: `groups`, `group_members`, `group_expenses`, `expense_splits` (was `expense_participants`), plus `settlements` and `group_activity`.
- **Dropped** `group_invitations`, `audit_logs`, `notifications`: nothing read them. `group_activity` is the single history.
- Composite foreign keys make "expense paid by a non-member" or "split row in the wrong group" impossible at the database level.
- Financial history is protected: users referenced by payments can't be hard-deleted (RESTRICT).
- Role `admin` removed (nothing used it): roles are `owner` and `member`.

## Not changed
Personal dashboard, auth, OTP, budgets, reports and their styling are untouched (the new CSS is scoped to `body.gz`). The only edit to `dashboard.html` is the Groups link endpoint (`groups` -> `groups.index`).
