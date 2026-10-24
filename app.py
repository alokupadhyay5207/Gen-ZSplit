from flask import Flask, render_template, request, redirect, session, url_for, flash, send_file
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
import pandas as pd
import smtplib
from email.message import EmailMessage
import os
from datetime import datetime, timedelta
import random
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas




from dotenv import load_dotenv
load_dotenv()

import db as database
import groupsplit

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")
if app.secret_key == "dev-secret-key":
    app.logger.warning("SECRET_KEY is not set: using the insecure development default. Set it in .env.")
app.config.update(
    DATABASE=database.DEFAULT_DB_PATH,   # absolute path: independent of the launch directory
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)
DATABASE = app.config["DATABASE"]

# ---------------- EMAIL CONFIG ----------------
SENDER_EMAIL = os.environ.get("SENDER_EMAIL")
SENDER_PASSWORD = os.environ.get("SENDER_PASSWORD")


def get_db_connection():
    """Legacy personal-expense connection (implicit transactions, as before),
    now with foreign keys enforced and an absolute DB path."""
    return database.connect(app.config["DATABASE"])


groupsplit.init_app(app)


def send_email_simple(to_email, subject, body):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_email
    msg.set_content(body)

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(SENDER_EMAIL, SENDER_PASSWORD)
            smtp.send_message(msg)
        return True, "Email sent successfully."
    except Exception as e:
        return False, f"Email sending failed: {str(e)}"


def send_budget_alert_email(user_email, user_name, total_spent, budget_limit, alert_type):
    if alert_type == "warning":
        subject = "Budget Warning - Spending is High"
        body = (
            f"Hello {user_name},\n\n"
            f"Your monthly spending has reached ₹{total_spent:.2f} "
            f"out of your budget of ₹{budget_limit:.2f}.\n"
            f"You are close to exceeding your budget.\n\n"
            f"Regards,\nSmart Expense Tracker"
        )
    else:
        subject = "Budget Overflow Alert"
        body = (
            f"Hello {user_name},\n\n"
            f"Your monthly budget has been exceeded.\n"
            f"Total spent: ₹{total_spent:.2f}\n"
            f"Budget limit: ₹{budget_limit:.2f}\n\n"
            f"Please review your expenses.\n\n"
            f"Regards,\nSmart Expense Tracker"
        )

    return send_email_simple(user_email, subject, body)


def build_filtered_expense_query(user_id, selected_category, start_date, end_date, search_query, sort_by, sort_order):
    query = "SELECT * FROM expenses WHERE user_id = ?"
    params = [user_id]

    if selected_category:
        query += " AND category = ?"
        params.append(selected_category)

    if start_date:
        query += " AND date >= ?"
        params.append(start_date)

    if end_date:
        query += " AND date <= ?"
        params.append(end_date)

    if search_query:
        query += " AND title LIKE ?"
        params.append(f"%{search_query}%")

    allowed_sort_fields = {
        "date": "date",
        "amount": "amount",
        "title": "title"
    }
    allowed_sort_orders = {
        "asc": "ASC",
        "desc": "DESC"
    }

    sort_column = allowed_sort_fields.get(sort_by, "date")
    order_direction = allowed_sort_orders.get(sort_order, "DESC")

    query += f" ORDER BY {sort_column} {order_direction}, id DESC"
    return query, params


def get_filtered_expenses(
    user_id,
    selected_category="",
    start_date="",
    end_date="",
    search_query="",
    sort_by="date",
    sort_order="desc"
):
    conn = get_db_connection()
    query, params = build_filtered_expense_query(
        user_id, selected_category, start_date, end_date, search_query, sort_by, sort_order
    )
    expenses = conn.execute(query, params).fetchall()
    conn.close()
    return expenses


def create_excel_file_from_expenses(expenses, user_name, filtered=False):
    if not expenses:
        return None, "No expense records found."

    data = [dict(row) for row in expenses]
    df = pd.DataFrame(data)

    prefix = "filtered_" if filtered else ""
    file_name = f"{user_name.replace(' ', '_')}_{prefix}expense_report.xlsx"
    file_path = os.path.join(os.getcwd(), file_name)
    df.to_excel(file_path, index=False)

    return file_path, file_name


