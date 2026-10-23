// Condições das telas — mesma lógica de crates/core/src/rules.rs (sem a folga e o tempo
// mínimo, que só fazem sentido no player). Usado para mostrar qual tela vale agora.

import type { Project, Rule, Screen, SensorName } from "../types";
import type { Readings } from "./text";

export const SENSOR_INFO: Record<SensorName, { label: string; unit: string; max: number }> = {
  cpuTemp: { label: "Temperatura da CPU", unit: "°C", max: 120 },
  gpuHot: { label: "Hotspot da GPU", unit: "°C", max: 120 },
  gpuTemp: { label: "Temperatura da GPU", unit: "°C", max: 120 },
  cpuUse: { label: "Uso da CPU", unit: "%", max: 100 },
  gpuUse: { label: "Uso da GPU", unit: "%", max: 100 },
  ramUse: { label: "Uso da RAM", unit: "%", max: 100 },
};

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const hhmm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? (h % 24) * 60 + (m % 60) : null;
};
const mmdd = (s: string) => {
  const [m, d] = s.split("-").map(Number);
  return Number.isFinite(m) && Number.isFinite(d) ? m * 100 + d : null;
};

function inWrapped(v: number, a: number, b: number, endInclusive: boolean) {
  const beforeEnd = endInclusive ? v <= b : v < b;
  return a <= b ? v >= a && beforeEnd : v >= a || beforeEnd;
}

export function ruleOk(r: Rule, now: Date, sens: Readings): boolean {
  switch (r.type) {
    case "time": {
      const a = hhmm(r.from);
      const b = hhmm(r.to);
      if (a == null || b == null) return false;
      return a === b || inWrapped(now.getHours() * 60 + now.getMinutes(), a, b, false);
    }
    case "weekday":
      return r.days.includes(now.getDay());
    case "date": {
      const a = mmdd(r.from);
      const b = mmdd(r.to);
      return a != null && b != null && inWrapped((now.getMonth() + 1) * 100 + now.getDate(), a, b, true);
    }
    case "sensor": {
      const v = sens[r.sensor];
      if (v == null) return false;
      return r.op === "<=" ? v <= r.value : v >= r.value;
    }
  }
}

export function screenOk(sc: Screen, now: Date, sens: Readings): boolean {
  if (sc.rules.length === 0) return false;
  return sc.any ? sc.rules.some((r) => ruleOk(r, now, sens)) : sc.rules.every((r) => ruleOk(r, now, sens));
}

/** Índice da tela que o player mostraria agora. */
export function activeScreen(p: Project, now: Date, sens: Readings): number {
  for (let i = 1; i < p.screens.length; i++) if (screenOk(p.screens[i], now, sens)) return i;
  return 0;
}

export const rulesUseSensors = (p: Project) => p.screens.some((sc) => sc.rules.some((r) => r.type === "sensor"));

/** Formato do manifest (sem o id usado só no editor). */
export function ruleSpec(r: Rule) {
  const { id: _id, ...rest } = r;
  return rest;
}

export function describeRule(r: Rule): string {
  switch (r.type) {
    case "time":
      return `${r.from} às ${r.to}`;
    case "weekday":
      return r.days.length === 7 ? "todos os dias" : r.days.map((d) => WEEKDAYS[d]).join(", ") || "nenhum dia";
    case "date": {
      const f = (s: string) => {
        const [m, d] = s.split("-").map(Number);
        return `${d}/${MONTHS[(m - 1 + 12) % 12]}`;
      };
      return `${f(r.from)} a ${f(r.to)}`;
    }
    case "sensor": {
      const i = SENSOR_INFO[r.sensor];
      return `${i.label} ${r.op === ">=" ? "≥" : "≤"} ${r.value}${i.unit}`;
    }
  }
}
