import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACCEPT_IMAGE, ACCEPT_VIDEO, pickMedia, renderSpeed, setBackgroundMedia } from "../actions";
import { drawScene } from "../render/draw";
import { formatBytes } from "../util";
import { CLOCK_PRESETS, FONT_FALLBACK } from "../defaults";
import { api } from "../io";
import { getAsset, loopDuration, onAssetsChanged, type RuntimeAsset } from "../render/assets";
import { estimateFrames } from "../render/compile";
import { liveReadings, watchSensors } from "../render/sensors";
import { rulesUseSensors } from "../render/rules";
import { TOKEN_HELP, usesSensors } from "../render/text";
import { curLayers, curScreen, store, updateLayer, updateProject, useStore } from "../store";
import { ScreenSettings, SensorSimulator } from "./Screens";
import { ShortcutList } from "./Shortcuts";
import type {
  BackgroundLayer, BasePatch, ClockLayer, DrawingLayer, Fill, Fit, Layer, MediaLayer, Playback, Project, ShapeLayer, TextLayer, TextStyle,
} from "../types";
import { SIZE } from "../types";
import { ColorField, NumberField, Row, Section, Segmented, Select, Slider, Toggle, useDismiss } from "./controls";
import {
  IconAlignCenterH, IconAlignCenterV, IconMonitor, IconBrush, IconCircle, IconCursor, IconEraser, IconMaximize, IconRing, IconSquare,
} from "./icons";
import { layerIcon } from "./LayersPanel";

const FITS: { value: Fit; label: string }[] = [
  { value: "cover", label: "Preencher (cortar)" },
  { value: "contain", label: "Caber inteiro" },
  { value: "fill", label: "Esticar" },
];

const KIND_LABEL: Record<Layer["kind"], string> = {
  background: "Fundo",
  media: "Mídia",
  text: "Texto",
  clock: "Hora, data ou sensor",
  shape: "Forma",
  drawing: "Desenho",
};

export function Inspector() {
  // mídias carregando (vídeo em preparação) mudam o que o painel mostra
  const [, assetsTick] = useState(0);
  useEffect(() => onAssetsChanged(() => assetsTick((n) => n + 1)), []);
  const selectedId = useStore((s) => s.selectedId);
  const screenId = useStore((s) => s.screenId);
  const screenName = useStore((s) => curScreen(s).name);
  const isMain = useStore((s) => s.project.screens[0].id === curScreen(s).id);
  const layer = useStore((s) => curLayers(s).find((l) => l.id === s.selectedId) ?? null);
  return (
    <aside className="panel right">
      {layer ? (
        <>
          <header className="panel-head">
            <span className="panel-title with-icon">
              {layerIcon(layer)} {layer.name}
            </span>
            <span className="badge">{KIND_LABEL[layer.kind]}</span>
          </header>
          <div className="panel-scroll" key={selectedId}>
            <LayerInspector l={layer} />
          </div>
        </>
      ) : (
        <>
          <header className="panel-head">
            <span className="panel-title with-icon">
              <IconMonitor size={15} /> {screenName}
            </span>
            <span className="badge">{isMain ? "Tela principal" : "Tela condicional"}</span>
          </header>
          <div className="panel-scroll" key={screenId}>
            <ScreenSettings />
            <SensorSimulator />
            <ThemeSettings />
          </div>
        </>
      )}
    </aside>
  );
}

function LayerInspector({ l }: { l: Layer }) {
  switch (l.kind) {
    case "background":
      return <BackgroundInspector l={l} />;
    case "media":
      return (
        <>
          <MediaInspector l={l} />
          <TransformSection l={l} />
        </>
      );
    case "text":
      return (
        <>
          <TextInspector l={l} />
          <TransformSection l={l} />
        </>
      );
    case "clock":
      return (
        <>
          <ClockInspector l={l} />
          <TransformSection l={l} />
        </>
      );
    case "shape":
      return (
        <>
          <ShapeInspector l={l} />
          <TransformSection l={l} />
        </>
      );
    case "drawing":
      return (
        <>
          <DrawingInspector l={l} />
          <TransformSection l={l} />
        </>
      );
  }
}

