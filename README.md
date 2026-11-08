# Gen-ZSplit (Next.js)

**Split. Track. Settle.** Personal expense tracking (budgets, charts, PDF/Excel reports) plus shared group
expenses (equal / exact / percentage splits, balances, settlements). This is the Next.js 15 (App Router,
TypeScript) port of the Flask app. **It uses the same Supabase database and schema**, so no data migration is needed.

## Stack
Next.js 15 · React 19 · TypeScript · Supabase (`@supabase/supabase-js`, server-side only) · `jose` (signed session cookies) ·
Chart.js · `pdf-lib` + `exceljs` (reports) · `nodemailer` (Gmail SMTP)

## Setup
```bash
npm install
cp .env.example .env.local      # then fill it in (same SUPABASE_URL / SUPABASE_KEY as the Flask app)
npm run check-db                # verifies the key type and that every table exists
npm test                        # money-split property tests + Werkzeug hash compatibility (Node >= 22.6)
npm run dev                     # http://localhost:3000   (health check: /health)
```
If this is a fresh Supabase project, run `supabase/schema.sql` in the SQL editor first.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | Project URL and the **secret / service_role** key (server only; never expose it) |
| `SECRET_KEY` | Signs session cookies. **Required in production** (`openssl rand -base64 48`) |
| `SENDER_EMAIL`, `SENDER_PASSWORD` | Optional Gmail + app password for OTP / report / budget emails |

## Deploy (Vercel)
Import the repo, set the four variables above under *Settings → Environment Variables*, deploy. Nothing else is needed;
delete the old `vercel.json` / `app.py` / `requirements.txt` from the Flask version.

## Flask → Next.js map
| Flask | Next.js |
|---|---|
| `app.py` routes (`/login`, `/dashboard`, ...) | `src/app/(legacy)/**` (same URLs) + `src/actions/{auth,personal}.ts` |
| `groupsplit/routes.py` | `src/app/(groups)/groups/**` + `src/actions/groups.ts` |
| `groupsplit/services.py`, `money.py` | `src/lib/groups.ts`, `src/lib/money.ts` (same rules and messages) |
| `db.py` (Supabase helpers) | `src/lib/db.ts` |
| Jinja templates + `static/*.js` | React components in `src/components/`; `style.css` is `src/app/globals.css` unchanged |
| Flask `session` / `flash()` | `src/lib/session.ts` (HS256 JWT cookie) / `src/lib/flash.ts` |
| pandas / reportlab / smtplib | `exceljs` / `pdf-lib` / `nodemailer` (all in memory, no temp files) |
| `tests/test_money.py` | `tests/money.test.ts` (+ `tests/password.test.ts`) |

Two root layouts keep the original look: `(legacy)` (light/dark personal pages) and `(groups)` (the dark Gen-ZSplit shell).

## Behaviour notes
* **Passwords keep working.** Hashes are Werkzeug-compatible (scrypt/pbkdf2), so existing users and group passwords
  verify, and hashes created here still verify in the old Flask app (rollback-safe).
* **Everyone has to log in once after cutover**: Flask's session cookies can't be read by Next.
* **CSRF**: the hand-rolled token is gone; Server Actions are POST-only and origin-checked by Next.
* Mutating actions that were GET links in Flask (delete expense, e-mail report) are now POST form buttons. Only the PDF download is a GET.
* Group dialogs submit without reloading the page; a failed "add expense" keeps every field and shows the error inside the dialog.
* Budget alert emails are sent after the response (`after()`), so adding an expense isn't held up by SMTP.
* **Fixed while porting:** in the Flask reset flow the `otp_verified` flag was never cleared when a new reset email was requested, so someone
  who had verified an OTP for their own account could then reset another account's password. Starting a reset now clears it.

## Known limitations carried over unchanged
* The group-password lockout (5 failures / 10 min) is in memory per server instance, as before. On serverless each warm instance counts
  separately, so treat it as a speed bump; use Redis/Supabase for a hard limit.
* Password-reset OTPs are stored in plain text and have no attempt limit; `/forgot_password` reveals whether an email is registered; there's no minimum password length.
* Month boundaries, "today" and report timestamps use UTC (the group add-expense dialog defaults to the visitor's local date).
