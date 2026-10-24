// "Compila" o projeto no formato que o player entende (ver crates/core/src/theme.rs):
// - camadas contíguas que não dependem do relógio viram quadros prontos (JPEG na base, PNG
//   com alfa acima de um relógio); com GIF/vídeo, uma sequência de quadros em loop;
// - hora/data viram um atlas de sprites + template, montados ao vivo pelo player.

import type { ClockLayer, Layer, Project } from "../types";
import { SIZE } from "../types";
import { ensureVideoFrame, getAsset, loopDuration, mediaTime } from "./assets";
import { drawLayer, isAnimated } from "./draw";
import { ruleSpec } from "./rules";
import { measureRun, paintRun, parseTemplate, setupText, spriteTexts, textPad } from "./text";

export interface Progress {
  done: number;
  total: number;
  label: string;
}

export interface CompiledTheme {
  files: Record<string, Uint8Array>;
  frames: number;
  bytes: number;
}

/** O DRA aceita no máximo 0xFFFF - 32 bytes de JPEG. */
const MAX_JPEG = 0xffff - 32;
const ATLAS_MAX_W = 2048;

type Seg = { kind: "frames"; layers: Layer[] } | { kind: "clock"; layer: ClockLayer };

export function segments(layers: Layer[]): Seg[] {
  const segs: Seg[] = [];
  let cur: Layer[] = [];
  segs.push({ kind: "frames", layers: cur });
  for (const l of layers) {
    if (!l.visible || l.opacity <= 0) continue;
    if (l.kind === "clock") {
      segs.push({ kind: "clock", layer: l });
      cur = [];
      segs.push({ kind: "frames", layers: cur });
    } else cur.push(l);
  }
  // o primeiro grupo (base preta opaca) fica sempre, mesmo vazio
  return segs.filter((s, i) => i === 0 || s.kind === "clock" || s.layers.length > 0);
}

/** Quantos quadros cada grupo terá. */
export function frameCount(p: Project, layers: Layer[]): number {
  let dur = 0;
  for (const l of layers) {
    if ((l.kind === "media" || l.kind === "background") && isAnimated(l)) {
      dur = Math.max(dur, loopDuration(getAsset(l.asset), l));
    }
  }
  if (dur <= 0) return 1;
  return Math.max(2, Math.round(Math.min(dur, p.maxDuration) * p.fps));
}

export function estimateFrames(p: Project, layers: Layer[]): number {
  return segments(layers).reduce((n, s) => n + (s.kind === "frames" ? frameCount(p, s.layers) : 0), 0);
}

function toBlob(c: HTMLCanvasElement, type: string, q?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject) : reject(new Error("falha ao codificar"))),
      type,
      q,
    ),
  );
}

async function jpeg(c: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  let q = quality / 100;
  for (;;) {
    const b = await toBlob(c, "image/jpeg", q);
    if (b.length <= MAX_JPEG || q <= 0.3) return b;
    q -= 0.1;
  }
}

function buildAtlas(l: ClockLayer, atlasPath: string) {
  const s = l.style;
  const pieces = parseTemplate(l.template);
  const texts = spriteTexts(pieces, l.locale, s.transform);
  const pad = textPad(s);
  const h = Math.ceil(s.fontSize * Math.max(1.2, s.lineHeight)) + pad * 2;
  const measure = document.createElement("canvas").getContext("2d")!;
  setupText(measure, s);

  // empacotamento em prateleiras
  const sprites: Record<string, { r: [number, number, number, number]; adv: number; ox: number }> = {};
  let x = 0;
  let y = 0;
  let atlasW = 0;
  const place: [string, string, number, number][] = [];
  for (const [key, str] of texts) {
    const adv = measureRun(measure, str, s);
    const w = Math.ceil(adv + Math.abs(s.letterSpacing)) + pad * 2;
    if (x > 0 && x + w > ATLAS_MAX_W) {
      x = 0;
      y += h;
    }
    sprites[key] = { r: [x, y, w, h], adv, ox: pad };
    place.push([key, str, x, y]);
    x += w;
    atlasW = Math.max(atlasW, x);
  }
  const c = document.createElement("canvas");
  c.width = Math.max(1, atlasW);
  c.height = y + h;
  const ctx = c.getContext("2d")!;
  setupText(ctx, s);
  for (const [, str, px, py] of place) paintRun(ctx, str, px + pad, py + h / 2, s);

  const spec = {
    type: "text",
    box: [l.x, l.y, l.w, l.h],
    rotation: l.rotation,
    opacity: l.opacity,
    align: s.align,
    atlas: atlasPath,
    spriteHeight: h,
    sprites,
    pieces: pieces.map((p, i) => ("lit" in p ? { lit: `l${i}` } : { tok: p.tok })),
  };
  return { spec, canvas: c };
}