// ---------- tema ----------

/** Tamanho de um quadro JPEG desta tela (renderiza um de amostra, com atraso para não pesar). */
function useFrameBytes(p: Project): number | null {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const c = document.createElement("canvas");
      c.width = SIZE;
      c.height = SIZE;
      drawScene(c.getContext("2d")!, p.screens[0].layers, { t: 0, now: new Date(), mode: "preview" });
      c.toBlob((b) => alive && b && setBytes(b.size), "image/jpeg", p.quality / 100);
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [p]);
  return bytes;
}

const duration = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);

function ThemeSettings() {
  const p = useStore((s) => s.project);
  const frames = useMemo(() => p.screens.reduce((n, sc) => n + estimateFrames(p, sc.layers), 0), [p]);
  const sample = useFrameBytes(p);
  const speed = renderSpeed();
  // quadros acima de 64 KB têm a qualidade reduzida até caber
  const perFrame = sample == null ? null : Math.min(sample, 0xffff);
  return (
    <>
      <Section title="Tema">
        <Row label="Nome">
          <input className="text" value={p.name} onChange={(e) => updateProject({ name: e.currentTarget.value }, "name")} />
        </Row>
        {p.screens.length > 1 && (
          <Row label="Troca mín." hint="Tempo mínimo em cada tela antes de trocar de novo (evita ficar piscando).">
            <Slider value={p.hold} min={0} max={60} onChange={(v) => updateProject({ hold: v }, "hold")} format={(v) => `${v} s`} />
          </Row>
        )}
        {rulesUseSensors(p) && (
          <Row
            label="Folga"
            hint="Para telas por temperatura/uso: quanto o valor precisa cair (ou subir) além do limite para a tela sair. Com 0, uma tela de “≥ 60” sai quando mostrar 59."
          >
            <Slider
              value={p.hysteresis ?? 0}
              min={0}
              max={10}
              onChange={(v) => updateProject({ hysteresis: v }, "hyst")}
              format={(v) => (v ? `${v}` : "nenhuma")}
            />
          </Row>
        )}
      </Section>
      <Section title="Animação">
        <Row label="Quadros/s" hint="Para GIF e vídeo. A tela aceita até ~60; 20–30 já fica fluido.">
          <Slider value={p.fps} min={5} max={30} onChange={(v) => updateProject({ fps: v }, "fps")} format={(v) => `${v} fps`} />
        </Row>
        <Row label="Loop máx." hint="Animações mais longas que isso são cortadas no loop.">
          <Slider value={p.maxDuration} min={2} max={120} onChange={(v) => updateProject({ maxDuration: v }, "maxDur")} format={(v) => `${v} s`} />
        </Row>
        <p className="note">
          {frames > 1
            ? `O tema terá ${frames} quadros (${(frames / p.fps).toFixed(1)} s em loop).`
            : "Tema estático: o player envia um quadro só e o atualiza quando a hora muda."}
        </p>
        {frames > 1 && (
          <dl className="estimate">
            <dt>Tamanho</dt>
            <dd>{perFrame == null ? "calculando…" : `≈ ${formatBytes(perFrame * frames)}`}</dd>
            <dt>Para gerar</dt>
            <dd>{speed ? `≈ ${duration((speed.msPerFrame * frames) / 1000)}` : "medido após o primeiro envio"}</dd>
          </dl>
        )}
      </Section>
      <Section title="Qualidade">
        <Row label="JPEG" hint="Quadros acima de 64 KB têm a qualidade reduzida automaticamente.">
          <Slider value={p.quality} min={50} max={95} onChange={(v) => updateProject({ quality: v }, "quality")} format={(v) => `${v}%`} />
        </Row>
      </Section>
      <Section title="Atalhos" defaultOpen={false}>
        <ShortcutList />
      </Section>
    </>
  );
}

// ---------- posição ----------

