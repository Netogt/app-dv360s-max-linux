// Desenho das camadas no canvas — usado pela prévia e pela renderização do tema.

import type { BackgroundLayer, DrawingLayer, Fill, Fit, Framing, Layer, MediaLayer, ShapeLayer } from "../types";
import { SIZE } from "../types";
import { deg2rad } from "../util";
import { getAsset, gifFrameAt, mediaTime, videoFrameAt, type RuntimeAsset } from "./assets";
import { liveReadings } from "./sensors";
import { drawClockLine, drawTextBlock, parseTemplate, spriteTexts } from "./text";

export interface DrawEnv {
  /** segundos desde o início do loop */
  t: number;
  now: Date;
  /** "preview": quadros ainda não decodificados usam o mais próximo; "bake": todos prontos */
  mode: "preview" | "bake";
}

export function isAnimated(l: Layer): boolean {
  if (l.kind !== "media" && l.kind !== "background") return false;
  const a = getAsset(l.asset);
  return !!a && a.duration > 0;
}

function fillStyle(ctx: CanvasRenderingContext2D, f: Fill, w: number, h: number): string | CanvasGradient {
  if (f.type === "solid") return f.color;
  if (f.type === "radial") {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, f.from);
    g.addColorStop(1, f.to);
    return g;
  }
  const r = deg2rad(f.angle - 90);
  const len = (Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r))) / 2;
  const dx = Math.cos(r) * len;
  const dy = Math.sin(r) * len;
  const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  g.addColorStop(0, f.from);
  g.addColorStop(1, f.to);
  return g;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface Source {
  src: CanvasImageSource;
  w: number;
  h: number;
}

function mediaSource(a: RuntimeAsset, p: MediaLayer | BackgroundLayer, env: DrawEnv): Source | null {
  if (a.error) return null;
  if (a.meta.type === "image") return a.image ? { src: a.image, w: a.width, h: a.height } : null;
  if (a.meta.type === "gif") {
    const f = gifFrameAt(a, mediaTime(a, p, env.t));
    return f ? { src: f, w: f.width, h: f.height } : null;
  }
  const f = videoFrameAt(a, mediaTime(a, p, env.t));
  return f ? { src: f, w: f.width, h: f.height } : null;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** Tamanho da mídia (mw × mh) desenhada numa caixa w × h, e o deslocamento do centro dela
 *  em relação ao centro da caixa. O foco escolhe qual parte aparece quando ela não cabe. */
export function framed(mw: number, mh: number, w: number, h: number, fit: Fit, fr: Framing) {
  const zoom = fr.zoom ?? 1;
  let dw = w;
  let dh = h;
  if (fit !== "fill") {
    const s = fit === "cover" ? Math.max(w / mw, h / mh) : Math.min(w / mw, h / mh);
    dw = mw * s;
    dh = mh * s;
  }
  dw *= zoom;
  dh *= zoom;
  const ox = (0.5 - (fr.focusX ?? 0.5)) * (dw - w);
  const oy = (0.5 - (fr.focusY ?? 0.5)) * (dh - h);
  return { dw, dh, ox, oy };
}

/** Desenha a mídia dentro da caixa centrada na origem. */
function drawFit(ctx: CanvasRenderingContext2D, m: Source, w: number, h: number, fit: Fit, fr: Framing) {
  // quadro de vídeo já fechado pelo cache (largura 0): o drawImage lançaria erro
  if (m.src instanceof ImageBitmap && m.src.width === 0) return;
  const { dw, dh, ox, oy } = framed(m.w, m.h, w, h, fit, fr);
  ctx.drawImage(m.src, ox - dw / 2, oy - dh / 2, dw, dh);
}

const drawingCache = new WeakMap<DrawingLayer["strokes"], HTMLCanvasElement>();

function drawingCanvas(l: DrawingLayer): HTMLCanvasElement {
  const hit = drawingCache.get(l.strokes);
  if (hit && hit.width === l.viewW && hit.height === l.viewH) return hit;
  const c = document.createElement("canvas");
  c.width = l.viewW;
  c.height = l.viewH;
  const ctx = c.getContext("2d")!;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of l.strokes) {
    ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    const p = s.points;
    if (p.length <= 2) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // curva suave passando pelos pontos médios
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  }
  drawingCache.set(l.strokes, c);
  return c;
}

function drawShape(ctx: CanvasRenderingContext2D, l: ShapeLayer) {
  const { w, h } = l;
  const sw = l.strokeWidth;
  const inset = sw / 2;
  const path = () => {
    if (l.shape === "rect") roundRectPath(ctx, -w / 2 + inset, -h / 2 + inset, w - sw, h - sw, l.radius);
    else {
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(0, w / 2 - inset), Math.max(0, h / 2 - inset), 0, 0, Math.PI * 2);
    }
  };
  path();
  if (l.fillEnabled && l.shape !== "ring") {
    ctx.fillStyle = l.fill;
    ctx.fill();
  }
  if (sw > 0) {
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = sw;
    ctx.stroke();
  }
}

export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, env: DrawEnv) {
  if (!l.visible || l.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = l.opacity;

  if (l.kind === "background") {
    ctx.fillStyle = fillStyle(ctx, l.fill, SIZE, SIZE);
    ctx.fillRect(0, 0, SIZE, SIZE);
    const a = getAsset(l.asset);
    const m = a && mediaSource(a, l, env);
    if (m) {
      ctx.translate(SIZE / 2, SIZE / 2);
      ctx.beginPath();
      ctx.rect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
      ctx.clip();
      drawFit(ctx, m, SIZE, SIZE, l.fit, l);
    }
    ctx.restore();
    return;
  }

  ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
  if (l.rotation) ctx.rotate(deg2rad(l.rotation));

  switch (l.kind) {
    case "media": {
      const a = getAsset(l.asset);
      const m = a && mediaSource(a, l, env);
      if (!m) break;
      roundRectPath(ctx, -l.w / 2, -l.h / 2, l.w, l.h, l.radius);
      ctx.clip();
      drawFit(ctx, m, l.w, l.h, l.fit, l);
      break;
    }
    case "text":
      drawTextBlock(ctx, l.text, l.style, l.w);
      break;
    case "clock": {
      // o player recorta a linha na caixa; a prévia faz o mesmo
      ctx.beginPath();
      ctx.rect(-l.w / 2, -l.h / 2, l.w, l.h);
      ctx.clip();
      const pieces = parseTemplate(l.template);
      drawClockLine(ctx, pieces, spriteTexts(pieces, l.locale, l.style.transform), env.now, liveReadings(), l.style, l.w);
      break;
    }
    case "shape":
      drawShape(ctx, l);
      break;
    case "drawing":
      if (l.strokes.length) ctx.drawImage(drawingCanvas(l), -l.w / 2, -l.h / 2, l.w, l.h);
      break;
  }
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, layers: Layer[], env: DrawEnv) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (const l of layers) drawLayer(ctx, l, env);
}
