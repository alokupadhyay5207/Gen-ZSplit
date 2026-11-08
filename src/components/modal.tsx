"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";

interface ModalCtx {
  open: string | null;
  openModal: (id: string) => void;
  closeModal: () => void;
}

const Ctx = createContext<ModalCtx>({ open: null, openModal: () => {}, closeModal: () => {} });
export const useModals = () => useContext(Ctx);

/** Only one dialog is open at a time; state lives here and <Modal> syncs the native <dialog>. */
export function ModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const openModal = useCallback((id: string) => setOpen(id), []);
  const closeModal = useCallback(() => setOpen(null), []);
  const value = useMemo(() => ({ open, openModal, closeModal }), [open, openModal, closeModal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FOCUS_FIRST =
  "[data-autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea";

export function Modal({
  id,
  wide = false,
  children,
}: {
  id: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, closeModal } = useModals();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open === id && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>(FOCUS_FIRST)?.focus({ preventScroll: true });
    } else if (open !== id && d.open) {
      d.close();
    }
  }, [open, id]);

  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeModal();
  };

  return (
    <dialog
      ref={ref}
      id={id}
      className={`gz-modal${wide ? " gz-modal--wide" : ""}`}
      aria-labelledby={`${id}-title`}
      onClose={() => closeModal()}
      onClick={onBackdrop}
    >
      {children}
    </dialog>
  );
}

export function ModalHead({ id, title, sub }: { id: string; title: string; sub?: string }) {
  const { closeModal } = useModals();
  return (
    <header className="gz-modal-head">
      <div>
        <h2 className="gz-h2" id={`${id}-title`}>
          {title}
        </h2>
        {sub ? <p className="gz-muted">{sub}</p> : null}
      </div>
      <button type="button" className="gz-iconbtn" onClick={closeModal} aria-label="Close dialog">
        <Icon name="close" />
      </button>
    </header>
  );
}

export function CloseModalButton({ className, children }: { className?: string; children: ReactNode }) {
  const { closeModal } = useModals();
  return (
    <button type="button" className={className} onClick={closeModal}>
      {children}
    </button>
  );
}

export function OpenModalButton({
  modal,
  className,
  children,
}: {
  modal: string;
  className?: string;
  children: ReactNode;
}) {
  const { openModal } = useModals();
  return (
    <button type="button" className={className} onClick={() => openModal(modal)}>
      {children}
    </button>
  );
}

/** Opens a dialog on mount (used for the ?add=1 deep link). */
export function AutoOpen({ modal }: { modal: string }) {
  const { openModal } = useModals();
  useEffect(() => {
    openModal(modal);
  }, [modal, openModal]);
  return null;
}
