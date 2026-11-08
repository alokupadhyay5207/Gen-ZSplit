"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { Icon } from "./Icon";
import { useModals } from "./modal";
import { useToast } from "./toast";

const FormState = createContext<{ pending: boolean; error: string | null }>({ pending: false, error: null });

interface Props extends Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit"> {
  action: (formData: FormData) => Promise<ActionResult>;
  /** Show errors inside the form (<FormError/>) instead of as a toast. */
  inlineError?: boolean;
  /** Reset the native fields after success (turn off when the fields are React-controlled). */
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
  children: ReactNode;
}

const FAILURE = "Something went wrong on our side. Nothing was saved. Please try again.";

/**
 * Submits to a server action without a page reload, then toasts the outcome, closes the
 * open dialog and refreshes (or navigates). Failed submits keep every field as typed.
 * Double submits are blocked while a request is in flight.
 */
export function ActionForm({
  action,
  inlineError = false,
  resetOnSuccess = true,
  onSuccess,
  children,
  ...rest
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { closeModal } = useModals();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const form = e.currentTarget;
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        const res = await action(data);
        if (res.ok) {
          if (res.message) toast.push(res.kind ?? "success", res.message);
          if (resetOnSuccess) form.reset();
          onSuccess?.();
          closeModal();
          if (res.redirectTo) router.push(res.redirectTo);
          else router.refresh();
        } else {
          if (inlineError) setError(res.error);
          else toast.push("error", res.error);
          if (res.redirectTo) {
            closeModal();
            router.push(res.redirectTo);
          }
        }
      } catch (err) {
        console.error(err);
        if (inlineError) setError(FAILURE);
        else toast.push("error", FAILURE);
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <FormState.Provider value={{ pending, error }}>
      <form {...rest} onSubmit={onSubmit}>
        {children}
      </form>
    </FormState.Provider>
  );
}

/** Submit button that shows the busy state while the enclosing <ActionForm> is working. */
export function GzSubmit({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useContext(FormState);
  return (
    <button type="submit" className={`${className}${pending ? " is-busy" : ""}`} aria-busy={pending || undefined} disabled={pending}>
      {children}
    </button>
  );
}

/** Inline error banner for forms using `inlineError` (the add-expense dialog). */
export function FormError() {
  const { error } = useContext(FormState);
  if (!error) return null;
  return (
    <div className="gz-alert" role="alert">
      <Icon name="alert" />
      <span>{error}</span>
    </div>
  );
}