def create_pdf_file_from_expenses(expenses, user_name, filtered=False):
    if not expenses:
        return None, "No expense records found."

    prefix = "filtered_" if filtered else ""
    file_name = f"{user_name.replace(' ', '_')}_{prefix}expense_report.pdf"
    file_path = os.path.join(os.getcwd(), file_name)

    c = canvas.Canvas(file_path, pagesize=A4)
    width, height = A4

    y = height - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, y, "Smart Expense Tracker - Expense Report")

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

        c.drawString(50, y, str(expense["title"])[:25])
        c.drawString(220, y, f"₹ {expense['amount']:.2f}")
        c.drawString(320, y, str(expense["category"])[:15])
        c.drawString(450, y, str(expense["date"]))
        total += expense["amount"]

    y -= 30
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, f"Total Expense: ₹ {total:.2f}")
    c.save()

    return file_path, file_name


def send_attachment_email(to_email, subject, body, file_path, file_name, subtype):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_email
    msg.set_content(body)

    with open(file_path, "rb") as f:
        file_data = f.read()
        maintype = "application"

        if subtype == "pdf":
            msg.add_attachment(file_data, maintype=maintype, subtype="pdf", filename=file_name)
        else:
            msg.add_attachment(
                file_data,
                maintype=maintype,
                subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                filename=file_name
            )

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(SENDER_EMAIL, SENDER_PASSWORD)
            smtp.send_message(msg)

        if os.path.exists(file_path):
            os.remove(file_path)

        return True, "Report sent successfully."
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)

        return False, f"Email sending failed: {str(e)}"


def check_and_send_budget_alert(user_id, user_email, user_name):
    current_month = datetime.now().strftime("%Y-%m")
    conn = get_db_connection()

    budget_row = conn.execute(
        "SELECT * FROM budgets WHERE user_id = ? AND month = ?",
        (user_id, current_month)
    ).fetchone()

    if not budget_row:
        conn.close()
        return

    expense_rows = conn.execute(
        "SELECT amount FROM expenses WHERE user_id = ? AND substr(date, 1, 7) = ?",
        (user_id, current_month)
    ).fetchall()

    total_spent = sum(row["amount"] for row in expense_rows)
    budget_limit = budget_row["budget_limit"]
    warning_sent = budget_row["warning_sent"]
    overflow_sent = budget_row["overflow_sent"]

    if total_spent > budget_limit and overflow_sent == 0:
        send_budget_alert_email(user_email, user_name, total_spent, budget_limit, "overflow")
        conn.execute(
            "UPDATE budgets SET overflow_sent = 1 WHERE user_id = ? AND month = ?",
            (user_id, current_month)
        )
        conn.commit()

    elif total_spent >= 0.8 * budget_limit and warning_sent == 0:
        send_budget_alert_email(user_email, user_name, total_spent, budget_limit, "warning")
        conn.execute(
            "UPDATE budgets SET warning_sent = 1 WHERE user_id = ? AND month = ?",
            (user_id, current_month)
        )
        conn.commit()

    conn.close()


@app.route("/")
def home():
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form["name"].strip()
        email = request.form["email"].strip().lower()
        password = request.form["password"]

        if not name or not email or not password:
            flash("All fields are required.")
            return redirect(url_for("register"))

        hashed_password = generate_password_hash(password)

        conn = get_db_connection()
        try:
            conn.execute(
                "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
                (name, email, hashed_password)
            )
            conn.commit()
            flash("Registration successful. Please login.")
            return redirect(url_for("login"))
        except sqlite3.IntegrityError:
            flash("Email already exists.")
            return redirect(url_for("register"))
        finally:
            conn.close()

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form["email"].strip().lower()
        password = request.form["password"]

        conn = get_db_connection()
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()
        conn.close()

        if user and check_password_hash(user["password"], password):
            session["user_id"] = user["id"]
            session["user_name"] = user["name"]
            session["user_email"] = user["email"]
            return redirect(url_for("dashboard"))
        else:
            flash("Invalid email or password.")
            return redirect(url_for("login"))

    return render_template("login.html")


