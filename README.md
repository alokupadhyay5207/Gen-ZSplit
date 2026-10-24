# Gen-ZSplit

**Split. Track. Settle.** Gen-ZSplit is a Flask expense tracker with personal budgets, reports, and shared group expenses. The MongoDB migration branch stores application data in MongoDB Atlas so it can run on Vercel's serverless runtime without relying on a persistent local SQLite file.

## Features

- Account registration and login with password hashing
- Password reset via email OTP (requires email environment variables)
- Personal expenses: add, edit, delete, filter, search, sort and paginate
- Monthly budgets with warning/overflow email alerts
- Expense dashboard with category, monthly and trend charts
- PDF and Excel reports, including filtered reports
- Group creation and invite codes protected by a group password
- Group members, equal/exact/percentage expense splits, balances and settlements
- Responsive interface, theme toggle and activity history

## Stack

- Python / Flask
- MongoDB Atlas / PyMongo
- Jinja templates, HTML, CSS and JavaScript
- Pandas, OpenPyXL and ReportLab for reports
- Vercel for serverless deployment

## Environment variables

Create a local `.env` file from `.env.example`. Never commit real credentials.

- `SECRET_KEY`: long, random Flask session secret
- `MONGODB_URI`: Atlas connection URI for your database user
- `MONGODB_DB_NAME`: database name (defaults to `genzsplit`)
- `SENDER_EMAIL` and `SENDER_PASSWORD`: optional Gmail sender and app password for OTP/report/budget emails

In Vercel, add the same variables under **Project → Settings → Environment Variables** for the environments you deploy, then redeploy. Do not put credentials in source code or commit them to GitHub.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env with your own Atlas URI and a strong SECRET_KEY
python app.py
```

Open http://127.0.0.1:5000. The `/health` endpoint checks the MongoDB connection.

## Vercel

The project uses `vercel.json` to route requests to the Flask entry point in `app.py`. Configure `MONGODB_URI`, `MONGODB_DB_NAME`, and `SECRET_KEY` in Vercel before testing registration or login.

## Important notes

- The MongoDB migration uses a fresh database; it does not import records from an old SQLite database.
- The legacy SQLite schema/initialization files are retained for reference only and are not used by the MongoDB-backed app.
- Email features require valid email environment variables. Core expense/group functionality does not require email to be configured.
- Verify registration, login, personal expenses, budget changes, group creation, joining, splits and settlements in a staging deployment before merging this branch into `main`.
