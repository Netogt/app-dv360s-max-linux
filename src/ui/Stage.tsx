import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { drawingLayer } from "../defaults";
import { liveFrame, useLive } from "../live";
import { useDropZone } from "../nativeDrop";
import { onAssetsChanged } from "../render/assets";
import { drawScene, isAnimated } from "../render/draw";
import { setSimulated, useSimulated, watchSensors } from "../render/sensors";
import { updatesEverySecond, usesSensors } from "../render/text";
import { addLayer, curLayers, getLayer, select, store, updateLayer, useStore } from "../store";
import type { ClockLayer, DrawingLayer, Layer, TextLayer } from "../types";
import { SIZE } from "../types";
import { rotate, uid } from "../util";
import { nextRotation, playerConfig, usePlayerConfig } from "../playerConfig";
import { ScreenTabs } from "./Screens";
import { IconBackground, IconLayers, IconMaximize, IconPause, IconPlay, IconRotate, IconTarget } from "./icons";

type Box = { x: number; y: number; w: number; h: number; rotation: number };
type Drag =
  | { type: "move"; id: string; key: string; sx: number; sy: number; ox: number; oy: number }
  | { type: "resize"; id: string; key: string; hx: number; hy: number; start: Box; fontSize?: number }
  | { type: "rotate"; id: string; key: string; cx: number; cy: number }
  | { type: "draw"; id: string; key: string };

const MIN = 8;
const HANDLES: [string, number, number][] = [
  ["nw", -1, -1], ["n", 0, -1], ["ne", 1, -1], ["e", 1, 0],
  ["se", 1, 1], ["s", 0, 1], ["sw", -1, 1], ["w", -1, 0],
];

function hitTest(layers: Layer[], x: number, y: number): Layer | null {
  for (let i = layers.length - 1; i >= 1; i--) {
    const l = layers[i];
    if (!l.visible || l.locked) continue;
    const [lx, ly] = rotate(x - (l.x + l.w / 2), y - (l.y + l.h / 2), -l.rotation);
    if (Math.abs(lx) <= l.w / 2 && Math.abs(ly) <= l.h / 2) return l;
  }
  return null;
}

function resizeBox(s: Box, hx: number, hy: number, x: number, y: number, keep: boolean, fromCenter: boolean) {
  const cx0 = s.x + s.w / 2;
  const cy0 = s.y + s.h / 2;
  const [lx, ly] = rotate(x - cx0, y - cy0, -s.rotation);
  const ax = (-hx * s.w) / 2;
  const ay = (-hy * s.h) / 2;
  let w = s.w;
  let h = s.h;
  if (fromCenter) {
    if (hx) w = Math.max(MIN, 2 * Math.abs(lx));
    if (hy) h = Math.max(MIN, 2 * Math.abs(ly));
  } else {
    if (hx) w = Math.max(MIN, (lx - ax) * hx);
    if (hy) h = Math.max(MIN, (ly - ay) * hy);
  }
  if (keep) {
    if (hx && hy) {
      const k = Math.max(w / s.w, h / s.h);
      w = s.w * k;
      h = s.h * k;
    } else if (hx) h = (s.h * w) / s.w;
    else w = (s.w * h) / s.h;
  }
  const clx = fromCenter || !hx ? 0 : ax + (hx * w) / 2;
  const cly = fromCenter || !hy ? 0 : ay + (hy * h) / 2;
  const [dx, dy] = rotate(clx, cly, s.rotation);
  return { x: cx0 + dx - w / 2, y: cy0 + dy - h / 2, w, h, k: w / s.w };
}

function toDrawing(l: DrawingLayer, x: number, y: number): [number, number] {
  const [lx, ly] = rotate(x - (l.x + l.w / 2), y - (l.y + l.h / 2), -l.rotation);
  return [((lx + l.w / 2) * l.viewW) / l.w, ((ly + l.h / 2) * l.viewH) / l.h];
}

