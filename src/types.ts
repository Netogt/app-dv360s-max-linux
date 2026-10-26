export const SIZE = 480;

export type Fit = "cover" | "contain" | "fill";
export type Align = "left" | "center" | "right";
export type Transform = "none" | "upper" | "lower" | "capitalize";

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  align: Align;
  letterSpacing: number;
  lineHeight: number;
  transform: Transform;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
}

export interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** graus, sentido horário, em torno do centro */
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

/** Como uma mídia animada é tocada (GIF ou vídeo). */
export interface Playback {
  speed: number;
  trimStart: number;
  /** 0 = até o fim */
  trimEnd: number;
}

/** Enquadramento da mídia dentro da caixa: aproximar/afastar e qual parte fica visível.
 *  Campos opcionais: projetos antigos não têm (= 1, centro). */
export interface Framing {
  /** 1 = o tamanho dado pelo ajuste (preencher/caber/esticar) */
  zoom?: number;
  /** 0 = encosta na esquerda/topo, 0.5 = centro, 1 = direita/base */
  focusX?: number;
  focusY?: number;
}

export type Fill =
  | { type: "solid"; color: string }
  | { type: "linear"; from: string; to: string; angle: number }
  | { type: "radial"; from: string; to: string };

export interface BackgroundLayer extends LayerBase, Playback, Framing {
  kind: "background";
  fill: Fill;
  asset: string | null;
  fit: Fit;
}

export interface MediaLayer extends LayerBase, Playback, Framing {
  kind: "media";
  asset: string;
  fit: Fit;
  radius: number;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  style: TextStyle;
}

/** Hora ou data: um template com tokens ({HH}, {mm}, {dddd}...), renderizado ao vivo pelo player. */
export interface ClockLayer extends LayerBase {
  kind: "clock";
  template: string;
  locale: string;
  style: TextStyle;
}

export type ShapeKind = "rect" | "ellipse" | "ring";

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: ShapeKind;
  fill: string;
  fillEnabled: boolean;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface Stroke {
  color: string;
  width: number;
  erase: boolean;
  /** x0, y0, x1, y1... no espaço viewW x viewH */
  points: number[];
}

export interface DrawingLayer extends LayerBase {
  kind: "drawing";
  strokes: Stroke[];
  viewW: number;
  viewH: number;
}

export type Layer = BackgroundLayer | MediaLayer | TextLayer | ClockLayer | ShapeLayer | DrawingLayer;
export type LayerKind = Layer["kind"];

export type AssetType = "image" | "gif" | "video";

export interface AssetMeta {
  id: string;
  name: string;
  mime: string;
  type: AssetType;
  file: string;
}

/** Valores lidos do sistema, usados em templates ({cpuTemp}) e em condições. */
export type SensorName = "cpuTemp" | "gpuHot" | "gpuTemp" | "cpuUse" | "gpuUse" | "ramUse";

/** Condição para uma tela aparecer (mesmo formato do `Rule` do player). */
export type Rule =
  | { id: string; type: "time"; from: string; to: string }
  | { id: string; type: "weekday"; days: number[] }
  /** "MM-DD" */
  | { id: string; type: "date"; from: string; to: string }
  | { id: string; type: "sensor"; sensor: SensorName; op: ">=" | "<="; value: number };

export type RuleType = Rule["type"];

export interface Screen {
  id: string;
  name: string;
  /** de baixo para cima; [0] é sempre o fundo */
  layers: Layer[];
  rules: Rule[];
  /** true: basta uma condição valer; false: todas */
  any: boolean;
}

export interface Project {
  version: 2;
  name: string;
  fps: number;
  quality: number;
  /** segundos: limite do loop renderizado quando há GIF/vídeo */
  maxDuration: number;
  /** segundos mínimos em cada tela antes de trocar de novo */
  hold: number;
  /** folga (°C ou %) para uma tela de sensor já ativa sair; 0 = sai assim que deixa de valer */
  hysteresis?: number;
  /** [0] é a tela principal: aparece quando nenhuma outra vale. As outras, por prioridade. */
  screens: Screen[];
  assets: Record<string, AssetMeta>;
}

export type Tool = "select" | "brush" | "eraser";

/** Campos comuns a todas as camadas (serve para qualquer tipo). */
export type BasePatch = Partial<Omit<LayerBase, "id">>;
