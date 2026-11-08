"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { deleteRows, getOne, insertRow, updateRows, upsertRow } from "@/lib/db";
import { sendAttachmentEmail } from "@/lib/email";
import { flash } from "@/lib/flash";
import {
  checkAndSendBudgetAlert,
  currentMonth,
  getFilteredExpenses,
  isValidDay,
  parseMoneyInput,
} from "@/lib/personal";
import { createExcelReport, createPdfReport } from "@/lib/reports";
import { requireUser } from "@/lib/session";

const str = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

export async function setBudgetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const limit = parseMoneyInput(str(formData, "budget_limit"), { allowZero: true });
  if (limit === null) {
    await flash("Enter a valid non-negative budget.");
    redirect("/dashboard");
  }
  await upsertRow(
    "budgets",
    { user_id: user.uid, month: currentMonth(), budget_limit: limit, warning_sent: 0, overflow_sent: 0 },
    "user_id,month",
  );
  await flash("Monthly budget set successfully.");
  redirect("/dashboard");
}

export async function addExpenseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = str(formData, "title").trim();
  const category = str(formData, "category").trim();
  const day = str(formData, "date").trim();
  const amount = parseMoneyInput(str(formData, "amount"));
  if (amount === null || !isValidDay(day)) {
    await flash("Enter a valid positive amount and date.");
    redirect("/dashboard");
  }
  if (!title || !category) {
    await flash("Please fill all expense fields.");
    redirect("/dashboard");
  }
  await insertRow("expenses", {
    user_id: user.uid,
    title,
    amount,
    category,
    date: day,
    created_at: new Date().toISOString(),
  });
  // Emails can be slow; send them after the response so the page isn't held up.
  after(() => checkAndSendBudgetAlert(user.uid, user.email, user.name).catch((e) => console.error(e)));
  await flash("Expense added successfully.");
  redirect("/dashboard");
}

export async function updateExpenseAction(expenseId: number, formData: FormData): Promise<void> {
  const user = await requireUser();
  const expense = await getOne("expenses", { id: expenseId, user_id: user.uid });
  if (!expense) {
    await flash("Expense not found.");
    redirect("/dashboard");
  }
  const title = str(formData, "title").trim();
  const category = str(formData, "category").trim();
  const day = str(formData, "date").trim();
  const amount = parseMoneyInput(str(formData, "amount"));
  if (amount === null || !title || !category || !isValidDay(day)) {
    await flash("Enter valid expense details.");
    redirect(`/edit_expense/${expenseId}`);
  }
  await updateRows("expenses", { id: expense.id, user_id: user.uid }, { title, amount, category, date: day });
  await flash("Expense updated successfully.");
  redirect("/dashboard");
}

export async function deleteExpenseAction(expenseId: number): Promise<void> {
  const user = await requireUser();
  await deleteRows("expenses", { id: expenseId, user_id: user.uid });
  await flash("Expense deleted successfully.");
  redirect("/dashboard");
}

/** Email an Excel/PDF report. Hidden fields: kind (xlsx|pdf), filtered (1|0) and the filter values. */
export async function emailReportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const kind = str(formData, "kind") === "pdf" ? "pdf" : "xlsx";
  const filtered = str(formData, "filtered") === "1";
  const p = {
    category: str(formData, "category").trim(),
    start_date: str(formData, "start_date").trim(),
    end_date: str(formData, "end_date").trim(),
    search: str(formData, "search").trim(),
    sort_by: str(formData, "sort_by").trim() || "date",
    sort_order: str(formData, "sort_order").trim() || "desc",
  };
  const expenses = await getFilteredExpenses(user.uid, {
    category: filtered ? p.category : "",
    startDate: filtered ? p.start_date : "",
    endDate: filtered ? p.end_date : "",
    search: filtered ? p.search : "",
    sortBy: p.sort_by,
    sortOrder: p.sort_order,
  });
  const report =
    kind === "pdf"
      ? await createPdfReport(expenses, user.name, filtered)
      : await createExcelReport(expenses, user.name, filtered);
  let target = "/dashboard";
  if (!report) {
    await flash("No expense records found.");
  } else {
    const result = await sendAttachmentEmail(
      user.email,
      `Your ${filtered ? "Filtered " : ""}Expense Tracker ${kind.toUpperCase()} Report`,
      "Please find your expense report attached.",
      { filename: report.fileName, content: report.bytes, contentType: report.contentType },
    );
    await flash(result.message);
    if (filtered) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(p)) if (v) qs.set(k, v);
      target = `/dashboard?${qs}`;
    }
  }
  redirect(target);
}
