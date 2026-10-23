import type {
  BackgroundLayer,
  ClockLayer,
  DrawingLayer,
  Layer,
  MediaLayer,
  Project,
  Rule,
  Screen,
  ShapeKind,
  ShapeLayer,
  TextLayer,
  TextStyle,
} from "./types";
import { SIZE } from "./types";
import { uid } from "./util";

export const DEFAULT_FONT = "Adwaita Sans";
export const FONT_FALLBACK = `"Adwaita Sans", "Noto Sans", "DejaVu Sans", sans-serif`;

export function textStyle(patch: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: DEFAULT_FONT,
    fontSize: 48,
    fontWeight: 600,
    italic: false,
    color: "#ffffff",
    align: "center",
    letterSpacing: 0,
    lineHeight: 1.2,
    transform: "none",
    strokeColor: "#000000",
    strokeWidth: 0,
    shadowColor: "#000000",
    shadowBlur: 0,
    shadowX: 0,
    shadowY: 0,
    ...patch,
  };
}

const base = (name: string, x: number, y: number, w: number, h: number) => ({
  id: uid(),
  name,
  x,
  y,
  w,
  h,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
});

export function background(): BackgroundLayer {
  return {
    ...base("Fundo", 0, 0, SIZE, SIZE),
    kind: "background",
    fill: { type: "linear", from: "#141e30", to: "#243b55", angle: 135 },
    asset: null,
    fit: "cover",
    speed: 1,
    trimStart: 0,
    trimEnd: 0,
  };
}

export function textLayer(): TextLayer {
  return { ...base("Texto", 90, 200, 300, 80), kind: "text", text: "Seu texto", style: textStyle() };
}

export interface ClockPreset {
  label: string;
  template: string;
  kind: "time" | "date" | "sensor";
}

export const CLOCK_PRESETS: ClockPreset[] = [
  { label: "14:05", template: "{HH}:{mm}", kind: "time" },
  { label: "14:05:09", template: "{HH}:{mm}:{ss}", kind: "time" },
  { label: "2:05 PM", template: "{h}:{mm} {A}", kind: "time" },
  { label: "08/03/2026", template: "{DD}/{MM}/{YYYY}", kind: "date" },
  { label: "domingo, 8 de março", template: "{dddd}, {D} de {MMMM}", kind: "date" },
  { label: "8 mar", template: "{D} {MMM}", kind: "date" },
  { label: "domingo", template: "{dddd}", kind: "date" },
  { label: "2026", template: "{YYYY}", kind: "date" },
  { label: "CPU 58°C", template: "CPU {cpuTemp}°C", kind: "sensor" },
  { label: "58°", template: "{cpuTemp}°", kind: "sensor" },
  { label: "GPU 62°C (hotspot)", template: "GPU {gpuHot}°C", kind: "sensor" },
  { label: "62° (hotspot)", template: "{gpuHot}°", kind: "sensor" },
  { label: "GPU 55°C", template: "GPU {gpuTemp}°C", kind: "sensor" },
  { label: "CPU 58° · GPU 62°", template: "CPU {cpuTemp}° · GPU {gpuHot}°", kind: "sensor" },
];

export function sensorLayer(which: "cpu" | "gpuHot"): ClockLayer {
  const cpu = which === "cpu";
  return {
    ...base(cpu ? "Temperatura da CPU" : "Hotspot da GPU", 90, cpu ? 340 : 390, 300, 50),
    kind: "clock",
    template: cpu ? "CPU {cpuTemp}°C" : "GPU {gpuHot}°C",
    locale: "pt-BR",
    style: textStyle({ fontSize: 34, fontWeight: 600, color: cpu ? "#7dd3fc" : "#fca5a5" }),
  };
}

export function clockLayer(kind: "time" | "date"): ClockLayer {
  return kind === "time"
    ? {
        ...base("Hora", 40, 150, 400, 130),
        kind: "clock",
        template: "{HH}:{mm}",
        locale: "pt-BR",
        style: textStyle({ fontSize: 112, fontWeight: 700 }),
      }
    : {
        ...base("Data", 40, 280, 400, 50),
        kind: "clock",
        template: "{dddd}, {D} de {MMMM}",
        locale: "pt-BR",
        style: textStyle({ fontSize: 28, fontWeight: 500, color: "#c9d6ea", transform: "capitalize" }),
      };
}

