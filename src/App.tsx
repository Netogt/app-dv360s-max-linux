import { useEffect, useState } from "react";
import { applyToScreen, importFiles, loadDraft, openDocument, saveDocument, saveDraft } from "./actions";
import { curLayers, duplicateLayer, getLayer, moveLayer, nudge, removeLayer, select, store } from "./store";
import { Inspector } from "./ui/Inspector";
import { LayersPanel } from "./ui/LayersPanel";
import { Stage } from "./ui/Stage";
import { TopBar } from "./ui/TopBar";
import { BusyModal, Toasts } from "./ui/feedback";
import { debounce, isTyping } from "./util";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        saveDocument(e.shiftKey);
        return;
      }
      if (mod && k === "o") {
        e.preventDefault();
        openDocument();
        return;
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        applyToScreen();
        return;
      }
      if (isTyping(e)) return;
      const st = store.get();
      const sel = getLayer(st.selectedId);
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        store.redo();
      } else if (mod && k === "d") {
        e.preventDefault();
        if (sel) duplicateLayer(sel.id);
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        store.set({ zoom: Math.min(3, (typeof st.zoom === "number" ? st.zoom : 1) + 0.25) });
      } else if (mod && e.key === "-") {
        e.preventDefault();
        store.set({ zoom: Math.max(0.5, (typeof st.zoom === "number" ? st.zoom : 1) - 0.25) });
      } else if (mod && e.key === "0") {
        e.preventDefault();
        store.set({ zoom: "fit" });
      } else if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown") && sel) {
        e.preventDefault();
        const i = curLayers(st).indexOf(sel);
        moveLayer(sel.id, i + (e.key === "ArrowUp" ? 1 : -1));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (sel) {
          e.preventDefault();
          removeLayer(sel.id);
        }
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
      } else if (e.key === "Escape") {
        if (st.tool !== "select") store.set({ tool: "select" });
        else select(null);
      } else if (e.key === " ") {
        e.preventDefault();
        store.set({ playing: !st.playing });
      } else if (!mod && k === "v") {
        store.set({ tool: "select" });
      } else if (!mod && (k === "b" || k === "e") && sel?.kind === "drawing") {
        store.set({ tool: k === "b" ? "brush" : "eraser" });
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e as unknown as KeyboardEvent)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        importFiles(files);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}

/** Rascunho automático: reabre de onde parou mesmo sem ter salvo. */
function useDraft() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    loadDraft().finally(() => {
      if (cancelled) return;
      setReady(true);
      const save = debounce(saveDraft, 2500);
      let last = store.get().project;
      unsub = store.subscribe(() => {
        const p = store.get().project;
        if (p !== last) {
          last = p;
          save();
        }
      });
      window.addEventListener("beforeunload", () => saveDraft());
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  return ready;
}

export default function App() {
  useShortcuts();
  const ready = useDraft();
  return (
    <div className="app" onContextMenu={(e) => import.meta.env.PROD && e.preventDefault()}>
      <TopBar />
      <div className="workspace">
        <LayersPanel />
        {ready ? <Stage /> : <main className="stage-area" />}
        <Inspector />
      </div>
      <Toasts />
      <BusyModal />
    </div>
  );
}
