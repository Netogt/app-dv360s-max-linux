import { useCallback, useRef, useState } from "react";
import { ACCEPT_IMAGE, ACCEPT_VIDEO, pickMedia } from "../actions";
import { clockLayer, drawingLayer, sensorLayer, shapeLayer, textLayer } from "../defaults";
import { getAsset } from "../render/assets";
import { usesSensors } from "../render/text";
import { addLayer, curLayers, duplicateLayer, moveLayer, removeLayer, select, updateLayer, useStore } from "../store";
import type { Layer } from "../types";
import { useDismiss } from "./controls";
import {
  IconBackground, IconBrush, IconCalendar, IconCircle, IconClock, IconCopy, IconEye, IconEyeOff, IconFilm,
  IconGrip, IconImage, IconLock, IconPlus, IconRing, IconSquare, IconThermometer, IconTrash, IconType, IconUnlock,
} from "./icons";

const ROW = 38;

export function layerIcon(l: Layer, size = 15) {
  switch (l.kind) {
    case "background":
      return <IconBackground size={size} />;
    case "media":
      return getAsset(l.asset)?.meta.type === "video" ? <IconFilm size={size} /> : <IconImage size={size} />;
    case "text":
      return <IconType size={size} />;
    case "clock":
      if (usesSensors(l.template)) return <IconThermometer size={size} />;
      return /\{(H|HH|h|hh|mm|ss)\}/.test(l.template) ? <IconClock size={size} /> : <IconCalendar size={size} />;
    case "shape":
      return l.shape === "rect" ? <IconSquare size={size} /> : l.shape === "ring" ? <IconRing size={size} /> : <IconCircle size={size} />;
    case "drawing":
      return <IconBrush size={size} />;
  }
}

function AddMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const items: { icon: React.ReactNode; label: string; hint?: string; run: () => void }[][] = [
    [
      { icon: <IconImage />, label: "Imagem ou GIF", hint: "PNG, JPG, WebP, GIF", run: () => pickMedia(ACCEPT_IMAGE) },
      { icon: <IconFilm />, label: "Vídeo", hint: "MP4, WebM, MKV", run: () => pickMedia(ACCEPT_VIDEO) },
    ],
    [
      { icon: <IconType />, label: "Texto", run: () => addLayer(textLayer()) },
      { icon: <IconClock />, label: "Hora", hint: "atualiza ao vivo", run: () => addLayer(clockLayer("time")) },
      { icon: <IconCalendar />, label: "Data", hint: "atualiza ao vivo", run: () => addLayer(clockLayer("date")) },
    ],
    [
      { icon: <IconThermometer />, label: "Temperatura da CPU", hint: "°C ao vivo", run: () => addLayer(sensorLayer("cpu")) },
      { icon: <IconThermometer />, label: "Hotspot da GPU", hint: "°C ao vivo", run: () => addLayer(sensorLayer("gpuHot")) },
    ],
    [
      { icon: <IconSquare />, label: "Retângulo", run: () => addLayer(shapeLayer("rect")) },
      { icon: <IconCircle />, label: "Elipse", run: () => addLayer(shapeLayer("ellipse")) },
      { icon: <IconRing />, label: "Anel", hint: "borda redonda da tela", run: () => addLayer(shapeLayer("ring")) },
      { icon: <IconBrush />, label: "Desenho livre", hint: "pincel e borracha", run: () => addLayer(drawingLayer()) },
    ],
  ];
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className={`btn primary small ${open ? "pressed" : ""}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconPlus size={14} /> Adicionar
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((group, gi) => (
            <div key={gi} className="menu-group">
              {group.map((it) => (
                <button key={it.label} type="button" role="menuitem" className="menu-item" onClick={run(it.run)}>
                  <span className="menu-icon">{it.icon}</span>
                  <span className="menu-label">{it.label}</span>
                  {it.hint && <span className="menu-hint">{it.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LayerRow({ l, selected, onGrip, dragging }: {
  l: Layer;
  selected: boolean;
  dragging: boolean;
  onGrip?: (e: React.PointerEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const isBg = l.kind === "background";
  return (
    <div
      className={`layer-row ${selected ? "selected" : ""} ${!l.visible ? "hidden" : ""} ${dragging ? "dragging" : ""}`}
      onPointerDown={(e) => {
        if (e.button === 0) select(l.id);
      }}
      onDoubleClick={() => setEditing(true)}
      role="option"
      aria-selected={selected}
    >
      {onGrip ? (
        <span className="grip" onPointerDown={onGrip} title="Arraste para reordenar">
          <IconGrip size={14} />
        </span>
      ) : (
        <span className="grip placeholder" />
      )}
      <span className="layer-icon">{layerIcon(l)}</span>
      {editing ? (
        <input
          className="layer-name-input"
          autoFocus
          defaultValue={l.name}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== l.name) updateLayer(l.id, { name: v });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="layer-name">{l.name}</span>
      )}
      <span className="layer-actions">
        {!isBg && (
          <button
            type="button"
            className={`icon-btn ghost ${l.locked ? "on" : ""}`}
            title={l.locked ? "Desbloquear" : "Bloquear"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => updateLayer(l.id, { locked: !l.locked })}
          >
            {l.locked ? <IconLock size={14} /> : <IconUnlock size={14} />}
          </button>
        )}
        <button
          type="button"
          className={`icon-btn ghost ${!l.visible ? "on" : ""}`}
          title={l.visible ? "Ocultar" : "Mostrar"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateLayer(l.id, { visible: !l.visible })}
        >
          {l.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        </button>
      </span>
    </div>
  );
}

export function LayersPanel() {
  const layers = useStore((s) => curLayers(s));
  const selectedId = useStore((s) => s.selectedId);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; target: number } | null>(null);
  const rows = [...layers].reverse();
  const sel = layers.find((l) => l.id === selectedId);
  const selIndex = sel ? layers.indexOf(sel) : -1;

  const startDrag = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    select(id);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const from = rows.findIndex((r) => r.id === id);
    let target = from;
    setDrag({ id, target });
    const move = (ev: PointerEvent) => {
      const top = listRef.current!.getBoundingClientRect().top;
      target = Math.max(0, Math.min(rows.length - 2, Math.floor((ev.clientY - top + listRef.current!.scrollTop) / ROW)));
      setDrag({ id, target });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setDrag(null);
      if (target !== from) moveLayer(id, layers.length - 1 - target);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <aside className="panel left">
      <header className="panel-head">
        <span className="panel-title">Camadas</span>
        <AddMenu />
      </header>
      <div className="layer-list" ref={listRef} role="listbox" aria-label="Camadas">
        {rows.map((l) => (
          <LayerRow
            key={l.id}
            l={l}
            selected={l.id === selectedId}
            dragging={drag?.id === l.id}
            onGrip={l.kind === "background" ? undefined : startDrag(l.id)}
          />
        ))}
        {drag && <div className="drop-line" style={{ top: (drag.target + (drag.target > rows.findIndex((r) => r.id === drag.id) ? 1 : 0)) * ROW }} />}
        {layers.length === 1 && (
          <div className="empty-hint">
            Comece adicionando uma hora, um texto ou uma imagem — ou arraste arquivos para a tela.
          </div>
        )}
      </div>
      <footer className="panel-foot">
        <button type="button" className="icon-btn" disabled={selIndex < 1 || selIndex >= layers.length - 1} title="Subir camada (Ctrl ↑)" onClick={() => sel && moveLayer(sel.id, selIndex + 1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" disabled={selIndex <= 1} title="Descer camada (Ctrl ↓)" onClick={() => sel && moveLayer(sel.id, selIndex - 1)}>
          ↓
        </button>
        <span className="grow" />
        <button type="button" className="icon-btn" disabled={selIndex < 1} title="Duplicar (Ctrl D)" onClick={() => sel && duplicateLayer(sel.id)}>
          <IconCopy size={15} />
        </button>
        <button type="button" className="icon-btn danger" disabled={selIndex < 1} title="Excluir (Delete)" onClick={() => sel && removeLayer(sel.id)}>
          <IconTrash size={15} />
        </button>
      </footer>
    </aside>
  );
}
