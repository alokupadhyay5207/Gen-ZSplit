import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { updateExpenseAction } from "@/actions/personal";
import { SubmitButton } from "@/components/LegacyBits";
import { getOne } from "@/lib/db";
import { EXPENSE_CATEGORIES } from "@/lib/personal";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Edit Expense" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const expense = await getOne("expenses", { id: Number(id), user_id: user.uid });
  if (!expense) redirect("/dashboard?notice=expense-not-found");

  return (
    <>
      <div className="top-bar">
        <div>
          <h1>Edit Expense</h1>
          <p>Update your expense details</p>
        </div>
        <Link className="logout-btn" href="/dashboard">
          Back to Dashboard
        </Link>
      </div>

      <div className="form-card">
        <h3>Edit Expense</h3>
        <form action={updateExpenseAction.bind(null, Number(id))} className="expense-form">
          <input type="text" name="title" defaultValue={expense.title} placeholder="Expense Title" required />
          <input type="number" step="0.01" name="amount" defaultValue={String(expense.amount)} placeholder="Amount" required />
          <select name="category" required defaultValue={expense.category}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!(EXPENSE_CATEGORIES as readonly string[]).includes(expense.category) ? (
              <option value={expense.category}>{expense.category}</option>
            ) : null}
          </select>
          <input type="date" name="date" defaultValue={expense.date} required />
          <SubmitButton>Update Expense</SubmitButton>
        </form>
      </div>
    </>
  );
}
