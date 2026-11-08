"use client";

import { useEffect, useMemo, useState } from "react";
import { addExpenseAction } from "@/actions/groups";
import { Avatar } from "./Avatar";
import { ActionForm, FormError, GzSubmit } from "./action-form";
import { Icon } from "./Icon";
import { CloseModalButton, Modal, ModalHead } from "./modal";

interface Member {
  user_id: number;
  name: string;
}
type Method = "equal" | "exact" | "percentage";

interface Props {
  groupId: number;
  currency: string;
  symbol: string;
  exponent: number;
  members: Member[];
  meId: number;
  categories: readonly string[];
  today: string;
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The add-expense dialog. A server error shows inside it and keeps every field as typed. */
export function ExpenseModal(props: Props) {
  const [formKey, setFormKey] = useState(0); // bumping the key resets every field after a successful add
  return (
    <Modal id="expense-modal" wide>
      <ActionForm
        key={formKey}
        className="gz-modal-form"
        id="expense-form"
        action={(fd) => addExpenseAction(props.groupId, fd)}
        inlineError
        resetOnSuccess={false}
        onSuccess={() => setFormKey((k) => k + 1)}
      >
        <Body {...props} />
      </ActionForm>
    </Modal>
  );
}

function Body({ currency, symbol, exponent, members, meId, categories, today }: Props) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("equal");
  const [picked, setPicked] = useState<Set<number>>(() => new Set(members.map((m) => m.user_id)));
  const [exact, setExact] = useState<Record<number, string>>({});
  const [percent, setPercent] = useState<Record<number, string>>({});
  const [date, setDate] = useState(today);

  // Default to the visitor's own calendar day (the server only knows UTC).
  useEffect(() => {
    setDate((d) => (d === today ? localToday() : d));
  }, [today]);

  const scale = 10 ** exponent;
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const toMinor = (v: string): number | null => {
    const t = v.replace(/,/g, "").trim();
    return /^\d+(\.\d+)?$/.test(t) ? Math.round(parseFloat(t) * scale) : null;
  };
  const fmt = (minor: number) =>
    symbol + (minor / scale).toLocaleString(locale, { minimumFractionDigits: exponent, maximumFractionDigits: exponent });