function TransformSection({ l }: { l: Layer }) {
  const k = (f: string) => `${l.id}:${f}`;
  const set = (patch: BasePatch, f: string) => updateLayer(l.id, patch, k(f));
  return (
    <Section title="Posição e tamanho">
      <div className="grid2">
        <NumberField label="X" value={l.x} onChange={(v) => set({ x: v }, "x")} />
        <NumberField label="Y" value={l.y} onChange={(v) => set({ y: v }, "y")} />
        <NumberField label="L" title="Largura" value={l.w} min={1} onChange={(v) => set({ w: v }, "w")} />
        <NumberField label="A" title="Altura" value={l.h} min={1} onChange={(v) => set({ h: v }, "h")} />
        <NumberField label="↻" title="Rotação" value={l.rotation} min={-360} max={360} step={1} suffix="°" onChange={(v) => set({ rotation: v }, "rot")} />
      </div>
      <Row label="Opacidade">
        <Slider value={Math.round(l.opacity * 100)} min={0} max={100} onChange={(v) => set({ opacity: v / 100 }, "op")} format={(v) => `${v}%`} />
      </Row>
      <div className="btn-row">
        <button type="button" className="btn small" title="Centralizar na horizontal" onClick={() => set({ x: Math.round((SIZE - l.w) / 2) }, "cx")}>
          <IconAlignCenterH size={14} /> Centro H
        </button>
        <button type="button" className="btn small" title="Centralizar na vertical" onClick={() => set({ y: Math.round((SIZE - l.h) / 2) }, "cy")}>
          <IconAlignCenterV size={14} /> Centro V
        </button>
        <button type="button" className="btn small" title="Ocupar a tela inteira" onClick={() => set({ x: 0, y: 0, w: SIZE, h: SIZE, rotation: 0 }, "fill")}>
          <IconMaximize size={14} /> Tela toda
        </button>
      </div>
    </Section>
  );
}

// ---------- mídia ----------

function AssetInfo({ a }: { a: RuntimeAsset | undefined }) {
  if (!a) return <p className="note warn">Arquivo de mídia ausente.</p>;
  if (a.error) return <p className="note warn">{a.error}</p>;
  if (a.progress) {
    const pct = a.progress.total ? Math.round((a.progress.done / a.progress.total) * 100) : 0;
    return (
      <div className="asset-info">
        <span className="asset-name" title={a.meta.name}>{a.meta.name}</span>
        <span className="muted">Preparando o vídeo… {a.progress.total ? `${pct}%` : ""}</span>
        <div className="progress">
          <div className={`progress-bar ${a.progress.total ? "" : "indeterminate"}`} style={{ width: a.progress.total ? `${pct}%` : undefined }} />
        </div>
      </div>
    );
  }
  const kind = a.meta.type === "gif" ? `GIF · ${a.gif?.frames.length ?? "…"} quadros` : a.meta.type === "video" ? "Vídeo" : "Imagem";
  return (
    <div className="asset-info">
      <span className="asset-name" title={a.meta.name}>{a.meta.name}</span>
      <span className="muted">
        {kind} · {a.width}×{a.height}
        {a.duration > 0 && ` · ${a.duration.toFixed(1)} s`}
      </span>
    </div>
  );
}

function PlaybackSection({ l }: { l: (MediaLayer | BackgroundLayer) & Playback }) {
  const a = getAsset(l.asset);
  if (!a || a.duration <= 0) return null;
  const set = (patch: Partial<Playback>, f: string) => updateLayer(l.id, patch, `${l.id}:${f}`);
  const loop = loopDuration(a, l);
  return (
    <Section title="Reprodução">
      <Row label="Velocidade">
        <Slider value={l.speed} min={0.25} max={4} step={0.25} onChange={(v) => set({ speed: v }, "speed")} format={(v) => `${v}×`} />
      </Row>
      <div className="grid2">
        <NumberField label="Início" value={l.trimStart} min={0} max={a.duration} step={0.1} suffix="s" onChange={(v) => set({ trimStart: v }, "ts")} />
        <NumberField label="Fim" title="0 = até o final" value={l.trimEnd} min={0} max={a.duration} step={0.1} suffix="s" onChange={(v) => set({ trimEnd: v }, "te")} />
      </div>
      <p className="note">
        Loop de {loop.toFixed(1)} s
        {loop > store.get().project.maxDuration && ` — será cortado em ${store.get().project.maxDuration} s (ajuste em Tema › Loop máx.)`}
      </p>
    </Section>
  );
}

