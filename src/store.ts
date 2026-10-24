import { useSyncExternalStore } from "react";
import type { BasePatch, Layer, Project, Screen, Tool } from "./types";
import { newProject } from "./defaults";
import { uid } from "./util";

export interface State {
  project: Project;
  /** tela sendo editada */
  screenId: string;
  selectedId: string | null;
  tool: Tool;
  brush: { color: string; width: number };
  /** "fit" ajusta à área disponível */
  zoom: number | "fit";
  playing: boolean;
  circleGuide: boolean;
  filePath: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

const HISTORY = 100;
/** edições com a mesma chave em menos de 800 ms viram um passo só no desfazer */
const COALESCE_MS = 800;

const initial = newProject();

let state: State = {
  project: initial,
  screenId: initial.screens[0].id,
  selectedId: null,
  tool: "select",
  brush: { color: "#ffffff", width: 8 },
  zoom: "fit",
  playing: true,
  circleGuide: false,
  filePath: null,
  dirty: false,
  canUndo: false,
  canRedo: false,
};

const listeners = new Set<() => void>();
let past: Project[] = [];
let future: Project[] = [];
let lastKey: string | null = null;
let lastTime = 0;

function emit() {
  for (const l of listeners) l();
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    emit();
  },
  /** Altera o projeto registrando no histórico. `key` agrupa edições contínuas (arrastar, digitar). */
  update(fn: (p: Project) => Project, key?: string) {
    const next = fn(state.project);
    if (next === state.project) return;
    const now = performance.now();
    const merge = key != null && key === lastKey && now - lastTime < COALESCE_MS;
    if (!merge) {
      past.push(state.project);
      if (past.length > HISTORY) past.shift();
    }
    future = [];
    lastKey = key ?? null;
    lastTime = now;
    state = { ...state, project: next, dirty: true, canUndo: true, canRedo: false };
    emit();
  },
  /** Encerra o agrupamento atual: a próxima edição vira um novo passo. */
  breakCoalesce() {
    lastKey = null;
  },
  undo() {
    const prev = past.pop();
    if (!prev) return;
    future.push(state.project);
    lastKey = null;
    state = { ...state, project: prev, dirty: true, canUndo: past.length > 0, canRedo: true };
    fixSelection();
    emit();
  },
  redo() {
    const next = future.pop();
    if (!next) return;
    past.push(state.project);
    lastKey = null;
    state = { ...state, project: next, dirty: true, canUndo: true, canRedo: future.length > 0 };
    fixSelection();
    emit();
  },
  load(project: Project, filePath: string | null) {
    past = [];
    future = [];
    lastKey = null;
    state = {
      ...state,
      project,
      filePath,
      screenId: project.screens[0].id,
      selectedId: null,
      dirty: false,
      canUndo: false,
      canRedo: false,
      tool: "select",
    };
    emit();
  },
};

function fixSelection() {
  if (!state.project.screens.some((sc) => sc.id === state.screenId)) {
    state = { ...state, screenId: state.project.screens[0].id, selectedId: null };
  }
  if (state.selectedId && !curLayers().some((l) => l.id === state.selectedId)) {
    state = { ...state, selectedId: null };
  }
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(state));
}

// ---------- tela em edição ----------

export const curScreen = (s: State = state): Screen =>
  s.project.screens.find((sc) => sc.id === s.screenId) ?? s.project.screens[0];

export const curLayers = (s: State = state): Layer[] => curScreen(s).layers;

/** Altera as camadas da tela em edição. */
function updateLayers(fn: (layers: Layer[]) => Layer[], key?: string) {
  const id = curScreen().id;
  store.update((p) => {
    let changed = false;
    const screens = p.screens.map((sc) => {
      if (sc.id !== id) return sc;
      const layers = fn(sc.layers);
      if (layers === sc.layers) return sc;
      changed = true;
      return { ...sc, layers };
    });
    return changed ? { ...p, screens } : p;
  }, key);
}

// ---------- ações de camada ----------

export const getLayer = (id: string | null) => curLayers().find((l) => l.id === id) ?? null;

export function select(id: string | null) {
  if (state.selectedId === id) return;
  const l = getLayer(id);
  // pincel só faz sentido numa camada de desenho
  const tool = l?.kind === "drawing" ? state.tool : "select";
  store.set({ selectedId: id, tool });
}

