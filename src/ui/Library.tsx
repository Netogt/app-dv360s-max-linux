// Biblioteca de temas: os temas salvos (aplicar na tela, editar, excluir) e os exemplos.

import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { newDocument, newFromExample, openDocument, openPath, saveToLibrary } from "../actions";
import { EXAMPLES, type Example } from "../examples";
import { api, type LibTheme } from "../io";
import { drawScene } from "../render/draw";
import { store, useStore } from "../store";
import { SIZE } from "../types";
import { formatBytes } from "../util";
import { toast } from "./feedback";
import { IconCheck, IconFile, IconFolder, IconImage, IconSave, IconSend, IconTrash, IconX } from "./icons";

export type LibraryTab = "mine" | "examples";

let tab: LibraryTab | null = null;
const ls = new Set<() => void>();
const sub = (l: () => void) => {
  ls.add(l);
  return () => {
    ls.delete(l);
  };
};

/** Abre a biblioteca numa aba (null fecha). */
export function openLibrary(t: LibraryTab | null) {
  tab = t;
  ls.forEach((l) => l());
}

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `hoje, ${time}`;
  return `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}, ${time}`;
};

function Thumb({ t }: { t: LibTheme }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!t.hasThumb) return;
    let u: string | null = null;
    let alive = true;
    api
      .libraryThumb(t.path)
      .then((b) => {
        if (!alive || !b.length) return;
        u = URL.createObjectURL(new Blob([b as BlobPart], { type: "image/jpeg" }));
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [t.path, t.modified, t.hasThumb]);
  return url ? <img src={url} alt="" draggable={false} /> : <IconImage size={28} />;
}

function ExampleThumb({ ex }: { ex: Example }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const px = 180 * (window.devicePixelRatio || 1);
    c.width = px;
    c.height = px;
    const ctx = c.getContext("2d")!;
    ctx.scale(px / SIZE, px / SIZE);
    drawScene(ctx, ex.make().screens[0].layers, { t: 0, now: new Date(), mode: "bake" });
  }, [ex]);
  return <canvas ref={ref} />;
}

function MyThemes({ close }: { close: () => void }) {
  const [list, setList] = useState<LibTheme[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const filePath = useStore((s) => s.filePath);
  const dirty = useStore((s) => s.dirty);

  const refresh = useCallback(() => {
    api
      .libraryList()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(refresh, [refresh]);

  const apply = async (t: LibTheme) => {
    setBusy(t.path);
    try {
      await api.libraryApply(t.path);
      toast(`“${t.name}” está na tela`, "success");
      refresh();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: LibTheme) => {
    const ok = await ask(`Excluir “${t.name}” da biblioteca? O arquivo é apagado.`, {
      title: "DV360S Studio",
      kind: "warning",
      okLabel: "Excluir",
      cancelLabel: "Cancelar",
    });
    if (!ok) return;
    try {
      await api.libraryDelete(t.path);
      if (store.get().filePath === t.path) store.set({ filePath: null, dirty: true });
      refresh();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const saveHere = async () => {
    if (await saveToLibrary(list?.map((t) => t.path) ?? [])) refresh();
  };

  const inLibrary = !!filePath && !!list?.some((t) => t.path === filePath);

  return (
    <>
      <div className="lib-actions">
        <button type="button" className="btn primary" onClick={saveHere}>
          <IconSave size={15} /> {inLibrary ? (dirty ? "Salvar alterações" : "Salvo na biblioteca") : "Salvar o tema atual aqui"}
        </button>
        <button type="button" className="btn" onClick={() => (close(), openDocument())}>
          <IconFolder size={15} /> Abrir outro arquivo…
        </button>
      </div>
      {list == null ? (
        <p className="muted pad">Carregando…</p>
      ) : list.length === 0 ? (
        <div className="lib-empty">
          <IconImage size={32} />
          <strong>Nenhum tema salvo ainda</strong>
          <span className="muted">
            Temas salvos aqui aparecem nesta lista e no ícone da bandeja, para trocar o que está no cooler sem abrir o editor.
          </span>
        </div>
      ) : (
        <div className="lib-grid">
          {list.map((t) => (
            <div key={t.path} className={`lib-card ${t.active ? "active" : ""} ${t.path === filePath ? "editing" : ""}`}>
              <button type="button" className="lib-thumb" onClick={() => openPath(t.path).then((ok) => ok && close())} title="Abrir para editar">
                <Thumb t={t} />
                {t.active && (
                  <span className="lib-badge">
                    <IconCheck size={12} /> Na tela
                  </span>
                )}
              </button>
              <div className="lib-info">
                <span className="lib-name" title={t.name}>
                  {t.name}
                </span>
                <span className="muted small">
                  {when(t.modified)} · {formatBytes(t.size)}
                  {t.screens > 1 ? ` · ${t.screens} telas` : ""}
                </span>
              </div>
              <div className="lib-card-actions">
                <button type="button" className="btn small primary" disabled={busy === t.path} onClick={() => apply(t)} title="Mostrar no cooler">
                  <IconSend size={13} /> {t.active ? "Reaplicar" : "Pôr na tela"}
                </button>
                <button type="button" className="btn small" onClick={() => openPath(t.path).then((ok) => ok && close())}>
                  Editar
                </button>
                <button type="button" className="icon-btn danger" onClick={() => remove(t)} title="Excluir">
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Examples({ close }: { close: () => void }) {
  return (
    <div className="lib-grid">
      <button
        type="button"
        className="lib-card example"
        onClick={async () => {
          close();
          await newDocument();
        }}
      >
        <span className="lib-thumb blank">
          <IconFile size={28} />
        </span>
        <span className="lib-info">
          <span className="lib-name">Em branco</span>
          <span className="muted small">Só o fundo, para montar do zero</span>
        </span>
      </button>
      {EXAMPLES.map((ex) => (
        <button
          key={ex.id}
          type="button"
          className="lib-card example"
          onClick={async () => {
            if (await newFromExample(ex)) close();
          }}
        >
          <span className="lib-thumb">
            <ExampleThumb ex={ex} />
          </span>
          <span className="lib-info">
            <span className="lib-name">{ex.name}</span>
            <span className="muted small">{ex.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function LibraryModal() {
  const t = useSyncExternalStore(sub, () => tab);
  const close = useCallback(() => openLibrary(null), []);
  useEffect(() => {
    if (!t) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [t, close]);
  if (!t) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal library" role="dialog" aria-modal="true" aria-label="Temas">
        <header className="lib-head">
          <div className="segmented" role="tablist">
            <button type="button" role="tab" aria-selected={t === "mine"} className={t === "mine" ? "on" : ""} onClick={() => openLibrary("mine")}>
              Meus temas
            </button>
            <button type="button" role="tab" aria-selected={t === "examples"} className={t === "examples" ? "on" : ""} onClick={() => openLibrary("examples")}>
              Novo a partir de…
            </button>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Fechar">
            <IconX size={16} />
          </button>
        </header>
        <div className="lib-body">{t === "mine" ? <MyThemes close={close} /> : <Examples close={close} />}</div>
      </div>
    </div>
  );
}
