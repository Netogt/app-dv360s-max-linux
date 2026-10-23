// Texto no canvas. A prévia de hora/data é desenhada unidade por unidade (cada dígito, cada
// nome de dia/mês, cada trecho literal), exatamente como o player monta a linha a partir do
// atlas: assim o que se vê no editor é o que aparece na tela.

import { FONT_FALLBACK } from "../defaults";
import type { TextStyle, Transform } from "../types";

export const SENSOR_TOKENS = ["cpuTemp", "gpuHot", "gpuTemp", "cpuUse", "gpuUse", "ramUse"] as const;
export const TOKENS = [
  "YYYY", "MMMM", "dddd", "MMM", "ddd", "HH", "hh", "mm", "ss", "DD", "MM", "YY", "H", "h", "D", "M", "A",
  ...SENSOR_TOKENS,
] as const;

export type Readings = Record<SensorToken, number | null>;
export const NO_READINGS: Readings = { cpuTemp: null, gpuHot: null, gpuTemp: null, cpuUse: null, gpuUse: null, ramUse: null };
export type Token = (typeof TOKENS)[number];

export const TOKEN_HELP: { tok: Token; desc: string }[] = [
  { tok: "HH", desc: "hora 00–23" },
  { tok: "H", desc: "hora 0–23" },
  { tok: "hh", desc: "hora 01–12" },
  { tok: "h", desc: "hora 1–12" },
  { tok: "mm", desc: "minutos" },
  { tok: "ss", desc: "segundos" },
  { tok: "A", desc: "AM/PM" },
  { tok: "DD", desc: "dia 01–31" },
  { tok: "D", desc: "dia 1–31" },
  { tok: "dddd", desc: "dia da semana" },
  { tok: "ddd", desc: "dia abreviado" },
  { tok: "MM", desc: "mês 01–12" },
  { tok: "M", desc: "mês 1–12" },
  { tok: "MMMM", desc: "nome do mês" },
  { tok: "MMM", desc: "mês abreviado" },
  { tok: "YYYY", desc: "ano" },
  { tok: "YY", desc: "ano (2 dígitos)" },
  { tok: "cpuTemp", desc: "temperatura da CPU (°C)" },
  { tok: "gpuHot", desc: "hotspot da GPU (°C)" },
  { tok: "gpuTemp", desc: "temperatura da GPU (°C)" },
  { tok: "cpuUse", desc: "uso da CPU (%)" },
  { tok: "gpuUse", desc: "uso da GPU (%)" },
  { tok: "ramUse", desc: "uso da RAM (%)" },
];

export type TemplatePiece = { tok: Token } | { lit: string };

export function parseTemplate(tpl: string): TemplatePiece[] {
  const out: TemplatePiece[] = [];
  const re = /\{([A-Za-z]+)\}/g;
  let last = 0;
  for (let m = re.exec(tpl); m; m = re.exec(tpl)) {
    const tok = m[1] as Token;
    if (!TOKENS.includes(tok)) continue;
    if (m.index > last) out.push({ lit: tpl.slice(last, m.index) });
    out.push({ tok });
    last = m.index + m[0].length;
  }
  if (last < tpl.length) out.push({ lit: tpl.slice(last) });
  return out;
}

export const usesSensors = (tpl: string) => SENSOR_TOKENS.some((t) => tpl.includes(`{${t}}`));
/** Muda a cada segundo (segundos ou temperatura)? */
export const updatesEverySecond = (tpl: string) => tpl.includes("{ss}") || usesSensors(tpl);

export function applyTransform(s: string, t: Transform, locale: string): string {
  switch (t) {
    case "upper":
      return s.toLocaleUpperCase(locale);
    case "lower":
      return s.toLocaleLowerCase(locale);
    case "capitalize":
      // só a primeira letra ("Quinta-feira, 22 de outubro")
      return s.replace(/^(\P{L}*)(\p{L})/u, (_, pre: string, c: string) => pre + c.toLocaleUpperCase(locale));
    default:
      return s;
  }
}

const nameCache = new Map<string, string[]>();

