from flask import Flask, render_template, request, redirect, session, url_for, flash, send_file
from werkzeug.security import generate_password_hash, check_password_hash
import pandas as pd
import smtplib
from email.message import EmailMessage
import os
from datetime import datetime, timedelta
import random
import tempfile
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from dotenv import load_dotenv

load_dotenv()

import db as database
import groupsplit
from db import DuplicateKeyError

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(32).hex()
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=os.environ.get("VERCEL") == "1")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL")
SENDER_PASSWORD = os.environ.get("SENDER_PASSWORD")

def get_db_connection():
    return database.get_db()

groupsplit.init_app(app)


def send_email_simple(to_email, subject, body):
    if not SENDER_EMAIL or not SENDER_PASSWORD:
        app.logger.warning("Email was not sent because SENDER_EMAIL/SENDER_PASSWORD are not configured.")
        return False, "Email is not configured on this deployment."
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, SENDER_EMAIL, to_email
    msg.set_content(body)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as smtp:
            smtp.login(SENDER_EMAIL, SENDER_PASSWORD)
            smtp.send_message(msg)
        return True, "Email sent successfully."
    except Exception:
        app.logger.exception("Email delivery failed")
        return False, "Email sending failed. Check the email environment variables."


def send_budget_alert_email(user_email, user_name, total_spent, budget_limit, alert_type):
    if alert_type == "warning":
        subject = "Budget Warning - Spending is High"
        body = (f"Hello {user_name},\n\nYour monthly spending has reached ₹{total_spent:.2f} "
                f"out of your budget of ₹{budget_limit:.2f}.\nYou are close to exceeding your budget.\n\nRegards,\nGen-ZSplit")
    else:
        subject = "Budget Overflow Alert"
        body = (f"Hello {user_name},\n\nYour monthly budget has been exceeded.\n"
                f"Total spent: ₹{total_spent:.2f}\nBudget limit: ₹{budget_limit:.2f}\n\nRegards,\nGen-ZSplit")
    return send_email_simple(user_email, subject, body)


def _as_expense(row):
    return dict(row) if row else None


def _valid_day(value):
    """True for a YYYY-MM-DD string. Anything else is ignored instead of failing the query."""
    try:
        datetime.strptime(value or "", "%Y-%m-%d")
        return True
    except ValueError:
        return False


def get_filtered_expenses(user_id, selected_category="", start_date="", end_date="",
                          search_query="", sort_by="date", sort_order="desc"):
    db = get_db_connection()
    where = {"user_id": int(user_id)}
    if selected_category:
        where["category"] = selected_category

    def narrow(query):
        if _valid_day(start_date):
            query = query.gte("date", start_date)
        if _valid_day(end_date):
            query = query.lte("date", end_date)
        if search_query:
            safe = search_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.ilike("title", f"%{safe}%")
        return query

    sort_field = sort_by if sort_by in {"date", "amount", "title"} else "date"
    descending = sort_order != "asc"
    rows = database.fetch(db, "expenses", where, order=[(sort_field, descending), ("id", True)],
                          extra=narrow)
    return [_as_expense(row) for row in rows]


def create_excel_file_from_expenses(expenses, user_name, filtered=False):
    if not expenses:
        return None, "No expense records found."
    df = pd.DataFrame([dict(row) for row in expenses])
    prefix = "filtered_" if filtered else ""
    file_name = f"{user_name.replace(' ', '_')}_{prefix}expense_report.xlsx"
    file_path = os.path.join(tempfile.gettempdir(), file_name)
    df.to_excel(file_path, index=False)
    return file_path, file_name


def create_pdf_file_from_expenses(expenses, user_name, filtered=False):
    if not expenses:
        return None, "No expense records found."
    prefix = "filtered_" if filtered else ""
    file_name = f"{user_name.replace(' ', '_')}_{prefix}expense_report.pdf"
    file_path = os.path.join(tempfile.gettempdir(), file_name)
    c = canvas.Canvas(file_path, pagesize=A4)
    width, height = A4
    y = height - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, y, "Gen-ZSplit - Expense Report")
    y -= 30
    c.setFont("Helvetica", 11)
    c.drawString(50, y, f"User: {user_name}")
    y -= 20
    c.drawString(50, y, f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    y -= 30
    c.setFont("Helvetica-Bold", 11)
    c.drawString(50, y, "Title")
    c.drawString(220, y, "Amount")
    c.drawString(320, y, "Category")
    c.drawString(450, y, "Date")
    y -= 15
    c.line(50, y, 550, y)
    total = 0
    c.setFont("Helvetica", 10)
    for expense in expenses:
        y -= 20
        if y < 80:
            c.showPage()
            y = height - 50
            c.setFont("Helvetica", 10)
        amount = float(expense["amount"])
        c.drawString(50, y, str(expense["title"])[:25])
        c.drawString(220, y, f"Rs. {amount:.2f}")
        c.drawString(320, y, str(expense["category"])[:15])
        c.drawString(450, y, str(expense["date"]))
        total += amount
    y -= 30
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, f"Total Expense: Rs. {total:.2f}")
    c.save()
    return file_path, file_name


