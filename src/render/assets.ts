// Mídias carregadas na memória do editor. Os bytes ficam fora do estado (e do histórico de
// desfazer); o projeto guarda só o id.

import { listen } from "@tauri-apps/api/event";
import { decompressFrames, parseGIF } from "gifuct-js";
import { api } from "../io";
import type { AssetMeta, AssetType, Playback } from "../types";
import { extOf } from "../util";

export interface RuntimeAsset {
  meta: AssetMeta;
  bytes: Uint8Array;
  url: string;
  width: number;
  height: number;
  /** duração natural em segundos (0 = imagem fixa) */
  duration: number;
  image?: HTMLImageElement;
  gif?: { frames: ImageBitmap[]; ends: number[] };
  ready: Promise<void>;
  error?: string;
  /** vídeo: quadros JPEG extraídos pelo ffmpeg, decodificados sob demanda */
  seq?: VideoFrames;
  /** vídeo sendo preparado pelo ffmpeg (quadros prontos / previstos) */
  progress?: { done: number; total: number };
}

export interface LoadOpts {
  onProgress?: (done: number, total: number) => void;
  /** cancela a preparação do vídeo */
  signal?: AbortSignal;
}

interface VideoFrames {
  frames: Uint8Array[];
  fps: number;
  /** quadros já decodificados (os mais recentes) */
  cache: Map<number, ImageBitmap>;
  pending: Map<number, Promise<ImageBitmap | null>>;
}

/** Taxa e duração máxima da extração (o tema usa até 30 fps e loops de até 120 s). */
const VIDEO_FPS = 30;
const VIDEO_MAX_S = 120;
const VIDEO_CACHE = 90;

const assets = new Map<string, RuntimeAsset>();
const listeners = new Set<() => void>();

export function onAssetsChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const changed = () => listeners.forEach((l) => l());

export function detectType(mime: string, name: string): AssetType | null {
  if (mime === "image/gif" || /\.gif$/i.test(name)) return "gif";
  if (mime.startsWith("video/") || /\.(mp4|webm|mkv|mov|m4v|ogv)$/i.test(name)) return "video";
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|bmp|svg|avif)$/i.test(name)) return "image";
  return null;
}

export function getAsset(id: string | null | undefined): RuntimeAsset | undefined {
  return id ? assets.get(id) : undefined;
}

export function allAssets() {
  return assets;
}

function release(a: RuntimeAsset) {
  URL.revokeObjectURL(a.url);
  a.seq?.cache.forEach((bm) => bm.close());
  a.gif?.frames.forEach((bm) => bm.close());
}

export function clearAssets() {
  for (const a of assets.values()) release(a);
  assets.clear();
}

/** Esquece uma mídia (importação cancelada ou com erro). */
export function dropAsset(id: string) {
  const a = assets.get(id);
  if (!a) return;
  release(a);
  assets.delete(id);
  changed();
}

/** Limite de resolução guardada por quadro de GIF (a tela tem 480 px). */
const GIF_MAX = 720;