function MediaInspector({ l }: { l: MediaLayer }) {
  const a = getAsset(l.asset);
  const set = (patch: Partial<MediaLayer>, f: string) => updateLayer(l.id, patch, `${l.id}:${f}`);
  return (
    <>
      <Section title="Mídia">
        <AssetInfo a={a} />
        <Row label="Ajuste">
          <Select value={l.fit} options={FITS} onChange={(v) => set({ fit: v }, "fit")} />
        </Row>
        <Row label="Cantos">
          <Slider value={l.radius} min={0} max={Math.round(Math.min(l.w, l.h) / 2)} onChange={(v) => set({ radius: v }, "radius")} format={(v) => `${v} px`} />
        </Row>
        {a && (
          <button type="button" className="btn small" onClick={() => set({ w: Math.round((l.h * a.width) / a.height) }, "ratio")}>
            Proporção original
          </button>
        )}
      </Section>
      <PlaybackSection l={l} />
    </>
  );
}

function BackgroundInspector({ l }: { l: BackgroundLayer }) {
  const a = getAsset(l.asset);
  const setFill = (fill: Fill, f = "fill") => updateLayer<BackgroundLayer>(l.id, { fill }, `${l.id}:${f}`);
  const f = l.fill;
  const two = f.type === "solid" ? { from: f.color, to: f.color } : f;
  return (
    <>
      <Section title="Cor de fundo">
        <Segmented
          value={f.type}
          options={[
            { value: "solid", label: "Sólida" },
            { value: "linear", label: "Degradê" },
            { value: "radial", label: "Radial" },
          ]}
          onChange={(t) =>
            setFill(
              t === "solid"
                ? { type: "solid", color: two.from }
                : t === "linear"
                  ? { type: "linear", from: two.from, to: two.to === two.from ? "#000000" : two.to, angle: 135 }
                  : { type: "radial", from: two.from, to: two.to === two.from ? "#000000" : two.to },
              "type",
            )
          }
        />
        {f.type === "solid" ? (
          <Row label="Cor">
            <ColorField value={f.color} onChange={(c) => setFill({ ...f, color: c })} />
          </Row>
        ) : (
          <>
            <Row label="De">
              <ColorField value={f.from} onChange={(c) => setFill({ ...f, from: c })} />
            </Row>
            <Row label="Para">
              <ColorField value={f.to} onChange={(c) => setFill({ ...f, to: c })} />
            </Row>
            {f.type === "linear" && (
              <Row label="Ângulo">
                <Slider value={f.angle} min={0} max={360} step={5} onChange={(v) => setFill({ ...f, angle: v }, "angle")} format={(v) => `${v}°`} />
              </Row>
            )}
          </>
        )}
      </Section>
      <Section title="Imagem, GIF ou vídeo de fundo">
        {l.asset ? (
          <>
            <AssetInfo a={a} />
            <Row label="Ajuste">
              <Select value={l.fit} options={FITS} onChange={(v) => updateLayer<BackgroundLayer>(l.id, { fit: v })} />
            </Row>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={() => pickMedia(`${ACCEPT_IMAGE},${ACCEPT_VIDEO}`, true)}>
                Trocar…
              </button>
              <button type="button" className="btn small ghost" onClick={() => setBackgroundMedia(null)}>
                Remover
              </button>
            </div>
          </>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn small" onClick={() => pickMedia(ACCEPT_IMAGE, true)}>
              Imagem ou GIF…
            </button>
            <button type="button" className="btn small" onClick={() => pickMedia(ACCEPT_VIDEO, true)}>
              Vídeo…
            </button>
          </div>
        )}
        <p className="note">Dica: arraste um arquivo para a tela e solte em “Usar como fundo”.</p>
      </Section>
      {l.asset && <PlaybackSection l={l} />}
      <Section title="Opacidade da mídia" defaultOpen={false}>
        <Slider value={Math.round(l.opacity * 100)} min={0} max={100} onChange={(v) => updateLayer(l.id, { opacity: v / 100 }, `${l.id}:op`)} format={(v) => `${v}%`} />
      </Section>
    </>
  );
}

// ---------- texto ----------

