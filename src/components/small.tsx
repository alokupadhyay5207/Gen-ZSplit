"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function CopyButton({ text, children }: { text: string; children?: ReactNode }) {
  const [label, setLabel] = useState("Copy code");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setLabel("Copied");
    setTimeout(() => setLabel("Copy code"), 1800);
  }
  return (
    <button type="button" className="gz-btn gz-btn--soft gz-btn--sm" onClick={copy}>
      <Icon name="copy" /> <span>{children ?? label}</span>
    </button>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField(props: {
  id: string;
  name: string;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="gz-pw">
      <input className="gz-input" type={show ? "text" : "password"} required {...props} />
      <button
        type="button"
        className="gz-iconbtn"
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        <Icon name={show ? "eye-off" : "eye"} />
      </button>
    </div>
  );
}