/** Reduz por amostragem simples (só para GIFs muito maiores que a tela). */
function downscale(src: Uint8ClampedArray, w: number, h: number, dw: number, dh: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / dw));
      const s = (sy * w + sx) * 4;
      const d = (y * dw + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

// A composição dos quadros é feita direto nos pixels. Copiar canvas para canvas (drawImage)
// não serve aqui: no WebKitGTK a cópia é adiada e todos os quadros saíam iguais ao último.
async function decodeGif(a: RuntimeAsset) {
  const buf = a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength) as ArrayBuffer;
  const gif = parseGIF(buf);
  const frames = decompressFrames(gif, true);
  const W = gif.lsd.width;
  const H = gif.lsd.height;
  const full = new Uint8ClampedArray(W * H * 4);
  const s = Math.min(1, GIF_MAX / Math.max(W, H));
  const dw = Math.max(1, Math.round(W * s));
  const dh = Math.max(1, Math.round(H * s));
  const out: ImageBitmap[] = [];
  const ends: number[] = [];
  let t = 0;
  let restore: Uint8ClampedArray | null = null;
  let prev: (typeof frames)[number] | null = null;
  for (const f of frames) {
    if (prev?.disposalType === 2) {
      const { left, top, width, height } = prev.dims;
      for (let y = Math.max(0, top); y < Math.min(H, top + height); y++) {
        full.fill(0, (y * W + Math.max(0, left)) * 4, (y * W + Math.min(W, left + width)) * 4);
      }
    }
    if (prev?.disposalType === 3 && restore) full.set(restore);
    restore = f.disposalType === 3 ? full.slice() : null;
    const { left, top, width, height } = f.dims;
    const p = f.patch;
    for (let y = 0; y < height; y++) {
      const fy = top + y;
      if (fy < 0 || fy >= H) continue;
      for (let x = 0; x < width; x++) {
        const fx = left + x;
        if (fx < 0 || fx >= W) continue;
        const si = (y * width + x) * 4;
        if (p[si + 3] === 0) continue; // pixel transparente mantém o quadro anterior
        const di = (fy * W + fx) * 4;
        full[di] = p[si];
        full[di + 1] = p[si + 1];
        full[di + 2] = p[si + 2];
        full[di + 3] = 255;
      }
    }
    const px = s < 1 ? downscale(full, W, H, dw, dh) : full.slice();
    out.push(await createImageBitmap(new ImageData(px, dw, dh)));
    // como os navegadores: atraso <= 10 ms vira 100 ms
    t += (f.delay <= 10 ? 100 : f.delay) / 1000;
    ends.push(t);
    prev = f;
  }
  a.gif = { frames: out, ends };
  a.width = W;
  a.height = H;
  a.duration = out.length > 1 ? t : 0;
}

function loadImage(a: RuntimeAsset) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      a.image = img;
      a.width = img.naturalWidth || 480;
      a.height = img.naturalHeight || 480;
      resolve();
    };
    img.onerror = () => reject(new Error("não foi possível abrir a imagem"));
    img.src = a.url;
  });
}

// O <video> do WebKitGTK não entrega quadros ao canvas neste sistema (saem pretos), então o
// vídeo é decodificado pelo ffmpeg e tratado como uma sequência de quadros, igual a um GIF.
async function extractVideo(a: RuntimeAsset, opts?: LoadOpts) {
  const id = a.meta.id;
  a.progress = { done: 0, total: 0 };
  let last = 0;
  const unlisten = await listen<{ id: string; done: number; total: number }>("video-progress", ({ payload }) => {
    if (payload.id !== id) return;
    a.progress = { done: payload.done, total: payload.total };
    opts?.onProgress?.(payload.done, payload.total);
    // o painel mostra a porcentagem; não precisa redesenhar a cada evento
    if (performance.now() - last > 500) {
      last = performance.now();
      changed();
    }
  }).catch(() => undefined);
  const cancel = () => void api.cancelVideo(id).catch(() => {});
  opts?.signal?.addEventListener("abort", cancel);
  let raw: Uint8Array;
  try {
    raw = await api.extractVideo(id, a.bytes, extOf(a.meta.name), VIDEO_FPS, VIDEO_MAX_S);
  } catch (e) {
    throw new Error(String(e));
  } finally {
    unlisten?.();
    opts?.signal?.removeEventListener("abort", cancel);
    a.progress = undefined;
  }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = dv.getUint32(0, true);
  const frames: Uint8Array[] = [];
  let p = 4;
  for (let i = 0; i < n && p + 4 <= raw.length; i++) {
    const len = dv.getUint32(p, true);
    frames.push(raw.subarray(p + 4, p + 4 + len));
    p += 4 + len;
  }
  if (!frames.length) throw new Error("o vídeo não tem quadros");
  a.seq = { frames, fps: VIDEO_FPS, cache: new Map(), pending: new Map() };
  const first = await decodeFrame(a, 0);
  if (!first) throw new Error("não foi possível decodificar o vídeo");
  a.width = first.width;
  a.height = first.height;
  a.duration = frames.length > 1 ? frames.length / VIDEO_FPS : 0;
}