let fontCache: Promise<string[]> | null = null;
const loadFonts = () => (fontCache ??= api.listFonts().catch(() => ["Adwaita Sans", "DejaVu Sans", "Liberation Sans", "Liberation Serif", "DejaVu Sans Mono"]));

function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  useEffect(() => {
    loadFonts().then(setFonts);
  }, []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? fonts.filter((f) => f.toLowerCase().includes(s)) : fonts).slice(0, 150);
  }, [fonts, q]);
  return (
    <div className="popover-anchor font-picker" ref={ref}>
      <button type="button" className="select-btn" onClick={() => setOpen(!open)} style={{ fontFamily: `"${value}", ${FONT_FALLBACK}` }}>
        {value}
      </button>
      {open && (
        <div className="menu font-menu">
          <input className="text" autoFocus placeholder="Buscar fonte…" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <div className="font-list">
            {list.map((f) => (
              <button
                key={f}
                type="button"
                className={`menu-item ${f === value ? "on" : ""}`}
                style={{ fontFamily: `"${f}", ${FONT_FALLBACK}` }}
                onClick={() => {
                  onChange(f);
                  setOpen(false);
                }}
              >
                {f}
              </button>
            ))}
            {list.length === 0 && <div className="muted pad">Nenhuma fonte encontrada</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function TypographySection({ l, multiline }: { l: TextLayer | ClockLayer; multiline: boolean }) {
  const s = l.style;
  const set = (patch: Partial<TextStyle>, f: string) =>
    updateLayer<TextLayer | ClockLayer>(l.id, (x) => ({ style: { ...x.style, ...patch } }), `${l.id}:st:${f}`);
  return (
    <>
      <Section title="Tipografia">
        <Row label="Fonte">
          <FontPicker value={s.fontFamily} onChange={(v) => set({ fontFamily: v }, "font")} />
        </Row>
        <div className="grid2">
          <NumberField label="Tam." title="Tamanho da fonte" value={s.fontSize} min={4} max={480} suffix="px" onChange={(v) => set({ fontSize: v }, "size")} />
          <Select
            value={s.fontWeight}
            onChange={(v) => set({ fontWeight: v }, "weight")}
            options={[
              { value: 100, label: "Fina" },
              { value: 300, label: "Leve" },
              { value: 400, label: "Normal" },
              { value: 500, label: "Média" },
              { value: 600, label: "Seminegrito" },
              { value: 700, label: "Negrito" },
              { value: 900, label: "Black" },
            ]}
          />
        </div>
        <Row label="Cor">
          <ColorField value={s.color} onChange={(v) => set({ color: v }, "color")} />
        </Row>
        <Row label="Alinhar">
          <Segmented
            value={s.align}
            onChange={(v) => set({ align: v }, "align")}
            options={[
              { value: "left", label: "Esq." },
              { value: "center", label: "Centro" },
              { value: "right", label: "Dir." },
            ]}
          />
        </Row>
        <Row label="Letras">
          <Select
            value={s.transform}
            onChange={(v) => set({ transform: v }, "tr")}
            options={[
              { value: "none", label: "Como digitado" },
              { value: "upper", label: "MAIÚSCULAS" },
              { value: "lower", label: "minúsculas" },
              { value: "capitalize", label: "Primeira maiúscula" },
            ]}
          />
        </Row>
        <div className="grid2">
          <NumberField label="Esp." title="Espaçamento entre letras" value={s.letterSpacing} min={-20} max={100} step={0.5} suffix="px" onChange={(v) => set({ letterSpacing: v }, "ls")} />
          {multiline && (
            <NumberField label="Linha" title="Altura da linha" value={s.lineHeight} min={0.6} max={3} step={0.05} onChange={(v) => set({ lineHeight: v }, "lh")} />
          )}
        </div>
        <Toggle checked={s.italic} onChange={(v) => set({ italic: v }, "it")} label="Itálico" />
      </Section>
      <Section title="Contorno e sombra" defaultOpen={s.strokeWidth > 0 || s.shadowBlur > 0}>
        <Row label="Contorno">
          <ColorField value={s.strokeColor} onChange={(v) => set({ strokeColor: v }, "sc")} />
        </Row>
        <Row label="Espessura">
          <Slider value={s.strokeWidth} min={0} max={20} step={0.5} onChange={(v) => set({ strokeWidth: v }, "sw")} format={(v) => `${v} px`} />
        </Row>
        <Row label="Sombra">
          <ColorField value={s.shadowColor} onChange={(v) => set({ shadowColor: v }, "shc")} />
        </Row>
        <Row label="Desfoque">
          <Slider value={s.shadowBlur} min={0} max={40} onChange={(v) => set({ shadowBlur: v }, "shb")} format={(v) => `${v} px`} />
        </Row>
        <div className="grid2">
          <NumberField label="X" value={s.shadowX} min={-40} max={40} onChange={(v) => set({ shadowX: v }, "shx")} />
          <NumberField label="Y" value={s.shadowY} min={-40} max={40} onChange={(v) => set({ shadowY: v }, "shy")} />
        </div>
      </Section>
    </>
  );
}

function useEditTextFocus() {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    const f = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("dv:edit-text", f);
    return () => window.removeEventListener("dv:edit-text", f);
  }, []);
  return ref;
}

function TextInspector({ l }: { l: TextLayer }) {
  const ref = useEditTextFocus();
  return (
    <>
      <Section title="Conteúdo">
        <textarea
          ref={ref}
          className="text area"
          rows={3}
          value={l.text}
          onChange={(e) => updateLayer<TextLayer>(l.id, { text: e.currentTarget.value }, `${l.id}:text`)}
        />
      </Section>
      <TypographySection l={l} multiline />
    </>
  );
}

const LOCALES = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "en-US", label: "English" },
  { value: "es-ES", label: "Español" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "it-IT", label: "Italiano" },
  { value: "ja-JP", label: "日本語" },
];

