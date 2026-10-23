// Ações de arquivo e de tela usadas pela barra superior, atalhos e arrastar-e-soltar.

import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { background as makeBackground, mediaLayer, newProject } from "./defaults";
import { api, packTheme, unpackTheme } from "./io";
import { clearAssets, detectType, registerAsset } from "./render/assets";
import { compileTheme } from "./render/compile";
import { addLayer, curLayers, store, updateLayer } from "./store";
import type { AssetMeta, BackgroundLayer } from "./types";
import { setBusy, toast } from "./ui/feedback";
import { extOf, formatBytes, uid } from "./util";

const FILTER = [{ name: "Tema DV360S", extensions: ["dvtheme"] }];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function importFiles(files: File[], asBackground = false) {
  for (const file of files) {
    const type = detectType(file.type, file.name);
    if (!type) {
      toast(`"${file.name}" não é imagem, GIF nem vídeo.`, "error");
      continue;
    }
    if (file.size > 200 * 1024 * 1024) toast(`"${file.name}" tem ${formatBytes(file.size)}; a renderização pode demorar.`);
    const id = uid();
    const meta: AssetMeta = {
      id,
      name: file.name,
      mime: file.type || (type === "gif" ? "image/gif" : type === "video" ? "video/mp4" : "image/png"),
      type,
      file: `${id}.${extOf(file.name)}`,
    };
    const a = registerAsset(meta, new Uint8Array(await file.arrayBuffer()));
    await a.ready;
    if (a.error) {
      toast(`${file.name}: ${a.error}`, "error");
      continue;
    }
    const name = file.name.replace(/\.[^.]+$/, "");
    if (asBackground) {
      store.update((p) => ({ ...p, assets: { ...p.assets, [id]: meta } }));
      const bg = curLayers()[0];
      updateLayer<BackgroundLayer>(bg.id, { asset: id, trimStart: 0, trimEnd: 0 });
      store.set({ selectedId: bg.id });
    } else {
      store.update((p) => ({ ...p, assets: { ...p.assets, [id]: meta } }));
      store.breakCoalesce();
      addLayer(mediaLayer(id, name, a.width, a.height));
    }
  }
}

/** Abre o seletor de arquivos do sistema (via <input>, que já devolve File). */
export function pickMedia(accept: string, asBackground = false) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = !asBackground;
  input.onchange = () => {
    if (input.files?.length) importFiles(Array.from(input.files), asBackground);
  };
  input.click();
}

export const ACCEPT_IMAGE = "image/*,.gif";
export const ACCEPT_VIDEO = "video/*,.mp4,.webm,.mkv,.mov";
export const ACCEPT_ANY = `${ACCEPT_IMAGE},${ACCEPT_VIDEO}`;

async function confirmDiscard(): Promise<boolean> {
  if (!store.get().dirty) return true;
  return ask("Há alterações não salvas neste tema. Deseja descartá-las?", {
    title: "DV360S Studio",
    kind: "warning",
    okLabel: "Descartar",
    cancelLabel: "Cancelar",
  });
}

export async function newDocument() {
  if (!(await confirmDiscard())) return;
  clearAssets();
  const p = newProject();
  p.screens[0].layers = [makeBackground()];
  store.load(p, null);
}

export async function openDocument() {
  if (!(await confirmDiscard())) return;
  const path = await open({ multiple: false, directory: false, filters: FILTER });
  if (typeof path !== "string") return;
  try {
    setBusy({ label: "Abrindo tema", done: 0, total: 0 });
    const bytes = await api.readFile(path);
    clearAssets();
    store.load(unpackTheme(bytes), path);
    toast("Tema aberto", "success");
  } catch (e) {
    toast(errMsg(e), "error");
  } finally {
    setBusy(null);
  }
}

/** Compila mostrando o progresso; devolve null se o usuário cancelar. */
async function compileWithProgress(label: string) {
  const ac = new AbortController();
  const wasPlaying = store.get().playing;
  store.set({ playing: false });
  setBusy({ label, done: 0, total: 0, cancel: () => ac.abort() });
  try {
    return await compileTheme(
      store.get().project,
      (pr) => setBusy({ label: pr.label, done: pr.done, total: pr.total, cancel: () => ac.abort() }),
      ac.signal,
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") toast("Renderização cancelada");
    else toast(`Falha ao renderizar: ${errMsg(e)}`, "error");
    return null;
  } finally {
    setBusy(null);
    store.set({ playing: wasPlaying });
  }
}

/** Salva o .dvtheme completo (projeto editável + parte renderizada, pronta para o player). */
export async function saveDocument(saveAs = false) {
  const st = store.get();
  let path = st.filePath;
  if (!path || saveAs) {
    const chosen = await save({ filters: FILTER, defaultPath: `${st.project.name || "tema"}.dvtheme` });
    if (!chosen) return;
    path = chosen.endsWith(".dvtheme") ? chosen : `${chosen}.dvtheme`;
  }
  const out = await compileWithProgress("Salvando tema");
  if (!out) return;
  try {
    const bytes = packTheme(store.get().project, out.files);
    await api.writeFile(path, bytes);
    store.set({ filePath: path, dirty: false });
    toast(`Salvo (${formatBytes(bytes.length)})`, "success");
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

/** Renderiza e manda para o player (que fica rodando mesmo com o editor fechado). */
export async function applyToScreen() {
  const out = await compileWithProgress("Preparando tema para a tela");
  if (!out) return;
  try {
    const bytes = packTheme(null, out.files);
    await api.applyTheme(bytes);
    const anim = out.frames > 1 ? ` · ${out.frames} quadros` : "";
    toast(`Enviado para a tela (${formatBytes(bytes.length)}${anim})`, "success");
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

export async function saveDraft() {
  try {
    await api.saveDraft(packTheme(store.get().project));
  } catch {
    // rascunho é só conveniência
  }
}

export async function loadDraft(): Promise<boolean> {
  try {
    const bytes = await api.loadDraft();
    if (bytes.length === 0) return false;
    const p = unpackTheme(bytes);
    store.load(p, null);
    return true;
  } catch {
    return false;
  }
}

export function setBackgroundMedia(id: string | null) {
  updateLayer<BackgroundLayer>(curLayers()[0].id, { asset: id });
}
