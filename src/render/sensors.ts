// Temperaturas ao vivo para a prévia. Só consulta o sistema enquanto alguma camada usa sensor.

import { api } from "../io";
import { NO_READINGS, type Readings } from "./text";

let current: Readings = NO_READINGS;
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

export const liveReadings = () => current;

async function poll() {
  try {
    const next = await api.readSensors();
    const keys = Object.keys(next) as (keyof Readings)[];
    // a prévia só mostra inteiros: mudanças menores não precisam redesenhar
    if (keys.some((k) => Math.round(next[k] ?? -1) !== Math.round(current[k] ?? -1))) {
      current = next;
      listeners.forEach((l) => l());
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
