// Arquivos arrastados do sistema. O drag-and-drop HTML do WebKitGTK não entrega os arquivos
// vindos do gerenciador de arquivos de forma confiável, então quem recebe é o Tauri (nativo),
// que dá os caminhos e a posição do cursor; aqui decidimos se vira camada ou fundo.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useSyncExternalStore } from "react";
import { importPaths } from "./actions";

export type DropZone = "layer" | "bg";

let zone: DropZone | null = null;
const ls = new Set<() => void>();

function set(z: DropZone | null) {
  if (z === zone) return;
  zone = z;
  ls.forEach((l) => l());
}

/** Zona sob o cursor (a posição vem em pixels físicos). Fora do palco vira camada. */
function zoneAt(pos: { x: number; y: number }): DropZone {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
  return el?.closest<HTMLElement>("[data-zone]")?.dataset.zone === "bg" ? "bg" : "layer";
}

export function watchNativeDrop(): () => void {
  let unlisten: (() => void) | undefined;
  let alive = true;
  getCurrentWebview()
    .onDragDropEvent(({ payload: p }) => {
      if (p.type === "enter" || p.type === "over") set(zoneAt(p.position));
      else if (p.type === "drop") {
        const z = zoneAt(p.position);
        set(null);
        importPaths(p.paths, z === "bg");
      } else set(null);
    })
    .then((u) => (alive ? (unlisten = u) : u()))
    .catch(() => {
      // fora do Tauri (vite no navegador)
    });
  return () => {
    alive = false;
    unlisten?.();
  };
}

/** Zona destacada enquanto há um arrastar em andamento (null = nenhum). */
export function useDropZone(): DropZone | null {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
    () => zone,
  );
}