/** Valores atuais dos sensores ("--" na tela quando o sensor não existe). */
function SensorReadout() {
  const [, tick] = useState(0);
  useEffect(() => watchSensors(() => tick((n) => n + 1)), []);
  const r = liveReadings();
  const fmt = (v: number | null) => (v == null ? "não encontrado" : `${Math.round(v)} °C`);
  return (
    <dl className="sensor-readout">
      <dt>CPU</dt><dd>{fmt(r.cpuTemp)}</dd>
      <dt>Hotspot da GPU</dt><dd>{fmt(r.gpuHot)}</dd>
      <dt>GPU</dt><dd>{fmt(r.gpuTemp)}</dd>
    </dl>
  );
}

function ClockInspector({ l }: { l: ClockLayer }) {
  const ref = useEditTextFocus();
  const set = (patch: Partial<ClockLayer>, f: string) => updateLayer<ClockLayer>(l.id, patch, `${l.id}:${f}`);
  const preset = CLOCK_PRESETS.find((p) => p.template === l.template)?.template ?? "custom";
  const insert = (tok: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? l.template.length;
    const end = el?.selectionEnd ?? at;
    const next = `${l.template.slice(0, at)}{${tok}}${l.template.slice(end)}`;
    set({ template: next }, "tpl");
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + tok.length + 2;
      el?.setSelectionRange(pos, pos);
    });
  };
  return (
    <>
      <Section title="Formato">
        <Row label="Modelo">
          <Select
            value={preset}
            onChange={(v) => v !== "custom" && set({ template: v }, "preset")}
            options={[
              ...CLOCK_PRESETS.map((p) => ({ value: p.template, label: `${{ time: "Hora", date: "Data", sensor: "Sensor" }[p.kind]} · ${p.label}` })),
              { value: "custom", label: "Personalizado" },
            ]}
          />
        </Row>
        <input
          ref={ref}
          className="text mono"
          value={l.template}
          spellCheck={false}
          onChange={(e) => set({ template: e.currentTarget.value }, "tpl")}
        />
        <div className="chips">
          {TOKEN_HELP.map((t) => (
            <button key={t.tok} type="button" className="chip" title={t.desc} onClick={() => insert(t.tok)}>
              {t.tok}
            </button>
          ))}
        </div>
        <Row label="Idioma">
          <Select value={l.locale} options={LOCALES} onChange={(v) => set({ locale: v }, "loc")} />
        </Row>
        {usesSensors(l.template) && <SensorReadout />}
        <p className="note">
          Atualizado ao vivo pelo player. Com segundos ou temperatura a tela é atualizada a cada segundo (só quando o
          número muda); com hora e minuto, uma vez por minuto.
        </p>
      </Section>
      <TypographySection l={l} multiline={false} />
    </>
  );
}