  const summary = useMemo(() => {
    const ids = members.filter((m) => picked.has(m.user_id)).map((m) => m.user_id);
    const total = toMinor(amount);
    if (method === "equal") {
      if (!ids.length) return { cls: "is-bad", text: "Pick at least one person." };
      if (!total) return { cls: "", text: "Enter an amount to see each share." };
      const base = Math.floor(total / ids.length);
      const rem = total - base * ids.length;
      return {
        cls: "is-ok",
        text: `${fmt(base)} each${rem ? ` (plus ${rem} smallest unit${rem > 1 ? "s" : ""} shared out)` : ""}`,
      };
    }
    if (method === "exact") {
      let sum = 0;
      let bad = false;
      for (const id of ids) {
        const v = toMinor(exact[id] ?? "");
        if (v === null) bad = true;
        else sum += v;
      }
      if (!total) return { cls: "", text: "Enter the total amount first." };
      if (bad) return { cls: "is-bad", text: "Fill in an amount for everyone selected (0 is fine)." };
      if (sum === total) return { cls: "is-ok", text: `Adds up to ${fmt(total)}.` };
      return { cls: "is-bad", text: `${fmt(Math.abs(total - sum))}${sum < total ? " still to assign." : " over the total."}` };
    }
    let pct = 0;
    let bad = false;
    for (const id of ids) {
      const raw = (percent[id] ?? "").trim();
      if (!/^\d+(\.\d{1,2})?$/.test(raw)) bad = true;
      else pct += Math.round(parseFloat(raw) * 100);
    }
    if (bad) return { cls: "is-bad", text: "Fill in a percentage for everyone selected." };
    if (pct === 10000) return { cls: "is-ok", text: "Adds up to 100%." };
    return { cls: "is-bad", text: `${pct / 100}% assigned. Needs to be exactly 100%.` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, method, picked, exact, percent, members]);

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div data-method={method} style={{ display: "contents" }}>
      <ModalHead id="expense-modal" title="Add an expense" sub="Paid by one person, shared however you like." />
      <div className="gz-modal-body">
        <FormError />

        <div className="gz-field">
          <label className="gz-label" htmlFor="ex-amount">
            Amount
          </label>
          <div className="gz-amount">
            <span className="gz-amount-sym" aria-hidden="true">
              {symbol}
            </span>
            <input
              id="ex-amount"
              name="amount"
              data-autofocus
              inputMode="decimal"
              autoComplete="off"
              required
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="gz-field">
          <label className="gz-label" htmlFor="ex-title">
            What was it for?
          </label>
          <input className="gz-input" id="ex-title" name="title" required maxLength={120} placeholder="Beach shack dinner" />
        </div>

        <div className="gz-row">
          <div className="gz-field">
            <label className="gz-label" htmlFor="ex-cat">
              Category
            </label>
            <select className="gz-select" id="ex-cat" name="category" defaultValue="Food">
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="gz-field">
            <label className="gz-label" htmlFor="ex-date">
              Date
            </label>
            <input className="gz-input" id="ex-date" type="date" name="expense_date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="gz-field">
          <label className="gz-label" htmlFor="ex-paid">
            Paid by
          </label>
          <select className="gz-select" id="ex-paid" name="paid_by" defaultValue={String(meId)}>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
                {m.user_id === meId ? " (you)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="gz-field">
          <span className="gz-label" id="ex-method-label">
            How should it be split?
          </span>
          <div className="gz-seg" role="radiogroup" aria-labelledby="ex-method-label">
            {(
              [
                ["equal", "Equally"],
                ["exact", "By amount"],
                ["percentage", "By percent"],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input type="radio" name="split_method" value={value} checked={method === value} onChange={() => setMethod(value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="gz-people">
          <div className="gz-people-bar">
            <span className="gz-label">Split between</span>
            <span>
              <button type="button" className="gz-linkbtn" onClick={() => setPicked(new Set(members.map((m) => m.user_id)))}>
                Everyone
              </button>
              <button type="button" className="gz-linkbtn" onClick={() => setPicked(new Set())}>
                No one
              </button>
            </span>
          </div>
          {members.map((m) => {
            const checked = picked.has(m.user_id);
            return (
              <label className="gz-person" key={m.user_id}>
                <input className="gz-check" type="checkbox" name="participants" value={m.user_id} checked={checked} onChange={() => toggle(m.user_id)} />
                <Avatar name={m.name} />
                <span className="gz-person-name">
                  {m.name}
                  {m.user_id === meId ? <span className="gz-faint"> (you)</span> : null}
                </span>
                <span className="gz-person-value">
                  <span className="gz-unit gz-unit-cur">{symbol}</span>
                  <input
                    name={`exact_${m.user_id}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    aria-label={`Amount for ${m.name}`}
                    value={exact[m.user_id] ?? ""}
                    onChange={(e) => setExact((s) => ({ ...s, [m.user_id]: e.target.value }))}
                    disabled={!(checked && method === "exact")}
                  />
                  <input
                    name={`percent_${m.user_id}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    aria-label={`Percent for ${m.name}`}
                    value={percent[m.user_id] ?? ""}
                    onChange={(e) => setPercent((s) => ({ ...s, [m.user_id]: e.target.value }))}
                    disabled={!(checked && method === "percentage")}
                  />
                  <span className="gz-unit gz-unit-pct">%</span>
                </span>
              </label>
            );
          })}
          <div className={`gz-summary ${summary.cls}`.trim()} aria-live="polite">
            {summary.text}
          </div>
        </div>

        <div className="gz-field">
          <label className="gz-label" htmlFor="ex-notes">
            Notes <span className="gz-faint">(optional)</span>
          </label>
          <textarea className="gz-textarea" id="ex-notes" name="notes" rows={2} maxLength={500} placeholder="Anything the group should know" />
        </div>
      </div>
      <footer className="gz-modal-foot">
        <CloseModalButton className="gz-btn gz-btn--ghost">Cancel</CloseModalButton>
        <GzSubmit className="gz-btn gz-btn--primary">
          <Icon name="check" /> Add expense
        </GzSubmit>
      </footer>
    </div>
  );
}