def send_attachment_email(to_email, subject, body, file_path, file_name, subtype):
    if not SENDER_EMAIL or not SENDER_PASSWORD:
        if os.path.exists(file_path):
            os.remove(file_path)
        return False, "Email is not configured on this deployment."
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, SENDER_EMAIL, to_email
    msg.set_content(body)
    with open(file_path, "rb") as f:
        file_data = f.read()
    if subtype == "pdf":
        msg.add_attachment(file_data, maintype="application", subtype="pdf", filename=file_name)
    else:
        msg.add_attachment(file_data, maintype="application",
                           subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=file_name)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as smtp:
            smtp.login(SENDER_EMAIL, SENDER_PASSWORD)
            smtp.send_message(msg)
        return True, "Report sent successfully."
    except Exception:
        app.logger.exception("Report email failed")
        return False, "Email sending failed. Check the email environment variables."
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


def check_and_send_budget_alert(user_id, user_email, user_name):
    db = get_db_connection()
    current_month = datetime.now().strftime("%Y-%m")
    budget = database.get_one(db, "budgets", {"user_id": int(user_id), "month": current_month})
    if not budget:
        return
    year, month = int(current_month[:4]), int(current_month[5:7])
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    first_day, next_first_day = f"{current_month}-01", f"{next_year:04d}-{next_month:02d}-01"
    rows = database.fetch(db, "expenses", {"user_id": int(user_id)}, columns="amount",
                          extra=lambda q: q.gte("date", first_day).lt("date", next_first_day))
    total_spent = sum(float(row["amount"]) for row in rows)
    limit = float(budget["budget_limit"])
    if total_spent > limit and not budget.get("overflow_sent", 0):
        send_budget_alert_email(user_email, user_name, total_spent, limit, "overflow")
        database.update(db, "budgets", {"id": budget["id"]}, {"overflow_sent": 1})
    elif total_spent >= 0.8 * limit and not budget.get("warning_sent", 0):
        send_budget_alert_email(user_email, user_name, total_spent, limit, "warning")
        database.update(db, "budgets", {"id": budget["id"]}, {"warning_sent": 1})


