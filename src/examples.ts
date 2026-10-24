// Temas de exemplo para começar (só camadas geradas: nenhum precisa de arquivo de mídia).

import { background, clockLayer, newProject, newRule, screen, sensorLayer, shapeLayer, textLayer, textStyle } from "./defaults";
import type { BackgroundLayer, ClockLayer, Fill, Layer, Project, Rule, ShapeLayer, TextLayer } from "./types";

export interface Example {
  id: string;
  name: string;
  description: string;
  make: () => Project;
}

const bg = (fill: Fill): BackgroundLayer => ({ ...background(), fill });

const clock = (kind: "time" | "date", patch: Partial<ClockLayer>, style: Partial<ClockLayer["style"]> = {}): ClockLayer => {
  const l = clockLayer(kind);
  return { ...l, ...patch, style: { ...l.style, ...style } };
};

const sensor = (template: string, name: string, patch: Partial<ClockLayer>, style: Partial<ClockLayer["style"]>): ClockLayer => {
  const l = sensorLayer("cpu");
  return { ...l, name, template, ...patch, style: { ...l.style, ...style } };
};

const ring = (x: number, y: number, size: number, stroke: string, width: number, opacity = 1): ShapeLayer => ({
  ...shapeLayer("ring"),
  x,
  y,
  w: size,
  h: size,
  stroke,
  strokeWidth: width,
  opacity,
});

const label = (text: string, x: number, y: number, w: number, h: number, style: Partial<TextLayer["style"]>): TextLayer => ({
  ...textLayer(),
  name: text,
  text,
  x,
  y,
  w,
  h,
  style: textStyle(style),
});

function project(name: string, layers: Layer[], extra: { name: string; layers: Layer[]; rules: Rule[] }[] = []): Project {
  const p = newProject();
  p.name = name;
  p.screens = [screen("Principal", layers), ...extra.map((s) => screen(s.name, s.layers, s.rules))];
  return p;
}

const sensorRule = (sensor: "gpuHot" | "cpuTemp", value: number): Rule => ({
  ...(newRule("sensor") as Extract<Rule, { type: "sensor" }>),
  sensor,
  value,
});

export const EXAMPLES: Example[] = [
  {
    id: "big-clock",
    name: "Relógio grande",
    description: "Hora em destaque, data e um anel em volta",
    make: () =>
      project("Relógio grande", [
        bg({ type: "radial", from: "#1e2a4a", to: "#07090f" }),
        ring(20, 20, 440, "#5b8cff", 8, 0.9),
        clock("time", { x: 30, y: 150, w: 420, h: 150 }, { fontSize: 136, fontWeight: 700 }),
        clock("date", { x: 60, y: 300, w: 360, h: 44 }, { fontSize: 26, color: "#9fb4dc" }),
      ]),
  },
  {
    id: "temps",
    name: "Monitor de temperatura",
    description: "CPU e hotspot da GPU, com a hora no topo",
    make: () =>
      project("Monitor de temperatura", [
        bg({ type: "linear", from: "#0b1220", to: "#111827", angle: 160 }),
        clock("time", { x: 140, y: 52, w: 200, h: 56 }, { fontSize: 40, fontWeight: 600, color: "#cbd5e1" }),
        ring(40, 150, 190, "#38bdf8", 10),
        ring(250, 150, 190, "#f87171", 10),
        sensor("{cpuTemp}°", "CPU", { x: 50, y: 205, w: 170, h: 80 }, { fontSize: 60, fontWeight: 700, color: "#e0f2fe" }),
        sensor("{gpuHot}°", "GPU hotspot", { x: 260, y: 205, w: 170, h: 80 }, { fontSize: 60, fontWeight: 700, color: "#fee2e2" }),
        label("CPU", 50, 350, 170, 40, { fontSize: 24, fontWeight: 600, color: "#7dd3fc", letterSpacing: 4 }),
        label("GPU", 260, 350, 170, 40, { fontSize: 24, fontWeight: 600, color: "#fca5a5", letterSpacing: 4 }),
        sensor("uso {cpuUse}% · {gpuUse}%", "Uso", { x: 90, y: 400, w: 300, h: 36 }, { fontSize: 20, fontWeight: 500, color: "#94a3b8" }),
      ]),
  },
  {
    id: "minimal",
    name: "Minimalista",
    description: "Fundo preto, hora fina e data em caixa alta",
    make: () =>
      project("Minimalista", [
        bg({ type: "solid", color: "#000000" }),
        clock("time", { x: 30, y: 160, w: 420, h: 130 }, { fontSize: 120, fontWeight: 300 }),
        clock(
          "date",
          { x: 40, y: 292, w: 400, h: 40, template: "{ddd} · {D} {MMM}" },
          { fontSize: 20, fontWeight: 500, color: "#8b93a1", transform: "upper", letterSpacing: 6 },
        ),
      ]),
  },
  {
    id: "gpu-alert",
    name: "Alerta de GPU quente",
    description: "Relógio normal; vira um alerta vermelho com hotspot ≥ 85 °C",
    make: () =>
      project(
        "Alerta de GPU quente",
        [
          bg({ type: "linear", from: "#141e30", to: "#243b55", angle: 135 }),
          clock("time", {}),
          clock("date", {}),
          sensor("GPU {gpuHot}°C", "Hotspot da GPU", { x: 90, y: 360, w: 300, h: 44 }, { fontSize: 26, color: "#93c5fd" }),
        ],
        [
          {
            name: "GPU quente",
            rules: [sensorRule("gpuHot", 85)],
            layers: [
              bg({ type: "radial", from: "#7f1d1d", to: "#1a0505" }),
              ring(30, 30, 420, "#f87171", 12),
              label("GPU QUENTE", 60, 120, 360, 50, { fontSize: 30, fontWeight: 700, color: "#fecaca", letterSpacing: 6 }),
              sensor("{gpuHot}°", "Hotspot", { x: 60, y: 170, w: 360, h: 150 }, { fontSize: 130, fontWeight: 800, color: "#ffffff" }),
              clock("time", { x: 140, y: 330, w: 200, h: 50 }, { fontSize: 34, fontWeight: 600, color: "#fca5a5" }),
            ],
          },
        ],
      ),
  },
  {
    id: "day-night",
    name: "Dia e noite",
    description: "Claro durante o dia; escuro e discreto das 22:00 às 07:00",
    make: () =>
      project(
        "Dia e noite",
        [
          bg({ type: "linear", from: "#38bdf8", to: "#6366f1", angle: 150 }),
          clock("time", {}, { shadowColor: "#1e1b4b", shadowBlur: 18, shadowY: 4 }),
          clock("date", {}, { color: "#eef2ff" }),
        ],
        [
          {
            name: "Noite",
            rules: [newRule("time")],
            layers: [
              bg({ type: "solid", color: "#05060a" }),
              clock("time", {}, { fontWeight: 300, color: "#64748b" }),
              clock("date", {}, { color: "#334155" }),
            ],
          },
        ],
      ),
  },
];