/** Nomes de dias (0 = domingo) e meses no idioma escolhido. */
export function names(locale: string, kind: "wd" | "ws" | "mo" | "ms"): string[] {
  const key = `${locale}:${kind}`;
  const hit = nameCache.get(key);
  if (hit) return hit;
  let list: string[];
  try {
    if (kind === "wd" || kind === "ws") {
      const f = new Intl.DateTimeFormat(locale, { weekday: kind === "wd" ? "long" : "short" });
      // 7/jan/2024 foi um domingo
      list = Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 7 + i, 12)));
    } else {
      const f = new Intl.DateTimeFormat(locale, { month: kind === "mo" ? "long" : "short" });
      list = Array.from({ length: 12 }, (_, i) => f.format(new Date(2024, i, 15, 12)));
    }
  } catch {
    list = names("pt-BR", kind);
  }
  nameCache.set(key, list);
  return list;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export type SensorToken = (typeof SENSOR_TOKENS)[number];

/** Chave de sprite de cada unidade para o instante `d` (mesma lógica do `resolve` do player). */
export function resolveKeys(pieces: TemplatePiece[], d: Date, sens: Readings = NO_READINGS): string[] {
  const out: string[] = [];
  const digits = (s: string) => {
    for (const c of s) out.push(`d${c}`);
  };
  const h12 = d.getHours() % 12 || 12;
  pieces.forEach((p, i) => {
    if ("lit" in p) {
      out.push(`l${i}`);
      return;
    }
    switch (p.tok) {
      case "HH": return digits(pad2(d.getHours()));
      case "H": return digits(String(d.getHours()));
      case "hh": return digits(pad2(h12));
      case "h": return digits(String(h12));
      case "mm": return digits(pad2(d.getMinutes()));
      case "ss": return digits(pad2(d.getSeconds()));
      case "DD": return digits(pad2(d.getDate()));
      case "D": return digits(String(d.getDate()));
      case "MM": return digits(pad2(d.getMonth() + 1));
      case "M": return digits(String(d.getMonth() + 1));
      case "YYYY": return digits(String(d.getFullYear()));
      case "YY": return digits(pad2(d.getFullYear() % 100));
      case "dddd": return void out.push(`wd${d.getDay()}`);
      case "ddd": return void out.push(`ws${d.getDay()}`);
      case "MMMM": return void out.push(`mo${d.getMonth()}`);
      case "MMM": return void out.push(`ms${d.getMonth()}`);
      case "A": return void out.push(d.getHours() < 12 ? "am" : "pm");
      case "cpuTemp":
      case "gpuHot":
      case "gpuTemp":
      case "cpuUse":
      case "gpuUse":
      case "ramUse": {
        const v = sens[p.tok];
        // sensor indisponível: "--"
        if (v == null) return void out.push("dash", "dash");
        return digits(String(Math.round(Math.min(999, Math.max(0, v)))));
      }
    }
  });
  return out;
}

/** Texto de cada chave de sprite usada pelo template. */
export function spriteTexts(pieces: TemplatePiece[], locale: string, t: Transform): Map<string, string> {
  const m = new Map<string, string>();
  pieces.forEach((p, i) => {
    // "Primeira maiúscula" vale para o início do template, não para cada trecho
    const tt = t === "capitalize" && i > 0 ? "none" : t;
    const tr = (s: string) => applyTransform(s, tt, locale);
    if ("lit" in p) {
      m.set(`l${i}`, tr(p.lit));
      return;
    }
    switch (p.tok) {
      case "dddd":
      case "ddd":
      case "MMMM":
      case "MMM": {
        const kind = ({ dddd: "wd", ddd: "ws", MMMM: "mo", MMM: "ms" } as const)[p.tok];
        names(locale, kind).forEach((n, j) => m.set(`${kind}${j}`, tr(n)));
        break;
      }
      case "A":
        m.set("am", tr("AM"));
        m.set("pm", tr("PM"));
        break;
      case "cpuTemp":
      case "gpuHot":
      case "gpuTemp":
      case "cpuUse":
      case "gpuUse":
      case "ramUse":
        m.set("dash", "-");
        for (let k = 0; k < 10; k++) m.set(`d${k}`, String(k));
        break;
      default:
        for (let k = 0; k < 10; k++) m.set(`d${k}`, String(k));
    }
  });
  return m;
}