export function mediaLayer(asset: string, name: string, w: number, h: number): MediaLayer {
  // cabe na tela mantendo a proporção
  const s = Math.min(1, SIZE / w, SIZE / h);
  const ww = Math.round(w * s);
  const hh = Math.round(h * s);
  return {
    ...base(name, Math.round((SIZE - ww) / 2), Math.round((SIZE - hh) / 2), ww, hh),
    kind: "media",
    asset,
    fit: "cover",
    radius: 0,
    speed: 1,
    trimStart: 0,
    trimEnd: 0,
  };
}

export function shapeLayer(shape: ShapeKind): ShapeLayer {
  const names: Record<ShapeKind, string> = { rect: "Retângulo", ellipse: "Elipse", ring: "Anel" };
  const ring = shape === "ring";
  return {
    ...base(names[shape], ring ? 20 : 140, ring ? 20 : 140, ring ? 440 : 200, ring ? 440 : 200),
    kind: "shape",
    shape,
    fill: "#3b82f6",
    fillEnabled: !ring,
    stroke: ring ? "#38bdf8" : "#ffffff",
    strokeWidth: ring ? 10 : 0,
    radius: shape === "rect" ? 24 : 0,
  };
}

export function drawingLayer(): DrawingLayer {
  return { ...base("Desenho", 0, 0, SIZE, SIZE), kind: "drawing", strokes: [], viewW: SIZE, viewH: SIZE };
}

export function screen(name: string, layers: Layer[], rules: Rule[] = []): Screen {
  return { id: uid(), name, layers, rules, any: false };
}

/** Cópia das camadas com ids novos (as mídias continuam compartilhadas). */
export function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((l) => ({ ...structuredClone(l), id: uid() }));
}

export function newRule(type: Rule["type"]): Rule {
  const id = uid();
  switch (type) {
    case "time":
      return { id, type, from: "22:00", to: "07:00" };
    case "weekday":
      return { id, type, days: [0, 6] };
    case "date":
      return { id, type, from: "12-15", to: "01-06" };
    case "sensor":
      return { id, type, sensor: "gpuHot", op: ">=", value: 85 };
  }
}

export interface ScreenPreset {
  label: string;
  hint: string;
  name: string;
  rules: () => Rule[];
}

export const SCREEN_PRESETS: ScreenPreset[] = [
  { label: "Por horário", hint: "ex.: 22:00 às 07:00", name: "Noite", rules: () => [newRule("time")] },
  {
    label: "GPU quente",
    hint: "hotspot ≥ 85 °C",
    name: "GPU quente",
    rules: () => [{ ...(newRule("sensor") as Extract<Rule, { type: "sensor" }>), sensor: "gpuHot", value: 85 }],
  },
  {
    label: "CPU quente",
    hint: "CPU ≥ 80 °C",
    name: "CPU quente",
    rules: () => [{ ...(newRule("sensor") as Extract<Rule, { type: "sensor" }>), sensor: "cpuTemp", value: 80 }],
  },
  {
    label: "Jogando",
    hint: "uso da GPU ≥ 60%",
    name: "Jogando",
    rules: () => [{ ...(newRule("sensor") as Extract<Rule, { type: "sensor" }>), sensor: "gpuUse", value: 60 }],
  },
  { label: "Fim de semana", hint: "sábado e domingo", name: "Fim de semana", rules: () => [newRule("weekday")] },
  { label: "Época do ano", hint: "ex.: 15/dez a 06/jan", name: "Festas", rules: () => [newRule("date")] },
];

export function newProject(): Project {
  return {
    version: 2,
    name: "Meu tema",
    fps: 20,
    quality: 85,
    maxDuration: 30,
    hold: 5,
    screens: [screen("Principal", [background(), clockLayer("time"), clockLayer("date")])],
    assets: {},
  };
}

/** Projeto salvo por uma versão anterior (v1: uma lista de camadas só). */
export function migrateProject(raw: unknown): Project {
  const p = raw as Partial<Project> & { version?: number; layers?: Layer[] };
  if ((p.version as number) === 1 && Array.isArray(p.layers)) {
    const { layers, ...rest } = p;
    return { ...(rest as Project), version: 2, hold: 5, screens: [screen("Principal", layers)] };
  }
  return p as Project;
}