@app.route("/")
def home():
    return redirect(url_for("dashboard" if "user_id" in session else "login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not name or not email or not password:
            flash("All fields are required.")
            return redirect(url_for("register"))
        db = get_db_connection()
        try:
            database.insert(db, "users", {"name": name, "email": email,
                                          "password": generate_password_hash(password),
                                          "otp": None, "otp_expiry": None,
                                          "created_at": datetime.utcnow().isoformat()})
        except DuplicateKeyError:
            flash("Email already exists.")
            return redirect(url_for("register"))
        flash("Registration successful. Please login.")
        return redirect(url_for("login"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = database.get_one(get_db_connection(), "users", {"email": email})
        if user and check_password_hash(user["password"], password):
            session.clear()
            session["user_id"] = user["id"]
            session["user_name"] = user["name"]
            session["user_email"] = user["email"]
            return redirect(url_for("dashboard"))
        flash("Invalid email or password.")
        return redirect(url_for("login"))
    return render_template("login.html")


@app.route("/forgot_password", methods=["GET", "POST"])
def forgot_password():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        db = get_db_connection()
        user = database.get_one(db, "users", {"email": email}, columns="id,email")
        if not user:
            flash("If the email is registered, a reset code will be sent.")
            return redirect(url_for("forgot_password"))
        otp = str(random.randint(100000, 999999))
        expiry = datetime.utcnow() + timedelta(minutes=10)
        database.update(db, "users", {"id": user["id"]}, {"otp": otp, "otp_expiry": expiry.isoformat()})
        send_email_simple(email, "Your OTP for Password Reset",
                          f"Your password reset OTP is {otp}. It expires in 10 minutes.")
        session["reset_email"] = email
        flash("If email is configured, an OTP has been sent.")
        return redirect(url_for("verify_otp"))
    return render_template("forgot_password.html")


@app.route("/verify_otp", methods=["GET", "POST"])
def verify_otp():
    if "reset_email" not in session:
        return redirect(url_for("forgot_password"))
    if request.method == "POST":
        db = get_db_connection()
        user = database.get_one(db, "users", {"email": session["reset_email"]}, columns="id,email,otp,otp_expiry")
        otp = request.form.get("otp", "").strip()
        if not user or not user.get("otp") or not user.get("otp_expiry"):
            flash("OTP not found. Please request a new one.")
            return redirect(url_for("forgot_password"))
        try:
            expired = datetime.utcnow() > datetime.fromisoformat(user["otp_expiry"])
        except (TypeError, ValueError):
            expired = True
        if expired:
            flash("OTP expired. Please request a new one.")
            return redirect(url_for("forgot_password"))
        if otp != user["otp"]:
            flash("Invalid OTP.")
            return redirect(url_for("verify_otp"))
        session["otp_verified"] = True
        flash("OTP verified successfully.")
        return redirect(url_for("reset_password"))
    return render_template("verify_otp.html")


@app.route("/reset_password", methods=["GET", "POST"])
def reset_password():
    if "reset_email" not in session or not session.get("otp_verified"):
        return redirect(url_for("forgot_password"))
    if request.method == "POST":
        new_password = request.form.get("new_password", "")
        confirm_password = request.form.get("confirm_password", "")
        if not new_password or new_password != confirm_password:
            flash("Passwords do not match.")
            return redirect(url_for("reset_password"))
        database.update(get_db_connection(), "users", {"email": session["reset_email"]},
                        {"password": generate_password_hash(new_password), "otp": None, "otp_expiry": None})
        session.pop("reset_email", None)
        session.pop("otp_verified", None)
        flash("Password reset successful. Please login.")
        return redirect(url_for("login"))
    return render_template("reset_password.html")


@app.route("/dashboard")
def dashboard():
    if "user_id" not in session:
        return redirect(url_for("login"))
    selected_category = request.args.get("category", "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    search_query = request.args.get("search", "").strip()
    sort_by = request.args.get("sort_by", "date").strip()
    sort_order = request.args.get("sort_order", "desc").strip()
    page = max(1, request.args.get("page", 1, type=int) or 1)
    per_page = 5
    all_expenses = get_filtered_expenses(session["user_id"], selected_category, start_date, end_date,
                                         search_query, sort_by, sort_order)
    total_records = len(all_expenses)
    total_pages = max(1, (total_records + per_page - 1) // per_page)
    page = min(page, total_pages)
    expenses = all_expenses[(page - 1) * per_page:page * per_page]
    db = get_db_connection()
    category_rows = database.fetch(db, "expenses", {"user_id": session["user_id"]}, columns="category")
    categories = [{"category": c} for c in sorted({row["category"] for row in category_rows})]
    month = datetime.now().strftime("%Y-%m")
    budget = database.get_one(db, "budgets", {"user_id": session["user_id"], "month": month})
    total_expense = sum(float(e["amount"]) for e in all_expenses)
    budget_limit = float(budget["budget_limit"]) if budget else 0
    remaining_budget = budget_limit - total_expense if budget_limit else 0
    budget_percentage = min(max(int(total_expense / budget_limit * 100), 0), 100) if budget_limit else 0
    category_totals, monthly_totals, trend_totals = {}, {}, {}
    for e in all_expenses:
        category, amount, day = e["category"], float(e["amount"]), e["date"]
        category_totals[category] = category_totals.get(category, 0) + amount
        monthly_totals[day[:7]] = monthly_totals.get(day[:7], 0) + amount
        trend_totals[day] = trend_totals.get(day, 0) + amount
    return render_template("dashboard.html", expenses=expenses, user_name=session["user_name"],
        total_expense=total_expense, budget_limit=budget_limit, remaining_budget=remaining_budget,
        budget_percentage=budget_percentage,
        highest_category=max(category_totals, key=category_totals.get) if category_totals else "N/A",
        category_labels=list(category_totals), category_data=list(category_totals.values()),
        monthly_labels=list(monthly_totals), monthly_data=list(monthly_totals.values()),
        trend_labels=list(trend_totals), trend_data=list(trend_totals.values()),
        categories=categories, selected_category=selected_category, start_date=start_date, end_date=end_date,
        search_query=search_query, sort_by=sort_by, sort_order=sort_order, page=page, total_pages=total_pages,
        page_numbers=list(range(1, total_pages + 1)))


@app.route("/set_budget", methods=["POST"])
def set_budget():
    if "user_id" not in session:
        return redirect(url_for("login"))
    try:
        budget_limit = float(request.form.get("budget_limit", ""))
        if budget_limit < 0:
            raise ValueError
    except ValueError:
        flash("Enter a valid non-negative budget.")
        return redirect(url_for("dashboard"))
    db = get_db_connection()
    month = datetime.now().strftime("%Y-%m")
    database.upsert(db, "budgets", {"user_id": session["user_id"], "month": month,
                                    "budget_limit": budget_limit, "warning_sent": 0, "overflow_sent": 0},
                    on_conflict="user_id,month")
    flash("Monthly budget set successfully.")
    return redirect(url_for("dashboard"))


@app.route("/add_expense", methods=["POST"])
def add_expense():
    if "user_id" not in session:
        return redirect(url_for("login"))
    title = request.form.get("title", "").strip()
    category = request.form.get("category", "").strip()
    day = request.form.get("date", "").strip()
    try:
        amount = float(request.form.get("amount", ""))
        if amount <= 0:
            raise ValueError
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        flash("Enter a valid positive amount and date.")
        return redirect(url_for("dashboard"))
    if not title or not category:
        flash("Please fill all expense fields.")
        return redirect(url_for("dashboard"))
    db = get_db_connection()
    database.insert(db, "expenses", {"user_id": session["user_id"], "title": title, "amount": amount,
                                     "category": category, "date": day,
                                     "created_at": datetime.utcnow().isoformat()})
    check_and_send_budget_alert(session["user_id"], session["user_email"], session["user_name"])
    flash("Expense added successfully.")
    return redirect(url_for("dashboard"))


@app.route("/edit_expense/<int:expense_id>", methods=["GET", "POST"])
def edit_expense(expense_id):
    if "user_id" not in session:
        return redirect(url_for("login"))
    db = get_db_connection()
    expense = database.get_one(db, "expenses", {"id": expense_id, "user_id": session["user_id"]})
    if not expense:
        flash("Expense not found.")
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        category = request.form.get("category", "").strip()
        day = request.form.get("date", "").strip()
        try:
            amount = float(request.form.get("amount", ""))
            if amount <= 0 or not title or not category:
                raise ValueError
            datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            flash("Enter valid expense details.")
            return redirect(url_for("edit_expense", expense_id=expense_id))
        database.update(db, "expenses", {"id": expense["id"], "user_id": session["user_id"]},
                        {"title": title, "amount": amount, "category": category, "date": day})
        flash("Expense updated successfully.")
        return redirect(url_for("dashboard"))
    return render_template("edit_expense.html", expense=_as_expense(expense))


@app.route("/delete_expense/<int:expense_id>", methods=["POST", "GET"])
def delete_expense(expense_id):
    if "user_id" not in session:
        return redirect(url_for("login"))
    database.delete(get_db_connection(), "expenses", {"id": expense_id, "user_id": session["user_id"]})
    flash("Expense deleted successfully.")
    return redirect(url_for("dashboard"))


def _report(kind, filtered):
    if "user_id" not in session:
        return redirect(url_for("login"))
    args = request.args
    expenses = get_filtered_expenses(session["user_id"], args.get("category", "").strip() if filtered else "",
        args.get("start_date", "").strip() if filtered else "", args.get("end_date", "").strip() if filtered else "",
        args.get("search", "").strip() if filtered else "", args.get("sort_by", "date").strip(),
        args.get("sort_order", "desc").strip())
    creator = create_pdf_file_from_expenses if kind in {"pdf", "download"} else create_excel_file_from_expenses
    path, name = creator(expenses, session["user_name"], filtered=filtered)
    if not path:
        flash(name)
        return redirect(url_for("dashboard"))
    if kind == "download":
        return send_file(path, as_attachment=True, download_name=name)
    success, message = send_attachment_email(session["user_email"],
        f"Your {'Filtered ' if filtered else ''}Expense Tracker {kind.upper()} Report",
        "Please find your expense report attached.", path, name, kind)
    flash(message)
    if filtered:
        return redirect(url_for("dashboard", category=args.get("category", ""), start_date=args.get("start_date", ""),
            end_date=args.get("end_date", ""), search=args.get("search", ""),
            sort_by=args.get("sort_by", "date"), sort_order=args.get("sort_order", "desc")))
    return redirect(url_for("dashboard"))


@app.route("/send_report")
def send_report():
    return _report("xlsx", False)

@app.route("/send_filtered_excel_report")
def send_filtered_excel_report():
    return _report("xlsx", True)

@app.route("/send_pdf_report")
def send_pdf_report():
    return _report("pdf", False)

@app.route("/send_filtered_pdf_report")
def send_filtered_pdf_report():
    return _report("pdf", True)

@app.route("/download_pdf_report")
def download_pdf_report():
    return _report("download", False)


@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out successfully.")
    return redirect(url_for("login"))


@app.route("/health")
def health():
    try:
        database.fetch(get_db_connection(), "users", columns="id", limit=1)
        return {"status": "ok", "database": "supabase"}
    except Exception as exc:
        app.logger.exception("Supabase health check failed")
        return {"status": "error", "database": "unavailable",
                "reason": type(exc).__name__}, 503


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")