export function Stage() {
  const project = useStore((s) => s.project);
  const layers = useStore((s) => curLayers(s));
  const selectedId = useStore((s) => s.selectedId);
  const tool = useStore((s) => s.tool);
  const brush = useStore((s) => s.brush);
  const zoom = useStore((s) => s.zoom);
  const playing = useStore((s) => s.playing);
  const circleGuide = useStore((s) => s.circleGuide);

  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const timeRef = useRef({ t: 0, last: 0 });
  const [fit, setFit] = useState(520);
  const [hover, setHover] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const drop = useDropZone();
  const [assetsTick, setAssetsTick] = useState(0);

  const live = useLive();
  const simulated = useSimulated() != null;
  const pcfg = usePlayerConfig();
  const rotation = pcfg?.rotation ?? 0;
  const display = zoom === "fit" ? fit : Math.round(SIZE * zoom);
  const scale = display / SIZE;

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      // reserva espaço para a barra de zoom embaixo
      setFit(Math.max(200, Math.floor(Math.min(width - 64, height - 184))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => onAssetsChanged(() => setAssetsTick((n) => n + 1)), []);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const px = Math.round(display * (window.devicePixelRatio || 1));
    if (c.width !== px) {
      c.width = px;
      c.height = px;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(px / SIZE, 0, 0, px / SIZE, 0, 0);
    ctx.imageSmoothingQuality = "high";
    drawScene(ctx, curLayers(), { t: timeRef.current.t, now: new Date(), mode: "preview" });
    liveFrame(timeRef.current.t);
  }, [display]);

  // ciclo de desenho: só anima quando precisa (o editor também deve ser leve)
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const visible = layers.filter((l) => l.visible);
    const animated = visible.some(isAnimated);
    const clocks = visible.filter((l): l is ClockLayer => l.kind === "clock");
    draw();
    if (playing && animated) {
      let lastFrame = -1;
      timeRef.current.last = performance.now();
      const tick = (ts: number) => {
        if (!alive) return;
        const tr = timeRef.current;
        tr.t += Math.max(0, ts - tr.last) / 1000;
        tr.last = ts;
        const f = Math.floor(tr.t * project.fps);
        if (f !== lastFrame) {
          lastFrame = f;
          draw();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else if (clocks.length) {
      const secs = clocks.some((c) => updatesEverySecond(c.template));
      const loop = () => {
        if (!alive) return;
        draw();
        const now = Date.now();
        timer = setTimeout(loop, secs ? 1000 - (now % 1000) + 5 : 60000 - (now % 60000) + 5);
      };
      const now = Date.now();
      timer = setTimeout(loop, 1000 - (now % 1000) + 5);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [project, playing, draw, assetsTick]);

  // temperaturas: só lê o sistema enquanto alguma camada visível mostra sensor
  const needsSensors = layers.some((l) => l.visible && l.kind === "clock" && usesSensors(l.template));
  useEffect(() => (needsSensors ? watchSensors(draw) : undefined), [needsSensors, draw]);

  const sel = layers.find((l) => l.id === selectedId) ?? null;
  const hoverLayer = hover && hover !== selectedId ? layers.find((l) => l.id === hover) : null;
  const drawingMode = tool !== "select";

  const toCanvas = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = overlayRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  const snapMove = (l: Layer, nx: number, ny: number, off: boolean) => {
    if (off) return { x: nx, y: ny, v: [] as number[], h: [] as number[] };
    const th = 6 / scale;
    const tx = [0, SIZE / 2, SIZE];
    const ty = [0, SIZE / 2, SIZE];
    for (const o of curLayers()) {
      if (o.id === l.id || o.kind === "background" || !o.visible) continue;
      tx.push(o.x, o.x + o.w / 2, o.x + o.w);
      ty.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    const best = (cands: number[], targets: number[]) => {
      let d = Infinity;
      let at = 0;
      for (const c of cands)
        for (const t of targets) {
          if (Math.abs(t - c) < Math.abs(d)) {
            d = t - c;
            at = t;
          }
        }
      return Math.abs(d) <= th ? { d, at } : null;
    };
    const bx = best([nx, nx + l.w / 2, nx + l.w], tx);
    const by = best([ny, ny + l.h / 2, ny + l.h], ty);
    return { x: nx + (bx?.d ?? 0), y: ny + (by?.d ?? 0), v: bx ? [bx.at] : [], h: by ? [by.at] : [] };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const [x, y] = toCanvas(e);
    const st = store.get();
    const current = getLayer(st.selectedId);
    const key = uid();
    store.breakCoalesce();

    if (st.tool !== "select") {
      let target = current?.kind === "drawing" && !current.locked ? current : null;
      if (!target) {
        const t = st.tool;
        target = drawingLayer();
        addLayer(target);
        store.set({ tool: t });
      }
      const [px, py] = toDrawing(target, x, y);
      const width = (st.brush.width * target.viewW) / target.w;
      updateLayer<DrawingLayer>(
        target.id,
        (l) => ({ strokes: [...l.strokes, { color: st.brush.color, width, erase: st.tool === "eraser", points: [px, py] }] }),
        key,
      );
      dragRef.current = { type: "draw", id: target.id, key };
    } else {
      const handle = (e.target as HTMLElement).dataset.handle;
      if (handle && current && !current.locked) {
        if (handle === "rot") {
          dragRef.current = { type: "rotate", id: current.id, key, cx: current.x + current.w / 2, cy: current.y + current.h / 2 };
        } else {
          const [, hx, hy] = HANDLES.find((h) => h[0] === handle)!;
          const fontSize = current.kind === "text" || current.kind === "clock" ? current.style.fontSize : undefined;
          dragRef.current = { type: "resize", id: current.id, key, hx, hy, start: { ...current }, fontSize };
        }
      } else {
        const hit = hitTest(curLayers(st), x, y);
        // clicar dentro da seleção atual mantém a seleção (permite arrastar camadas sobrepostas)
        const keepSel =
          current &&
          current.kind !== "background" &&
          !current.locked &&
          (() => {
            const [lx, ly] = rotate(x - (current.x + current.w / 2), y - (current.y + current.h / 2), -current.rotation);
            return Math.abs(lx) <= current.w / 2 && Math.abs(ly) <= current.h / 2;
          })();
        const target = keepSel ? current : hit;
        if (target) {
          select(target.id);
          dragRef.current = { type: "move", id: target.id, key, sx: x, sy: y, ox: target.x, oy: target.y };
        } else select(null);
      }
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = toCanvas(e);
    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
    }
    const d = dragRef.current;
    if (!d) {
      if (!drawingMode) {
        const h = hitTest(curLayers(), x, y)?.id ?? null;
        if (h !== hover) setHover(h);
      }
      return;
    }
    const l = getLayer(d.id);
    if (!l) return;
    switch (d.type) {
      case "move": {
        const s = snapMove(l, d.ox + x - d.sx, d.oy + y - d.sy, e.ctrlKey || e.metaKey);
        setGuides({ v: s.v, h: s.h });
        updateLayer(l.id, { x: Math.round(s.x), y: Math.round(s.y) }, d.key);
        break;
      }
      case "resize": {
        const isText = d.fontSize != null;
        const corner = d.hx !== 0 && d.hy !== 0;
        const prefersKeep = l.kind === "media" || l.kind === "drawing" || (isText && corner);
        const keep = e.shiftKey ? !prefersKeep : prefersKeep;
        const r = resizeBox(d.start, d.hx, d.hy, x, y, keep, e.altKey);
        const patch: Partial<TextLayer> = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
        if (isText && corner && keep) {
          const st = (l as TextLayer | ClockLayer).style;
          patch.style = { ...st, fontSize: Math.max(4, Math.round(d.fontSize! * r.k)) };
        }
        updateLayer<TextLayer>(l.id, patch, d.key);
        break;
      }
      case "rotate": {
        let a = (Math.atan2(y - d.cy, x - d.cx) * 180) / Math.PI + 90;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        else {
          const near = Math.round(a / 45) * 45;
          if (Math.abs(a - near) < 3) a = near;
        }
        a = ((a + 540) % 360) - 180;
        updateLayer(l.id, { rotation: Math.round(a * 10) / 10 }, d.key);
        break;
      }
      case "draw": {
        if (l.kind !== "drawing") break;
        const [px, py] = toDrawing(l, x, y);
        updateLayer<DrawingLayer>(
          l.id,
          (dl) => {
            const strokes = [...dl.strokes];
            const last = strokes[strokes.length - 1];
            const p = last.points;
            if (Math.hypot(px - p[p.length - 2], py - p[p.length - 1]) < 1.5) return {};
            strokes[strokes.length - 1] = { ...last, points: [...p, px, py] };
            return { strokes };
          },
          d.key,
        );
        break;
      }
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    store.breakCoalesce();
    if (guides.v.length || guides.h.length) setGuides({ v: [], h: [] });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const [x, y] = toCanvas(e);
    const hit = hitTest(curLayers(), x, y);
    if (hit && (hit.kind === "text" || hit.kind === "clock")) {
      select(hit.id);
      window.dispatchEvent(new CustomEvent("dv:edit-text"));
    }
  };

  const setZoom = (z: number | "fit") => store.set({ zoom: z });
  const zoomPct = Math.round(scale * 100);
  const stepZoom = (dir: number) => {
    const steps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    const cur = scale;
    const next = dir > 0 ? steps.find((s) => s > cur + 0.01) : [...steps].reverse().find((s) => s < cur - 0.01);
    setZoom(next ?? (dir > 0 ? 3 : 0.5));
  };

  return (
    <main
      className="stage-area"
      ref={areaRef}
      onWheel={(e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          stepZoom(e.deltaY < 0 ? 1 : -1);
        }
      }}
    >
      <ScreenTabs />
      <div className="stage-scroll">
        <div className="stage" style={{ width: display, height: display }}>
          <canvas ref={canvasRef} style={{ width: display, height: display }} />
          {live && (
            <div className="live-badge" title="O cooler está mostrando esta prévia (o tema aplicado volta quando você desligar)">
              <span className="rec" /> Ao vivo no cooler
            </div>
          )}
          {simulated && (
            <button type="button" className="sim-badge" onClick={() => setSimulated(null)} title="Clique para voltar aos valores reais">
              Sensores simulados ✕
            </button>
          )}
          {rotation !== 0 && (
            <div className="rotation-badge" title="Tudo o que for enviado aparece girado no cooler">
              <IconRotate size={13} /> Girado {rotation}° no cooler
            </div>
          )}
          <div
            ref={overlayRef}
            className={`stage-overlay ${drawingMode ? "drawing" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={onDoubleClick}
          >
            {circleGuide && <div className="circle-guide" />}
            {hoverLayer && hoverLayer.kind !== "background" && <SelBox l={hoverLayer} scale={scale} variant="hover" />}
            {sel && sel.kind !== "background" && sel.visible && (
              <SelBox l={sel} scale={scale} variant={sel.locked ? "locked" : "selected"} handles={!sel.locked && !drawingMode} />
            )}
            {guides.v.map((g) => (
              <div key={`v${g}`} className="guide v" style={{ left: g * scale }} />
            ))}
            {guides.h.map((g) => (
              <div key={`h${g}`} className="guide h" style={{ top: g * scale }} />
            ))}
            {drawingMode && (
              <div
                ref={cursorRef}
                className={`brush-cursor ${tool}`}
                style={{ width: brush.width * scale, height: brush.width * scale, margin: (-brush.width * scale) / 2 }}
              />
            )}
          </div>
        </div>
      </div>

      {drop && (
        <div className="drop-overlay">
          <div data-zone="layer" className={`drop-zone ${drop === "layer" ? "on" : ""}`}>
            <IconLayers size={28} />
            <strong>Adicionar como camada</strong>
            <span>imagem, GIF ou vídeo</span>
          </div>
          <div data-zone="bg" className={`drop-zone ${drop === "bg" ? "on" : ""}`}>
            <IconBackground size={28} />
            <strong>Usar como fundo</strong>
            <span>preenche a tela inteira</span>
          </div>
        </div>
      )}

      <div className="stage-bar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => store.set({ playing: !playing })}
          title={playing ? "Pausar prévia (Espaço)" : "Tocar prévia (Espaço)"}
        >
          {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
        </button>
        <span className="bar-sep" />
        <button type="button" className="icon-btn" onClick={() => stepZoom(-1)} title="Diminuir zoom (Ctrl −)">
          −
        </button>
        <button type="button" className="zoom-value" onClick={() => setZoom(1)} title="Tamanho real (100%)">
          {zoomPct}%
        </button>
        <button type="button" className="icon-btn" onClick={() => stepZoom(1)} title="Aumentar zoom (Ctrl +)">
          +
        </button>
        <button
          type="button"
          className={`icon-btn ${zoom === "fit" ? "active" : ""}`}
          onClick={() => setZoom("fit")}
          title="Ajustar à janela (Ctrl 0)"
        >
          <IconMaximize size={15} />
        </button>
        <span className="bar-sep" />
        <button
          type="button"
          className={`icon-btn rotate-btn ${rotation ? "active" : ""}`}
          disabled={!pcfg}
          onClick={() => playerConfig.update({ rotation: nextRotation(rotation) })}
          title="Girar a tela do cooler (0° → 90° → 180° → 270°). A prévia aqui não gira."
        >
          <IconRotate size={15} />
          {rotation ? <span>{rotation}°</span> : null}
        </button>
        <button
          type="button"
          className={`icon-btn ${circleGuide ? "active" : ""}`}
          onClick={() => store.set({ circleGuide: !circleGuide })}
          title="Guia circular (área visível em telas redondas)"
        >
          <IconTarget size={15} />
        </button>
        <span className="stage-info">
          {SIZE} × {SIZE} · {project.fps} fps
        </span>
      </div>
    </main>
  );
}

function SelBox({ l, scale, variant, handles }: { l: Layer; scale: number; variant: string; handles?: boolean }) {
  return (
    <div
      className={`selbox ${variant}`}
      style={{
        left: l.x * scale,
        top: l.y * scale,
        width: l.w * scale,
        height: l.h * scale,
        transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
      }}
    >
      {handles && (
        <>
          <div className="rot-stem" />
          <div className="handle rot" data-handle="rot" title="Girar (Shift: de 15 em 15°)" />
          {HANDLES.map(([k]) => (
            <div key={k} className={`handle h-${k}`} data-handle={k} />
          ))}
        </>
      )}
      {variant === "selected" && (
        <div className="sel-size" style={{ transform: l.rotation ? `rotate(${-l.rotation}deg)` : undefined }}>
          {Math.round(l.w)} × {Math.round(l.h)}
        </div>
      )}
    </div>
  );
}