@app.route("/forgot_password", methods=["GET", "POST"])
def forgot_password():
    if request.method == "POST":
        email = request.form["email"].strip().lower()

        conn = get_db_connection()
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        if not user:
            conn.close()
            flash("Email not registered.")
            return redirect(url_for("forgot_password"))

        otp = str(random.randint(100000, 999999))
        otp_expiry = (datetime.now() + timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")

        conn.execute(
            "UPDATE users SET otp = ?, otp_expiry = ? WHERE email = ?",
            (otp, otp_expiry, email)
        )
        conn.commit()
        conn.close()

        subject = "Your OTP for Password Reset"
        body = (
            f"Hello,\n\nYour OTP for resetting password is: {otp}\n"
            f"This OTP is valid for 10 minutes.\n\nRegards,\nSmart Expense Tracker"
        )
        send_email_simple(email, subject, body)

        flash("OTP sent to your email.")
        session["reset_email"] = email
        return redirect(url_for("verify_otp"))

    return render_template("forgot_password.html")


@app.route("/verify_otp", methods=["GET", "POST"])
def verify_otp():
    if "reset_email" not in session:
        return redirect(url_for("forgot_password"))

    if request.method == "POST":
        otp = request.form["otp"].strip()
        email = session["reset_email"]

        conn = get_db_connection()
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        if not user:
            conn.close()
            flash("Invalid request.")
            return redirect(url_for("forgot_password"))

        stored_otp = user["otp"]
        otp_expiry = user["otp_expiry"]

        if not stored_otp or not otp_expiry:
            conn.close()
            flash("OTP not found. Please try again.")
            return redirect(url_for("forgot_password"))

        if datetime.now() > datetime.strptime(otp_expiry, "%Y-%m-%d %H:%M:%S"):
            conn.close()
            flash("OTP expired. Please request a new one.")
            return redirect(url_for("forgot_password"))

        if otp != stored_otp:
            conn.close()
            flash("Invalid OTP.")
            return redirect(url_for("verify_otp"))

        conn.close()
        session["otp_verified"] = True
        flash("OTP verified successfully.")
        return redirect(url_for("reset_password"))

    return render_template("verify_otp.html")


@app.route("/reset_password", methods=["GET", "POST"])
def reset_password():
    if "reset_email" not in session or "otp_verified" not in session:
        return redirect(url_for("forgot_password"))

    if request.method == "POST":
        new_password = request.form["new_password"]
        confirm_password = request.form["confirm_password"]

        if new_password != confirm_password:
            flash("Passwords do not match.")
            return redirect(url_for("reset_password"))

        hashed_password = generate_password_hash(new_password)
        email = session["reset_email"]

        conn = get_db_connection()
        conn.execute(
            "UPDATE users SET password = ?, otp = NULL, otp_expiry = NULL WHERE email = ?",
            (hashed_password, email)
        )
        conn.commit()
        conn.close()

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

    try:
        page = int(request.args.get("page", 1))
    except ValueError:
        page = 1

    per_page = 5
    if page < 1:
        page = 1

    conn = get_db_connection()

    query, params = build_filtered_expense_query(
        session["user_id"], selected_category, start_date, end_date, search_query, sort_by, sort_order
    )

    all_filtered_expenses = conn.execute(query, params).fetchall()
    total_records = len(all_filtered_expenses)
    total_pages = (total_records + per_page - 1) // per_page

    if total_pages == 0:
        total_pages = 1

    if page > total_pages:
        page = total_pages

    start_index = (page - 1) * per_page
    end_index = start_index + per_page
    expenses = all_filtered_expenses[start_index:end_index]

    categories = conn.execute(
        "SELECT DISTINCT category FROM expenses WHERE user_id = ? ORDER BY category ASC",
        (session["user_id"],)
    ).fetchall()

    current_month = datetime.now().strftime("%Y-%m")
    budget_row = conn.execute(
        "SELECT budget_limit FROM budgets WHERE user_id = ? AND month = ?",
        (session["user_id"], current_month)
    ).fetchone()

    conn.close()

    total_expense = sum(expense["amount"] for expense in all_filtered_expenses)
    budget_limit = budget_row["budget_limit"] if budget_row else 0
    remaining_budget = budget_limit - total_expense if budget_limit else 0
    budget_percentage = int((total_expense / budget_limit) * 100) if budget_limit else 0
    budget_percentage = min(max(budget_percentage, 0), 100)

    category_totals = {}
    monthly_totals = {}
    trend_totals = {}

    for expense in all_filtered_expenses:
        category = expense["category"]
        amount = expense["amount"]
        date = expense["date"]
        month = date[:7]

        category_totals[category] = category_totals.get(category, 0) + amount
        monthly_totals[month] = monthly_totals.get(month, 0) + amount
        trend_totals[date] = trend_totals.get(date, 0) + amount

    highest_category = max(category_totals, key=category_totals.get) if category_totals else "N/A"
    page_numbers = list(range(1, total_pages + 1))

    return render_template(
        "dashboard.html",
        expenses=expenses,
        user_name=session["user_name"],
        total_expense=total_expense,
        budget_limit=budget_limit,
        remaining_budget=remaining_budget,
        budget_percentage=budget_percentage,
        highest_category=highest_category,
        category_labels=list(category_totals.keys()),
        category_data=list(category_totals.values()),
        monthly_labels=list(monthly_totals.keys()),
        monthly_data=list(monthly_totals.values()),
        trend_labels=list(trend_totals.keys()),
        trend_data=list(trend_totals.values()),
        categories=categories,
        selected_category=selected_category,
        start_date=start_date,
        end_date=end_date,
        search_query=search_query,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        total_pages=total_pages,
        page_numbers=page_numbers
    )


@app.route("/set_budget", methods=["POST"])
def set_budget():
    if "user_id" not in session:
        return redirect(url_for("login"))

    budget_limit = request.form["budget_limit"]
    current_month = datetime.now().strftime("%Y-%m")

    conn = get_db_connection()
    conn.execute("""
        INSERT INTO budgets (user_id, month, budget_limit, warning_sent, overflow_sent)
        VALUES (?, ?, ?, 0, 0)
        ON CONFLICT(user_id, month)
        DO UPDATE SET
            budget_limit = excluded.budget_limit,
            warning_sent = 0,
            overflow_sent = 0
    """, (session["user_id"], current_month, budget_limit))
    conn.commit()
    conn.close()

    flash("Monthly budget set successfully.")
    return redirect(url_for("dashboard"))


@app.route("/add_expense", methods=["POST"])
def add_expense():
    if "user_id" not in session:
        return redirect(url_for("login"))

    title = request.form["title"].strip()
    amount = request.form["amount"]
    category = request.form["category"].strip()
    date = request.form["date"]

    if not title or not amount or not category or not date:
        flash("Please fill all expense fields.")
        return redirect(url_for("dashboard"))

    conn = get_db_connection()
    conn.execute(
        "INSERT INTO expenses (user_id, title, amount, category, date) VALUES (?, ?, ?, ?, ?)",
        (session["user_id"], title, amount, category, date)
    )
    conn.commit()
    conn.close()

    check_and_send_budget_alert(
        session["user_id"],
        session["user_email"],
        session["user_name"]
    )

    flash("Expense added successfully.")
    return redirect(url_for("dashboard"))


@app.route("/edit_expense/<int:expense_id>", methods=["GET", "POST"])
def edit_expense(expense_id):
    if "user_id" not in session:
        return redirect(url_for("login"))

    conn = get_db_connection()
    expense = conn.execute(
        "SELECT * FROM expenses WHERE id = ? AND user_id = ?",
        (expense_id, session["user_id"])
    ).fetchone()

    if not expense:
        conn.close()
        flash("Expense not found.")
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        title = request.form["title"].strip()
        amount = request.form["amount"]
        category = request.form["category"].strip()
        date = request.form["date"]

        conn.execute(
            "UPDATE expenses SET title = ?, amount = ?, category = ?, date = ? WHERE id = ? AND user_id = ?",
            (title, amount, category, date, expense_id, session["user_id"])
        )
        conn.commit()
        conn.close()

        flash("Expense updated successfully.")
        return redirect(url_for("dashboard"))

    conn.close()
    return render_template("edit_expense.html", expense=expense)


@app.route("/delete_expense/<int:expense_id>")
def delete_expense(expense_id):
    if "user_id" not in session:
        return redirect(url_for("login"))

    conn = get_db_connection()
    conn.execute(
        "DELETE FROM expenses WHERE id = ? AND user_id = ?",
        (expense_id, session["user_id"])
    )
    conn.commit()
    conn.close()

    flash("Expense deleted successfully.")
    return redirect(url_for("dashboard"))


@app.route("/send_report")
def send_report():
    if "user_id" not in session:
        return redirect(url_for("login"))

    expenses = get_filtered_expenses(session["user_id"])
    result = create_excel_file_from_expenses(expenses, session["user_name"], filtered=False)

    if not result[0]:
        flash(result[1])
        return redirect(url_for("dashboard"))

    file_path, file_name = result
    success, message = send_attachment_email(
        session["user_email"],
        "Your Expense Tracker Excel Report",
        f"Hello {session['user_name']},\n\nPlease find attached your expense report in Excel format.\n\nRegards,\nSmart Expense Tracker",
        file_path,
        file_name,
        "xlsx"
    )
    flash(message)
    return redirect(url_for("dashboard"))


@app.route("/send_filtered_excel_report")
def send_filtered_excel_report():
    if "user_id" not in session:
        return redirect(url_for("login"))

    selected_category = request.args.get("category", "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    search_query = request.args.get("search", "").strip()
    sort_by = request.args.get("sort_by", "date").strip()
    sort_order = request.args.get("sort_order", "desc").strip()

    expenses = get_filtered_expenses(
        session["user_id"], selected_category, start_date, end_date, search_query, sort_by, sort_order
    )
    result = create_excel_file_from_expenses(expenses, session["user_name"], filtered=True)

    if not result[0]:
        flash(result[1])
        return redirect(url_for("dashboard"))

    file_path, file_name = result
    success, message = send_attachment_email(
        session["user_email"],
        "Your Filtered Expense Tracker Excel Report",
        f"Hello {session['user_name']},\n\nPlease find attached your filtered expense report in Excel format.\n\nRegards,\nSmart Expense Tracker",
        file_path,
        file_name,
        "xlsx"
    )
    flash(message)

    return redirect(url_for(
        "dashboard",
        category=selected_category,
        start_date=start_date,
        end_date=end_date,
        search=search_query,
        sort_by=sort_by,
        sort_order=sort_order
    ))


@app.route("/send_pdf_report")
def send_pdf_report():
    if "user_id" not in session:
        return redirect(url_for("login"))

    expenses = get_filtered_expenses(session["user_id"])
    result = create_pdf_file_from_expenses(expenses, session["user_name"], filtered=False)

    if not result[0]:
        flash(result[1])
        return redirect(url_for("dashboard"))

    file_path, file_name = result
    success, message = send_attachment_email(
        session["user_email"],
        "Your Expense Tracker PDF Report",
        f"Hello {session['user_name']},\n\nPlease find attached your expense report in PDF format.\n\nRegards,\nSmart Expense Tracker",
        file_path,
        file_name,
        "pdf"
    )
    flash(message)
    return redirect(url_for("dashboard"))


@app.route("/send_filtered_pdf_report")
def send_filtered_pdf_report():
    if "user_id" not in session:
        return redirect(url_for("login"))

    selected_category = request.args.get("category", "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    search_query = request.args.get("search", "").strip()
    sort_by = request.args.get("sort_by", "date").strip()
    sort_order = request.args.get("sort_order", "desc").strip()

    expenses = get_filtered_expenses(
        session["user_id"], selected_category, start_date, end_date, search_query, sort_by, sort_order
    )
    result = create_pdf_file_from_expenses(expenses, session["user_name"], filtered=True)

    if not result[0]:
        flash(result[1])
        return redirect(url_for("dashboard"))

    file_path, file_name = result
    success, message = send_attachment_email(
        session["user_email"],
        "Your Filtered Expense Tracker PDF Report",
        f"Hello {session['user_name']},\n\nPlease find attached your filtered expense report in PDF format.\n\nRegards,\nSmart Expense Tracker",
        file_path,
        file_name,
        "pdf"
    )
    flash(message)

    return redirect(url_for(
        "dashboard",
        category=selected_category,
        start_date=start_date,
        end_date=end_date,
        search=search_query,
        sort_by=sort_by,
        sort_order=sort_order
    ))


@app.route("/download_pdf_report")
def download_pdf_report():
    if "user_id" not in session:
        return redirect(url_for("login"))

    expenses = get_filtered_expenses(session["user_id"])
    result = create_pdf_file_from_expenses(expenses, session["user_name"], filtered=False)

    if not result[0]:
        flash(result[1])
        return redirect(url_for("dashboard"))

    file_path, file_name = result
    return send_file(file_path, as_attachment=True, download_name=file_name)


@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out successfully.")
    return redirect(url_for("login"))


if __name__ == "__main__":
    app.run(debug=True)