function decodeFrame(a: RuntimeAsset, i: number): Promise<ImageBitmap | null> {
  const q = a.seq!;
  const hit = q.cache.get(i);
  if (hit) return Promise.resolve(hit);
  let p = q.pending.get(i);
  if (!p) {
    p = createImageBitmap(new Blob([q.frames[i] as BlobPart], { type: "image/jpeg" })).then(
      (bm) => {
        q.pending.delete(i);
        q.cache.set(i, bm);
        // cache pequeno: descarta os mais antigos
        for (const k of q.cache.keys()) {
          if (q.cache.size <= VIDEO_CACHE) break;
          q.cache.get(k)!.close();
          q.cache.delete(k);
        }
        return bm;
      },
      () => {
        q.pending.delete(i);
        return null;
      },
    );
    q.pending.set(i, p);
  }
  return p;
}

const frameIndex = (q: VideoFrames, time: number) => Math.min(q.frames.length - 1, Math.max(0, Math.floor(time * q.fps)));

/** Quadro do vídeo em `time` para a prévia (síncrono): se ainda não foi decodificado, pede e
 *  devolve o mais próximo já pronto; quando ficar pronto, a prévia é redesenhada. */
export function videoFrameAt(a: RuntimeAsset, time: number): ImageBitmap | null {
  const q = a.seq;
  if (!q) return null;
  const i = frameIndex(q, time);
  const hit = q.cache.get(i);
  if (hit) return hit;
  decodeFrame(a, i).then((bm) => bm && changed());
  // adianta os próximos para a reprodução não engasgar
  for (let k = 1; k <= 3 && i + k < q.frames.length; k++) decodeFrame(a, i + k);
  for (let k = 1; k <= 30; k++) {
    const near = q.cache.get(i - k) ?? q.cache.get(i + k);
    if (near) return near;
  }
  return null;
}

/** Garante que o quadro de `time` está decodificado (usado na renderização do tema). */
export async function ensureVideoFrame(a: RuntimeAsset, time: number): Promise<void> {
  if (a.seq) await decodeFrame(a, frameIndex(a.seq, time));
}

export function registerAsset(meta: AssetMeta, bytes: Uint8Array, opts?: LoadOpts): RuntimeAsset {
  const old = assets.get(meta.id);
  if (old) return old;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: meta.mime }));
  const a: RuntimeAsset = { meta, bytes, url, width: 480, height: 480, duration: 0, ready: Promise.resolve() };
  const load = meta.type === "gif" ? decodeGif(a) : meta.type === "video" ? extractVideo(a, opts) : loadImage(a);
  a.ready = load.then(changed, (e: Error) => {
    a.error = e.message;
    changed();
  });
  assets.set(meta.id, a);
  return a;
}

/** Trecho tocado [início, fim] em segundos da mídia. */
export function span(a: RuntimeAsset, p: Playback): [number, number] {
  const end = p.trimEnd > 0 ? Math.min(p.trimEnd, a.duration) : a.duration;
  const start = Math.min(Math.max(0, p.trimStart), Math.max(0, end - 0.05));
  return [start, end];
}

/** Duração de um ciclo do loop, em segundos do tema (já considerando a velocidade). */
export function loopDuration(a: RuntimeAsset | undefined, p: Playback): number {
  if (!a || a.duration <= 0) return 0;
  const [s, e] = span(a, p);
  return (e - s) / Math.max(0.05, p.speed);
}

/** Tempo da mídia correspondente ao instante `t` do tema. */
export function mediaTime(a: RuntimeAsset, p: Playback, t: number): number {
  const [s, e] = span(a, p);
  const len = e - s;
  if (len <= 0) return s;
  const local = (t * p.speed) % len;
  return s + (local < 0 ? local + len : local);
}

export function gifFrameAt(a: RuntimeAsset, time: number): ImageBitmap | null {
  const g = a.gif;
  if (!g || g.frames.length === 0) return null;
  let lo = 0;
  let hi = g.ends.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.ends[mid] > time) hi = mid;
    else lo = mid + 1;
  }
  return g.frames[lo];
}
