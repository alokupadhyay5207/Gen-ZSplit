/** Personal-expense data access and dashboard maths (port of the helpers in app.py). */
import "server-only";
import { fetchRows, getOne, updateRows, type Row } from "./db";
import { sendBudgetAlertEmail } from "./email";

export const EXPENSE_CATEGORIES = [
  "Food",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Utilities",
  "Health",
  "Education",
  "Other",
] as const;

export interface Expense {
  id: number;
  user_id: number;
  title: string;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  created_at: string;
}

export interface ExpenseFilters {
  category?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

/** True for a real YYYY-MM-DD day. Anything else is ignored instead of failing the query. */
export function isValidDay(value: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Current month as 'YYYY-MM' (UTC, like the Flask server on Vercel). */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function toExpense(row: Row): Expense {
  return { ...row, amount: Number(row.amount) } as Expense;
}

export async function getFilteredExpenses(userId: number, f: ExpenseFilters = {}): Promise<Expense[]> {
  const where: Record<string, unknown> = { user_id: userId };
  if (f.category) where.category = f.category;
  const sortField = f.sortBy && ["date", "amount", "title"].includes(f.sortBy) ? f.sortBy : "date";
  const descending = f.sortOrder !== "asc";
  const rows = await fetchRows("expenses", {
    where,
    order: [
      [sortField, descending],
      ["id", true],
    ],
    extra: (query) => {
      if (isValidDay(f.startDate)) query = query.gte("date", f.startDate);
      if (isValidDay(f.endDate)) query = query.lte("date", f.endDate);
      if (f.search) {
        const safe = f.search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
        query = query.ilike("title", `%${safe}%`);
      }
      return query;
    },
  });
  return rows.map(toExpense);
}

export const DASHBOARD_PAGE_SIZE = 5;

export interface Dashboard {
  expenses: Expense[]; // the current page
  totalExpense: number;
  budgetLimit: number;
  remainingBudget: number;
  budgetPercentage: number;
  highestCategory: string;
  categoryLabels: string[];
  categoryData: number[];
  monthlyLabels: string[];
  monthlyData: number[];
  trendLabels: string[];
  trendData: number[];
  categories: string[];
  page: number;
  totalPages: number;
}

export async function loadDashboard(userId: number, f: ExpenseFilters, requestedPage: number): Promise<Dashboard> {
  const [all, categoryRows, budget] = await Promise.all([
    getFilteredExpenses(userId, f),
    fetchRows("expenses", { where: { user_id: userId }, columns: "category" }),
    getOne("budgets", { user_id: userId, month: currentMonth() }),
  ]);
  const totalPages = Math.max(1, Math.ceil(all.length / DASHBOARD_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const expenses = all.slice((page - 1) * DASHBOARD_PAGE_SIZE, page * DASHBOARD_PAGE_SIZE);

  const totalExpense = all.reduce((sum, e) => sum + e.amount, 0);
  const budgetLimit = budget ? Number(budget.budget_limit) : 0;
  const remainingBudget = budgetLimit ? budgetLimit - totalExpense : 0;
  const budgetPercentage = budgetLimit
    ? Math.min(Math.max(Math.trunc((totalExpense / budgetLimit) * 100), 0), 100)
    : 0;

  // Maps keep insertion order, exactly like the Python dicts did.
  const byCategory = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const e of all) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0) + e.amount);
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.amount);
  }
  let highestCategory = "N/A";
  let best = -Infinity;
  for (const [cat, total] of byCategory) {
    if (total > best) {
      best = total;
      highestCategory = cat;
    }
  }

  return {
    expenses,
    totalExpense,
    budgetLimit,
    remainingBudget,
    budgetPercentage,
    highestCategory,
    categoryLabels: [...byCategory.keys()],
    categoryData: [...byCategory.values()],
    monthlyLabels: [...byMonth.keys()],
    monthlyData: [...byMonth.values()],
    trendLabels: [...byDay.keys()],
    trendData: [...byDay.values()],
    categories: [...new Set(categoryRows.map((r) => String(r.category)))].sort(),
    page,
    totalPages,
  };
}

/** Email a warning at 80% of the monthly budget and an overflow alert once it is exceeded (each sent once). */
export async function checkAndSendBudgetAlert(userId: number, email: string, name: string): Promise<void> {
  const month = currentMonth();
  const budget = await getOne("budgets", { user_id: userId, month });
  if (!budget) return;
  const [year, mon] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const [nextYear, nextMon] = mon === 12 ? [year + 1, 1] : [year, mon + 1];
  const firstDay = `${month}-01`;
  const nextFirstDay = `${String(nextYear).padStart(4, "0")}-${String(nextMon).padStart(2, "0")}-01`;
  const rows = await fetchRows("expenses", {
    where: { user_id: userId },
    columns: "amount",
    extra: (q) => q.gte("date", firstDay).lt("date", nextFirstDay),
  });
  const spent = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const limit = Number(budget.budget_limit);
  if (spent > limit && !budget.overflow_sent) {
    await sendBudgetAlertEmail(email, name, spent, limit, "overflow");
    await updateRows("budgets", { id: budget.id }, { overflow_sent: 1 });
  } else if (spent >= 0.8 * limit && !budget.warning_sent) {
    await sendBudgetAlertEmail(email, name, spent, limit, "warning");
    await updateRows("budgets", { id: budget.id }, { warning_sent: 1 });
  }
}

/** Strict decimal parse for amounts typed into the personal-expense forms. Returns null when invalid. */
export function parseMoneyInput(raw: string | null | undefined, opts: { allowZero?: boolean } = {}): number | null {
  const text = (raw ?? "").trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value > 9_999_999_999.99) return null;
  if (value === 0 && !opts.allowZero) return null;
  return value;
}
