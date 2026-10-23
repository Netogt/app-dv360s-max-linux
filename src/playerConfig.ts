// Configuração do player (brilho, rotação) compartilhada entre a barra superior e o palco.
// Grava em ~/.config/dv360s-studio/player.json; o player relê sozinho em até 1 s.

import { useSyncExternalStore } from "react";
import { api, type PlayerConfig } from "./io";
import { toast } from "./ui/feedback";
import { debounce } from "./util";

let config: PlayerConfig | null = null;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

const save = debounce((c: PlayerConfig) => {
  api.setConfig(c).catch((e) => toast(String(e), "error"));
}, 200);

export const playerConfig = {
  get: () => config,
  /** Primeira leitura (vem junto com o status do player). */
  init(c: PlayerConfig) {
    if (config) return;
    config = c;
    emit();
  },
  update(patch: Partial<PlayerConfig>) {
    if (!config) return;
    config = { ...config, ...patch };
    emit();
    save(config);
  },
};

export function usePlayerConfig(): PlayerConfig | null {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
    () => config,
  );
}

export const ROTATIONS = [0, 90, 180, 270] as const;

export function nextRotation(r: number): number {
  return ROTATIONS[(ROTATIONS.indexOf(r as (typeof ROTATIONS)[number]) + 1) % ROTATIONS.length];
}
