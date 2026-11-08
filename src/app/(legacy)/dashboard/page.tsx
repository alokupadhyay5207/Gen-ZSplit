import Link from "next/link";
import {
  addExpenseAction,
  deleteExpenseAction,
  emailReportAction,
  setBudgetAction,
} from "@/actions/personal";
import { logoutAction } from "@/actions/auth";
import { DashboardCharts } from "@/components/DashboardCharts";
import { Counter, FlashBox, SubmitButton, ThemeToggle } from "@/components/LegacyBits";
import { readFlash } from "@/lib/flash";
import { EXPENSE_CATEGORIES, loadDashboard } from "@/lib/personal";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Dashboard" };

type SP = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");

/** A form-button that e-mails a report (these were GET links in the Flask app). */
function ReportForm({
  kind,
  filtered,
  label,
  className,
  p,
}: {
  kind: "xlsx" | "pdf";
  filtered: boolean;
  label: string;
  className: string;
  p: Record<string, string>;
}) {
  return (
    <form action={emailReportAction} className="inline-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="filtered" value={filtered ? "1" : "0"} />
      {filtered
        ? Object.entries(p).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      <SubmitButton className={className}>{label}</SubmitButton>
    </form>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = {
    category: one(sp.category),
    startDate: one(sp.start_date),
    endDate: one(sp.end_date),
    search: one(sp.search),
    sortBy: one(sp.sort_by) || "date",
    sortOrder: one(sp.sort_order) || "desc",
  };
  const d = await loadDashboard(user.uid, f, Number(one(sp.page)) || 1);
  const messages = await readFlash(one(sp.notice));

  const filterParams: Record<string, string> = {
    search: f.search,
    category: f.category,
    start_date: f.startDate,
    end_date: f.endDate,
    sort_by: f.sortBy,
    sort_order: f.sortOrder,
  };
  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    qs.set("page", String(n));
    for (const [k, v] of Object.entries(filterParams)) if (v) qs.set(k, v);
    return `/dashboard?${qs}`;
  };
  const pageNumbers = Array.from({ length: d.totalPages }, (_, i) => i + 1);

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">💰</div>
          <div>
            <h2>Expense Tracker</h2>
            <p>Smart Finance Panel</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <Link href="/dashboard" className="nav-item active">
            📊 Dashboard
          </Link>
          <a href="#budget-section" className="nav-item">
            💼 Budget
          </a>
          <a href="/groups" className="nav-item">
            👥 Groups
          </a>
          <a href="#expense-section" className="nav-item">
            🧾 Expenses
          </a>
          <a href="#reports-section" className="nav-item">
            📁 Reports
          </a>
          <form action={logoutAction} className="inline-form">
            <button type="submit" className="nav-item logout-nav" style={{ width: "100%", textAlign: "left", border: 0, font: "inherit" }}>
              🚪 Logout
            </button>
          </form>
        </nav>

        <div className="theme-switch-box">
          <ThemeToggle />
        </div>
      </aside>

      <main className="main-dashboard">
        <div className="dashboard-topbar">
          <div>
            <h1>Welcome, {user.name}</h1>
            <p>Your premium financial control center</p>
          </div>
        </div>

        <section className="hero-banner">
          <div className="hero-text">
            <h2>Financial Overview</h2>
            <p>Stay ahead of your budget with elegant analytics, live counters, and visually rich insights.</p>
          </div>
          <div className="hero-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://cdn-icons-png.flaticon.com/512/3135/3135706.png" alt="Finance Banner" />
          </div>
        </section>

        <section className="card-grid">
          <div className="summary-card total-card">
            <span className="card-label">Total Expense</span>
            <h3 className="counter">
              <Counter target={d.totalExpense} />
            </h3>
            <p>Based on current filtered records</p>
          </div>
          <div className="summary-card budget-card" id="budget-section">
            <span className="card-label">Budget Limit</span>
            <h3 className="counter">
              <Counter target={d.budgetLimit} />
            </h3>
            <p>Your current monthly target</p>
          </div>
          <div className="summary-card remaining-card">
            <span className="card-label">Remaining Budget</span>
            <h3 className="counter">
              <Counter target={d.budgetLimit ? d.remainingBudget : 0} />
            </h3>
            <p>Still available to spend</p>
          </div>
          <div className="summary-card category-card">
            <span className="card-label">Highest Category</span>
            <h3>{d.highestCategory}</h3>
            <p>Top spending area right now</p>
          </div>
        </section>

        <section className="progress-box">
          <div className="progress-header">
            <h3>Budget Usage</h3>
            <span>{d.budgetPercentage}%</span>
          </div>
          <div className="progress-bar modern-progress">
            <div className="progress-fill" style={{ width: `${d.budgetPercentage}%` }}></div>
          </div>
          <p>Track your monthly budget performance visually.</p>
        </section>

        <DashboardCharts
          categoryLabels={d.categoryLabels}
          categoryData={d.categoryData}
          monthlyLabels={d.monthlyLabels}
          monthlyData={d.monthlyData}
          trendLabels={d.trendLabels}
          trendData={d.trendData}
        />

        <section className="form-card" id="expense-section">
          <h3>Filter, Search &amp; Sort Expenses</h3>
          <form method="GET" action="/dashboard" className="filter-grid">
            <input type="text" name="search" placeholder="Search by title" defaultValue={f.search} />
            <select name="category" defaultValue={f.category}>
              <option value="">All Categories</option>
              {d.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input type="date" name="start_date" defaultValue={f.startDate} />
            <input type="date" name="end_date" defaultValue={f.endDate} />
            <select name="sort_by" defaultValue={f.sortBy}>
              <option value="date">Sort by Date</option>
              <option value="amount">Sort by Amount</option>
              <option value="title">Sort by Title</option>
            </select>
            <select name="sort_order" defaultValue={f.sortOrder}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
            <button type="submit">Apply</button>
            <Link className="clear-filter-btn" href="/dashboard">
              Clear
            </Link>
          </form>
        </section>

        <section className="dual-form-grid">
          <div className="form-card">
            <h3>Set Monthly Budget</h3>
            <form action={setBudgetAction} className="expense-form">
              <input type="number" step="0.01" min="0" name="budget_limit" placeholder="Enter monthly budget" required />
              <SubmitButton>Set Budget</SubmitButton>
            </form>
          </div>

          <div className="form-card premium-expense-card">
            <div className="expense-card-header">
              <div>
                <span className="section-badge">Quick Entry</span>
                <h3>Add New Expense</h3>
                <p>Record your spending beautifully and keep your budget under control.</p>
              </div>
              <div className="expense-header-icon">💸</div>
            </div>

            <form action={addExpenseAction} className="premium-expense-form">
              <div className="premium-form-grid">
                <div className="input-box">
                  <label>Expense Title</label>
                  <input type="text" name="title" placeholder="e.g. Grocery Shopping" required />
                </div>
                <div className="input-box">
                  <label>Amount</label>
                  <input type="number" step="0.01" min="0.01" name="amount" placeholder="e.g. 500" required />
                </div>
                <div className="input-box">
                  <label>Category</label>
                  <select name="category" required defaultValue="">
                    <option value="">Select Category</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-box">
                  <label>Date</label>
                  <input type="date" name="date" required />
                </div>
              </div>

              <div className="expense-tip-box">
                <span>✨</span>
                <p>Add each expense with the correct category to get better charts and financial insights.</p>
              </div>

              <SubmitButton className="premium-add-btn">+ Add Expense</SubmitButton>
            </form>
          </div>
        </section>

        <section className="action-row" id="reports-section">
          <ReportForm kind="xlsx" filtered={false} label="Send Excel Report" className="report-btn" p={filterParams} />
          <ReportForm kind="pdf" filtered={false} label="Send PDF Report" className="report-btn pdf-btn" p={filterParams} />
          <a className="report-btn download-btn" href="/download_pdf_report">
            Download PDF
          </a>
          <ReportForm kind="xlsx" filtered label="Filtered Excel" className="report-btn" p={filterParams} />
          <ReportForm kind="pdf" filtered label="Filtered PDF" className="report-btn pdf-btn" p={filterParams} />
        </section>

        <FlashBox messages={messages} className="flash-box" />

        <section className="table-card premium-table-card">
          <div className="table-top-banner">
            <div>
              <span className="section-badge">Expense Records</span>
              <h3>Your Expenses</h3>
              <p>View, edit and manage your spending history in a clean premium table layout.</p>
            </div>
            <div className="table-banner-icon">📑</div>
          </div>

          <div className="table-header-row premium-table-header">
            <div className="table-summary-chip">
              <span>📌</span>
              <strong>{d.expenses.length}</strong>
              <small>records on this page</small>
            </div>
            <div className="table-summary-chip">
              <span>📊</span>
              <strong>{d.page}</strong>
              <small>current page</small>
            </div>
          </div>

          <div className="premium-table-wrapper">
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Amount</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {d.expenses.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="expense-title-cell">
                        <div className="expense-dot"></div>
                        <span>{e.title}</span>
                      </div>
                    </td>
                    <td>
                      <span className="amount-pill">₹ {e.amount.toFixed(2)}</span>
                    </td>
                    <td>
                      <span className="category-pill">{e.category}</span>
                    </td>
                    <td>{e.date}</td>
                    <td className="table-actions">
                      <Link className="edit-btn" href={`/edit_expense/${e.id}`}>
                        Edit
                      </Link>
                      <form action={deleteExpenseAction.bind(null, e.id)} className="inline-form">
                        <SubmitButton className="delete-btn">Delete</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
                {!d.expenses.length ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty-table-box">
                        <div className="empty-table-icon">📭</div>
                        <h4>No expenses found</h4>
                        <p>No records match your selected filters.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="pagination-box premium-pagination">
            {d.page > 1 ? (
              <Link className="page-btn" href={pageHref(d.page - 1)}>
                Previous
              </Link>
            ) : null}
            {pageNumbers.map((n) =>
              n === d.page ? (
                <span key={n} className="page-btn active-page">
                  {n}
                </span>
              ) : (
                <Link key={n} className="page-btn" href={pageHref(n)}>
                  {n}
                </Link>
              ),
            )}
            {d.page < d.totalPages ? (
              <Link className="page-btn" href={pageHref(d.page + 1)}>
                Next
              </Link>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
