"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm, GzSubmit } from "./action-form";
import { CloseModalButton, Modal, ModalHead, useModals } from "./modal";

export interface ConfirmSpec {
  title: string;
  body: string;
  button: string;
  action: () => Promise<ActionResult>;
}

const Ctx = createContext<(spec: ConfirmSpec) => void>(() => {});

/** One reusable confirmation dialog. Triggers are <ConfirmButton>s anywhere below the provider. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const { openModal } = useModals();
  return (
    <Ctx.Provider
      value={(s) => {
        setSpec(s);
        openModal("confirm-modal");
      }}
    >
      {children}
      <Modal id="confirm-modal">
        <ActionForm className="gz-modal-form" action={() => (spec ? spec.action() : Promise.resolve({ ok: false, error: "Nothing to confirm." }))}>
          <ModalHead id="confirm-modal" title={spec?.title ?? "Are you sure?"} />
          <div className="gz-modal-body">
            <p className="gz-muted">{spec?.body}</p>
          </div>
          <footer className="gz-modal-foot">
            <CloseModalButton className="gz-btn gz-btn--ghost">Keep it</CloseModalButton>
            <GzSubmit className="gz-btn gz-btn--danger">{spec?.button ?? "Confirm"}</GzSubmit>
          </footer>
        </ActionForm>
      </Modal>
    </Ctx.Provider>
  );
}

export function ConfirmButton({
  spec,
  className,
  label,
  children,
}: {
  spec: ConfirmSpec;
  className: string;
  label?: string;
  children: ReactNode;
}) {
  const ask = useContext(Ctx);
  return (
    <button type="button" className={className} aria-label={label} onClick={() => ask(spec)}>
      {children}
    </button>
  );
}
