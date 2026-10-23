// Avisos rápidos (toasts) e o modal de progresso da renderização.
import { useSyncExternalStore } from "react";
import { IconAlert, IconCheck, IconX } from "./icons";

type Kind = "info" | "success" | "error";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}
interface Busy {
  label: string;
  done: number;
  total: number;
  cancel?: () => void;
}

let toasts: Toast[] = [];
let busy: Busy | null = null;
let seq = 0;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());
const sub = (l: () => void) => {
  ls.add(l);
  return () => {
    ls.delete(l);
  };
};

export function toast(text: string, kind: Kind = "info") {
  const id = ++seq;
  toasts = [...toasts, { id, kind, text }].slice(-4);
  emit();
  setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3200);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function setBusy(b: Busy | null) {
  busy = b;
  emit();
}

export function Toasts() {
  const list = useSyncExternalStore(sub, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "error" ? <IconAlert size={16} /> : t.kind === "success" ? <IconCheck size={16} /> : null}
          <span>{t.text}</span>
          <button type="button" className="icon-btn ghost" onClick={() => dismiss(t.id)} aria-label="Fechar">
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function BusyModal() {
  const b = useSyncExternalStore(sub, () => busy);
  if (!b) return null;
  const pct = b.total > 0 ? Math.round((b.done / b.total) * 100) : 0;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={b.label}>
        <div className="modal-title">{b.label}</div>
        <div className="progress">
          <div className={`progress-bar ${b.total ? "" : "indeterminate"}`} style={{ width: b.total ? `${pct}%` : undefined }} />
        </div>
        <div className="modal-foot">
          <span className="muted">{b.total > 1 ? `${pct}%` : "Aguarde…"}</span>
          {b.cancel && (
            <button type="button" className="btn" onClick={b.cancel}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
