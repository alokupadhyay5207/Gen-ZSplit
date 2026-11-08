"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";

export type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  leaving: boolean;
}

const Ctx = createContext<{ push: (kind: ToastKind, message: string) => void }>({ push: () => {} });
export const useToast = () => useContext(Ctx);

const ICON: Record<ToastKind, string> = { success: "check-circle", error: "alert", info: "info" };

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timer.current = setTimeout(() => onDismiss(toast.id), toast.kind === "error" ? 9000 : 5500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast.id, toast.kind, onDismiss]);
  return (
    <div
      className={`gz-toast gz-toast--${toast.kind}${toast.leaving ? " is-leaving" : ""}`}
      role={toast.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => timer.current && clearTimeout(timer.current)}
    >
      <Icon name={ICON[toast.kind]} />
      <p>{toast.message}</p>
      <button type="button" className="gz-iconbtn gz-iconbtn--sm" aria-label="Dismiss message" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    setToasts((t) => [...t.slice(-3), { id: nextId.current++, kind, message, leaving: false }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 260);
  }, []);

  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {toasts.length ? (
        <div className="gz-toasts" role="region" aria-label="Notifications">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

/** Shows one toast when the page first renders (e.g. from a whitelisted ?notice= code), then cleans the URL. */
export function ToastOnMount({ kind, message }: { kind: ToastKind; message: string }) {
  const { push } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    push(kind, message);
    router.replace(pathname);
  }, [kind, message, push, router, pathname]);
  return null;
}
