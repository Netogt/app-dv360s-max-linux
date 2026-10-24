// Temperaturas ao vivo para a prévia. Só consulta o sistema enquanto alguma camada usa sensor.
// A simulação substitui valores lidos, para testar telas condicionais sem esquentar o PC.

import { useSyncExternalStore } from "react";
import { api } from "../io";
import { NO_READINGS, type Readings } from "./text";

let current: Readings = NO_READINGS;
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

let simulated: Partial<Readings> | null = null;
let merged: Readings = current;
const simListeners = new Set<() => void>();

export const liveReadings = () => merged;

function remerge() {
  merged = simulated ? { ...current, ...simulated } : current;
  listeners.forEach((l) => l());
}

/** Liga (objeto, mesmo vazio) ou desliga (null) a simulação; só os valores presentes substituem os reais. */
export function setSimulated(s: Partial<Readings> | null) {
  simulated = s;
  remerge();
  simListeners.forEach((l) => l());
}

export const realReadings = () => current;

export function useSimulated(): Partial<Readings> | null {
  return useSyncExternalStore(
    (l) => {
      simListeners.add(l);
      return () => {
        simListeners.delete(l);
      };
    },
    () => simulated,
  );
}

async function poll() {
  try {
    const next = await api.readSensors();
    const keys = Object.keys(next) as (keyof Readings)[];
    // a prévia só mostra inteiros: mudanças menores não precisam redesenhar
    if (keys.some((k) => Math.round(next[k] ?? -1) !== Math.round(current[k] ?? -1))) {
      current = next;
      remerge();
    }
  } catch {
    // fora do Tauri não há sensores
  }
}

/** Liga a leitura (1x por segundo) e avisa quando um valor muda. Devolve a função que desliga. */
export function watchSensors(onChange: () => void): () => void {
  listeners.add(onChange);
  if (users++ === 0) {
    poll();
    timer = setInterval(poll, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (--users === 0) clearInterval(timer);
  };
}
