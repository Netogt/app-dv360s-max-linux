// Prévia ao vivo: enquanto ligada, cada quadro desenhado no palco também vai para o cooler
// (sem compilar o tema). O palco chama `liveFrame(t)` ao desenhar; aqui o quadro é refeito a
// 480 px, limitado ao fps do tema, e enviado ao player, que o mostra no lugar do tema.

import { useSyncExternalStore } from "react";
import { api } from "./io";
import { drawScene } from "./render/draw";
import { curLayers, store } from "./store";
import { SIZE } from "./types";
import { toast } from "./ui/feedback";

/** sem mudanças, avisa o player que continua ao vivo (ele desiste após 3 s) */
const PING_MS = 1000;
/** e reenvia o quadro de vez em quando, caso o player tenha sido reiniciado */
const RESEND_MS = 5000;
const MAX_FPS = 30;

let on = false;
let canvas: HTMLCanvasElement | null = null;
let pendingT: number | null = null;
let lastT = 0;
let inflight = false;
let scheduled = false;
let lastSent = 0;
let lastPing = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let warned = false;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

function render(t: number): Uint8Array {
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingQuality = "high";
  drawScene(ctx, curLayers(), { t, now: new Date(), mode: "preview" });
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  return new Uint8Array(img.data.buffer);
}

async function pump() {
  scheduled = false;
  if (!on || inflight || pendingT == null) return;
  const gap = 1000 / Math.min(MAX_FPS, store.get().project.fps);
  const wait = lastSent + gap - performance.now();
  if (wait > 0) {
    scheduled = true;
    setTimeout(pump, wait);
    return;
  }
  const t = pendingT;
  pendingT = null;
  inflight = true;
  try {
    await api.liveFrame(render(t), store.get().project.quality);
    warned = false;
  } catch (e) {
    // o player pode estar subindo; só avisa uma vez
    if (!warned) {
      warned = true;
      toast(`Prévia ao vivo: ${e}`, "error");
    }
  } finally {
    lastSent = performance.now();
    inflight = false;
    if (pendingT != null && !scheduled) pump();
  }
}

/** O palco desenhou o instante `t`: manda para o cooler (se ao vivo). */
export function liveFrame(t: number) {
  lastT = t;
  if (!on) return;
  pendingT = t;
  if (!scheduled) pump();
}

function tick() {
  const now = performance.now();
  if (now - lastSent >= RESEND_MS) liveFrame(lastT);
  else if (now - lastSent >= PING_MS && now - lastPing >= PING_MS) {
    lastPing = now;
    api.livePing().catch(() => {});
  }
}

export function setLive(v: boolean) {
  if (v === on) return;
  on = v;
  warned = false;
  clearInterval(timer);
  if (on) {
    timer = setInterval(tick, PING_MS);
    liveFrame(lastT);
  } else {
    pendingT = null;
    api.liveEnd().catch(() => {});
  }
  emit();
}

export const isLive = () => on;

export function useLive(): boolean {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
    () => on,
  );
}

window.addEventListener("beforeunload", () => {
  if (on) api.liveEnd().catch(() => {});
});