// ---------- forma ----------

function ShapeInspector({ l }: { l: ShapeLayer }) {
  const set = (patch: Partial<ShapeLayer>, f: string) => updateLayer<ShapeLayer>(l.id, patch, `${l.id}:${f}`);
  return (
    <Section title="Forma">
      <Segmented
        value={l.shape}
        onChange={(v) => set({ shape: v, fillEnabled: v === "ring" ? false : l.fillEnabled, strokeWidth: v === "ring" && !l.strokeWidth ? 10 : l.strokeWidth }, "shape")}
        options={[
          { value: "rect", icon: <IconSquare size={14} />, label: "Retâng." },
          { value: "ellipse", icon: <IconCircle size={14} />, label: "Elipse" },
          { value: "ring", icon: <IconRing size={14} />, label: "Anel" },
        ]}
      />
      {l.shape !== "ring" && (
        <>
          <Toggle checked={l.fillEnabled} onChange={(v) => set({ fillEnabled: v }, "fe")} label="Preenchimento" />
          {l.fillEnabled && (
            <Row label="Cor">
              <ColorField value={l.fill} onChange={(v) => set({ fill: v }, "fill")} />
            </Row>
          )}
        </>
      )}
      <Row label="Borda">
        <ColorField value={l.stroke} onChange={(v) => set({ stroke: v }, "stroke")} />
      </Row>
      <Row label="Espessura">
        <Slider value={l.strokeWidth} min={0} max={80} onChange={(v) => set({ strokeWidth: v }, "sw")} format={(v) => `${v} px`} />
      </Row>
      {l.shape === "rect" && (
        <Row label="Cantos">
          <Slider value={l.radius} min={0} max={Math.round(Math.min(l.w, l.h) / 2)} onChange={(v) => set({ radius: v }, "r")} format={(v) => `${v} px`} />
        </Row>
      )}
    </Section>
  );
}

// ---------- desenho ----------

function DrawingInspector({ l }: { l: DrawingLayer }) {
  const tool = useStore((s) => s.tool);
  const brush = useStore((s) => s.brush);
  const swatches = ["#ffffff", "#000000", "#ef4444", "#f59e0b", "#22c55e", "#38bdf8", "#6366f1", "#ec4899"];
  return (
    <Section title="Pincel">
      <Segmented
        value={tool}
        onChange={(v) => store.set({ tool: v })}
        options={[
          { value: "select", icon: <IconCursor size={14} />, label: "Mover", title: "Selecionar e mover (V)" },
          { value: "brush", icon: <IconBrush size={14} />, label: "Pincel", title: "Pincel (B)" },
          { value: "eraser", icon: <IconEraser size={14} />, label: "Borracha", title: "Borracha (E)" },
        ]}
      />
      <Row label="Cor">
        <ColorField value={brush.color} onChange={(c) => store.set({ brush: { ...brush, color: c } })} />
      </Row>
      <div className="swatches">
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch-btn ${brush.color === c ? "on" : ""}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => store.set({ brush: { ...brush, color: c } })}
          />
        ))}
      </div>
      <Row label="Tamanho">
        <Slider value={brush.width} min={1} max={80} onChange={(v) => store.set({ brush: { ...brush, width: v } })} format={(v) => `${v} px`} />
      </Row>
      <div className="btn-row">
        <button
          type="button"
          className="btn small"
          disabled={!l.strokes.length}
          onClick={() => updateLayer<DrawingLayer>(l.id, { strokes: l.strokes.slice(0, -1) })}
        >
          Apagar último traço
        </button>
        <button type="button" className="btn small ghost" disabled={!l.strokes.length} onClick={() => updateLayer<DrawingLayer>(l.id, { strokes: [] })}>
          Limpar tudo
        </button>
      </div>
    </Section>
  );
}