// ---------- desenho ----------

export function fontString(s: TextStyle): string {
  return `${s.italic ? "italic " : ""}${s.fontWeight} ${s.fontSize}px "${s.fontFamily}", ${FONT_FALLBACK}`;
}

/** Espaço extra ao redor do texto para contorno e sombra não serem cortados. */
export function textPad(s: TextStyle): number {
  return Math.ceil(s.strokeWidth + s.shadowBlur * 1.5 + Math.max(Math.abs(s.shadowX), Math.abs(s.shadowY))) + 2;
}

export function setupText(ctx: CanvasRenderingContext2D, s: TextStyle) {
  ctx.font = fontString(s);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
}

export function measureRun(ctx: CanvasRenderingContext2D, text: string, s: TextStyle): number {
  if (!s.letterSpacing) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + s.letterSpacing;
  return w;
}

function shadowOn(ctx: CanvasRenderingContext2D, s: TextStyle, on: boolean) {
  const has = on && (s.shadowBlur > 0 || s.shadowX !== 0 || s.shadowY !== 0);
  ctx.shadowColor = has ? s.shadowColor : "transparent";
  ctx.shadowBlur = has ? s.shadowBlur : 0;
  ctx.shadowOffsetX = has ? s.shadowX : 0;
  ctx.shadowOffsetY = has ? s.shadowY : 0;
}

/** Desenha um trecho com origem à esquerda e linha de base no meio (y). */
export function paintRun(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: TextStyle) {
  const chunks: [string, number][] = [];
  if (!s.letterSpacing) chunks.push([text, x]);
  else {
    let cx = x;
    for (const ch of text) {
      chunks.push([ch, cx]);
      cx += ctx.measureText(ch).width + s.letterSpacing;
    }
  }
  shadowOn(ctx, s, true);
  if (s.strokeWidth > 0) {
    ctx.strokeStyle = s.strokeColor;
    ctx.lineWidth = s.strokeWidth * 2;
    for (const [c, cx] of chunks) ctx.strokeText(c, cx, y);
    shadowOn(ctx, s, false);
  }
  ctx.fillStyle = s.color;
  for (const [c, cx] of chunks) ctx.fillText(c, cx, y);
  shadowOn(ctx, s, false);
}

function startX(align: TextStyle["align"], boxW: number, lineW: number) {
  return align === "left" ? -boxW / 2 : align === "right" ? boxW / 2 - lineW : -lineW / 2;
}

/** Texto fixo com várias linhas, centrado verticalmente na caixa (origem no centro). */
export function drawTextBlock(ctx: CanvasRenderingContext2D, text: string, s: TextStyle, w: number, locale = "pt-BR") {
  setupText(ctx, s);
  const lines = applyTransform(text, s.transform, locale).split("\n");
  const lh = s.fontSize * s.lineHeight;
  let y = -((lines.length - 1) * lh) / 2;
  for (const line of lines) {
    paintRun(ctx, line, startX(s.align, w, measureRun(ctx, line, s)), y, s);
    y += lh;
  }
}

/** Prévia de hora/data com as mesmas unidades do atlas (origem no centro da caixa). */
export function drawClockLine(
  ctx: CanvasRenderingContext2D,
  pieces: TemplatePiece[],
  texts: Map<string, string>,
  now: Date,
  sens: Readings,
  s: TextStyle,
  w: number,
) {
  setupText(ctx, s);
  const units = resolveKeys(pieces, now, sens).map((k) => texts.get(k) ?? "");
  const widths = units.map((u) => measureRun(ctx, u, s));
  let x = startX(s.align, w, widths.reduce((a, b) => a + b, 0));
  units.forEach((u, i) => {
    paintRun(ctx, u, x, 0, s);
    x += widths[i];
  });
}