export function updateLayer<L extends Layer = Layer>(
  id: string,
  patch: BasePatch | Partial<L> | ((l: L) => Partial<L>),
  key?: string,
) {
  updateLayers(
    (layers) =>
      layers.map((l) => {
        if (l.id !== id) return l;
        const ch = typeof patch === "function" ? patch(l as L) : patch;
        return { ...l, ...ch } as Layer;
      }),
    key,
  );
}

export function updateProject(patch: Partial<Project>, key?: string) {
  store.update((p) => ({ ...p, ...patch }), key);
}

/** Insere acima da camada selecionada (ou no topo). */
export function addLayer(layer: Layer) {
  updateLayers((ls) => {
    const layers = [...ls];
    const sel = layers.findIndex((l) => l.id === state.selectedId);
    layers.splice(sel >= 0 ? sel + 1 : layers.length, 0, layer);
    return layers;
  });
  store.set({ selectedId: layer.id, tool: layer.kind === "drawing" ? "brush" : "select" });
}

export function removeLayer(id: string) {
  const l = getLayer(id);
  if (!l || l.kind === "background") return;
  updateLayers((ls) => ls.filter((x) => x.id !== id));
  store.set({ selectedId: null, tool: "select" });
}

export function duplicateLayer(id: string) {
  const l = getLayer(id);
  if (!l || l.kind === "background") return;
  const copy = { ...structuredClone(l), id: uid(), name: `${l.name} (cópia)`, x: l.x + 16, y: l.y + 16 } as Layer;
  updateLayers((ls) => {
    const layers = [...ls];
    layers.splice(layers.findIndex((x) => x.id === id) + 1, 0, copy);
    return layers;
  });
  store.set({ selectedId: copy.id });
}

/** Move para o índice `to` do array (de baixo para cima). O fundo fica sempre no 0. */
export function moveLayer(id: string, to: number) {
  updateLayers((ls) => {
    const from = ls.findIndex((l) => l.id === id);
    if (from <= 0) return ls;
    const target = Math.max(1, Math.min(ls.length - 1, to));
    if (target === from) return ls;
    const layers = [...ls];
    const [l] = layers.splice(from, 1);
    layers.splice(target, 0, l);
    return layers;
  });
}

export function nudge(dx: number, dy: number) {
  const l = getLayer(state.selectedId);
  if (!l || l.locked || l.kind === "background") return;
  updateLayer(l.id, { x: l.x + dx, y: l.y + dy }, `nudge:${l.id}`);
}

// ---------- ações de tela ----------

export function selectScreen(id: string) {
  if (id === state.screenId) return;
  store.set({ screenId: id, selectedId: null, tool: "select" });
}

export function updateScreen(id: string, patch: Partial<Screen> | ((s: Screen) => Partial<Screen>), key?: string) {
  store.update(
    (p) => ({
      ...p,
      screens: p.screens.map((sc) => (sc.id === id ? { ...sc, ...(typeof patch === "function" ? patch(sc) : patch) } : sc)),
    }),
    key,
  );
}

/** Nova tela logo depois da atual (prioridade acima das seguintes). */
export function addScreen(sc: Screen) {
  store.update((p) => {
    const screens = [...p.screens];
    const at = screens.findIndex((x) => x.id === state.screenId);
    screens.splice(Math.max(1, at + 1), 0, sc);
    return { ...p, screens };
  });
  store.set({ screenId: sc.id, selectedId: null, tool: "select" });
}

/** Exclui uma tela (sobra pelo menos uma). Excluindo a principal, a seguinte vira a principal
 *  e perde as condições (a principal é a que aparece quando nenhuma outra vale). */
export function removeScreen(id: string) {
  const i = state.project.screens.findIndex((x) => x.id === id);
  if (i < 0 || state.project.screens.length <= 1) return;
  store.update((p) => {
    const screens = p.screens.filter((x) => x.id !== id);
    if (i === 0) screens[0] = { ...screens[0], rules: [] };
    return { ...p, screens };
  });
  const screens = state.project.screens;
  store.set({ screenId: screens[Math.min(Math.max(0, i - 1), screens.length - 1)].id, selectedId: null, tool: "select" });
}

/** Muda a prioridade (a principal fica sempre em 0). */
export function moveScreen(id: string, dir: -1 | 1) {
  store.update((p) => {
    const i = p.screens.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i <= 0 || j <= 0 || j >= p.screens.length) return p;
    const screens = [...p.screens];
    [screens[i], screens[j]] = [screens[j], screens[i]];
    return { ...p, screens };
  });
}
