"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Submit button for server-action forms: disabled while the request is in flight (no double submits). */
export function SubmitButton({ className, children }: { className?: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending || undefined}>
      {children}
    </button>
  );
}

/** Flash messages queued by a server action; clears the one-shot cookie once shown. */
export function FlashBox({ messages, className }: { messages: string[]; className: string }) {
  const [shown, setShown] = useState(messages);
  const seen = useRef("");
  useEffect(() => {
    const key = JSON.stringify(messages);
    if (!messages.length || seen.current === key) return;
    seen.current = key;
    setShown(messages);
    document.cookie = "gz_flash=; Max-Age=0; path=/";
    const url = new URL(window.location.href);
    if (url.searchParams.has("notice")) {
      url.searchParams.delete("notice");
      window.history.replaceState(null, "", url);
    }
  }, [messages]);
  if (!shown.length) return null;
  return (
    <div className={className}>
      {shown.map((m, i) => (
        <p key={i}>{m}</p>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* storage may be blocked */
    }
    setTheme(next);
  }
  return (
    <button type="button" className="theme-toggle sidebar-theme-toggle" id="themeToggle" onClick={toggle}>
      {theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
    </button>
  );
}

/** Animated currency counter (1.2s ease from zero, like the original dashboard). */
export function Counter({ target }: { target: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / 1200, 1);
      setValue(p < 1 ? target * p : target);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <>₹ {value.toFixed(2)}</>;
}