export async function compileTheme(
  p: Project,
  onProgress: (pr: Progress) => void,
  signal?: AbortSignal,
): Promise<CompiledTheme> {
  await document.fonts?.ready;
  for (const sc of p.screens) {
    for (const l of sc.layers) {
      if (!l.visible || (l.kind !== "media" && l.kind !== "background")) continue;
      const a = getAsset(l.asset);
      if (!a) continue;
      await a.ready;
    }
  }

  const plan = p.screens.map((sc) => {
    const segs = segments(sc.layers);
    return { sc, segs, counts: segs.map((s) => (s.kind === "frames" ? frameCount(p, s.layers) : 0)) };
  });
  const total = plan.reduce((n, x) => n + x.counts.reduce((a, b) => a + b, 0), 0);
  const files: Record<string, Uint8Array> = {};
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const now = new Date();
  let done = 0;
  let bytes = 0;
  const screens: unknown[] = [];

  for (let ki = 0; ki < plan.length; ki++) {
    const { sc, segs, counts } = plan[ki];
    const specs: unknown[] = [];
    const multi = plan.length > 1 ? ` · tela “${sc.name}”` : "";
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      if (signal?.aborted) throw new DOMException("cancelado", "AbortError");
      if (seg.kind === "clock") {
        const path = `render/k${ki}/t${si}.png`;
        const { spec, canvas: atlas } = buildAtlas(seg.layer, path);
        files[path] = await toBlob(atlas, "image/png");
        bytes += files[path].length;
        specs.push(spec);
        continue;
      }
      const opaque = si === 0;
      const ext = opaque ? "jpg" : "png";
      const dir = `render/k${ki}/s${si}`;
      const n = counts[si];
      for (let i = 0; i < n; i++) {
        if (signal?.aborted) throw new DOMException("cancelado", "AbortError");
        const t = i / p.fps;
        ctx.clearRect(0, 0, SIZE, SIZE);
        if (opaque) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, SIZE, SIZE);
        }
        for (const l of seg.layers) {
          if ((l.kind === "media" || l.kind === "background") && l.asset) {
            const a = getAsset(l.asset);
            if (a?.meta.type === "video") await ensureVideoFrame(a, mediaTime(a, l, t));
          }
          drawLayer(ctx, l, { t, now, mode: "bake" });
        }
        const name = `${dir}/${String(i).padStart(5, "0")}.${ext}`;
        files[name] = opaque ? await jpeg(canvas, p.quality) : await toBlob(canvas, "image/png");
        bytes += files[name].length;
        done++;
        onProgress({ done, total, label: total > plan.length ? `Renderizando quadro ${done} de ${total}${multi}` : "Renderizando" });
      }
      specs.push({ type: "frames", dir, count: n, ext, opaque });
    }
    screens.push({ name: sc.name, any: sc.any, rules: sc.rules.map(ruleSpec), segments: specs });
  }

  const manifest = {
    format: "dv360s-theme",
    version: 2,
    name: p.name,
    fps: p.fps,
    quality: p.quality,
    hold: p.hold,
    hysteresis: p.hysteresis ?? 0,
    screens,
  };
  files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
  return { files, frames: total, bytes };
}
