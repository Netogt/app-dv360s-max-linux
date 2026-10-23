import { useEffect, useRef, useState, type ReactNode } from "react";
import { clamp } from "../util";
import { IconChevronDown } from "./icons";

export function Section({ title, children, actions, defaultOpen = true }: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? "open" : ""}`}>
      <header className="section-head">
        <button type="button" className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <IconChevronDown size={14} className="chev" />
          {title}
        </button>
        {actions}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, hint }: { label?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="row">
      {label && <span className="row-label" title={hint}>{label}</span>}
      <div className="row-control">{children}</div>
    </div>
  );
}

/** Campo numérico; arrastar o rótulo na horizontal ajusta o valor (como em editores de design). */
export function NumberField({ label, value, onChange, min = -99999, max = 99999, step = 1, suffix, title }: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
}) {
  const [text, setText] = useState(fmt(value, step));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value, step));
  }, [value, step]);

  const commit = (s: string) => {
    const v = Number(s.replace(",", "."));
    if (Number.isFinite(v)) onChange(clamp(v, min, max));
    else setText(fmt(value, step));
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = start + Math.round((ev.clientX - startX) / 2) * step * mult;
      onChange(clamp(Number(v.toFixed(4)), min, max));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <label className="num" title={title}>
      {label && (
        <span className="num-label" onPointerDown={scrub}>
          {label}
        </span>
      )}
      <input
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(fmt(value, step));
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clamp(Number((value + d).toFixed(4)), min, max);
            onChange(v);
            setText(fmt(v, step));
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  );
}

function fmt(v: number, step: number) {
  const dec = step < 1 ? Math.min(3, String(step).split(".")[1]?.length ?? 2) : 0;
  return Number(v.toFixed(dec)).toString();
}

export function Slider({ value, onChange, min, max, step = 1, format }: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <span className="slider-value">{format ? format(value) : value}</span>
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="color">
      <label className="swatch" style={{ background: value }}>
        <input type="color" value={HEX.test(value) ? value : "#000000"} onChange={(e) => onChange(e.currentTarget.value)} />
      </label>
      <input
        className="color-hex"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          const norm = v.startsWith("#") ? v : `#${v}`;
          if (HEX.test(norm)) onChange(norm.toLowerCase());
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

export function Select<T extends string | number>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="select">
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const opt = options.find((o) => String(o.value) === raw);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <IconChevronDown size={14} />
    </div>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label?: string; icon?: ReactNode; title?: string }[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title ?? o.label}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

/** Fecha ao clicar fora ou apertar Esc. */
export function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [open, close, ref]);
}
