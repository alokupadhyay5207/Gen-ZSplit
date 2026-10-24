# SmartExpenseTracker

A premium full-stack Expense Tracker web application built using **Flask, SQLite, HTML, CSS, JavaScript, and Chart.js**.  
This project helps users manage daily expenses, set budgets, analyze spending patterns, and export reports in **PDF** and **Excel** format.

---

## Features

- User Registration and Login
- Forgot Password with OTP verification
- Secure password hashing
- Add, Edit, Delete Expenses
- Budget Limit Setup
- Budget Warning and Overflow Alerts
- Interactive Dashboard
- Category-wise Expense Analysis
- Monthly Expense Graph
- Expense Trend Graph
- Search, Filter, Sort, and Pagination
- Dark Mode / Light Mode
- Responsive Premium UI
- Export Reports in PDF and Excel
- Filtered Report Export
- Email Integration for Reports and Alerts

---

## Tech Stack

### Frontend
- HTML
- CSS
- JavaScript
- Chart.js

### Backend
- Flask (Python)

### Database
- SQLite

### Libraries Used
- Flask
- Werkzeug
- Pandas
- Openpyxl
- ReportLab

---

## Project Structure

```text
SmartExpenseTracker/
│
├── app.py
├── init_db.py
├── requirements.txt
├── README.md
│
├── static/
│   ├── style.css
│   └── script.js
│
└── templates/
    ├── base.html
    ├── login.html
    ├── register.html
    ├── forgot_password.html
    ├── verify_otp.html
    ├── reset_password.html
    ├── dashboard.html
    └── edit_expense.html

## Gen-ZSplit Group Expense Module

Groups, shared expenses, equal / exact / percentage splits and settle-up, built on the same Flask + SQLite stack.

### Run it locally (VS Code)

```bash
python -m venv venv
venv\Scripts\activate            # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env           # macOS/Linux: cp .env.example .env   (then set SECRET_KEY)

python init_db.py                # create anything missing (safe to re-run)
python init_db.py --reset-groups # first time only if you have the OLD group tables: rebuilds
                                 # ONLY group tables, keeps users/expenses/budgets, writes a backup
python init_db.py --fresh        # nuclear option: backup, then rebuild the whole database
python init_db.py --check        # integrity report only

python -m unittest discover -s tests -t .   # 47 tests
python app.py                               # http://127.0.0.1:5000
```

### Layout

```text
app.py              personal-tracker routes (unchanged) + registers the group module
db.py               connection factory (foreign keys ON, absolute path, transactions)
schema.sql          group tables: composite FKs, cascades, CHECKs, indexes
init_db.py          init / --reset-groups / --fresh / --check, with automatic backups
groupsplit/
  money.py          parsing, formatting, split + debt-simplification maths (pure)
  services.py       every business rule and query
  routes.py         thin HTTP layer (CSRF, auth gate, flash + rollback handling)
  security.py       CSRF tokens, join-attempt throttle
  filters.py        Jinja filters (money, hue, ago, ...)
templates/          gz_base.html shell, groups.html, group_detail.html, partials/
static/             style.css (legacy + Gen-ZSplit design system), groups.js
tests/              money properties, DB integrity attacks, workflows, end-to-end routes
```

### Rules the module enforces

- Money is stored as integer minor units (paise/cents); every split sums exactly to the total.
- Anyone in a group can add expenses. The expense's creator or the owner can delete it.
  The payer, the receiver or the owner can record a payment. Only the owner can add/remove people or delete the group.
- A member can't leave or be removed while they owe or are owed money.
- People join with an invite code **and** the group password (5 wrong tries per 10 minutes, then a lockout).
