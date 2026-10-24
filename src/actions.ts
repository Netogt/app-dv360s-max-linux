// Ações de arquivo e de tela usadas pela barra superior, atalhos e arrastar-e-soltar.

import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { background as makeBackground, mediaLayer, newProject } from "./defaults";
import { api, packTheme, unpackTheme } from "./io";
import type { Example } from "./examples";
import { clearAssets, detectType, dropAsset, ensureVideoFrame, getAsset, mediaTime, registerAsset } from "./render/assets";
import { compileTheme } from "./render/compile";
import { drawScene } from "./render/draw";
import { addLayer, curLayers, store, updateLayer } from "./store";
import type { AssetMeta, BackgroundLayer, Project } from "./types";
import { SIZE } from "./types";
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
    let a;
    if (type === "video") {
      // o ffmpeg pode levar um tempo: mostra o progresso e deixa cancelar
      const ac = new AbortController();
      const label = `Preparando “${file.name}”`;
      const cancel = () => ac.abort();
      setBusy({ label, done: 0, total: 0, cancel });
      a = registerAsset(meta, new Uint8Array(await file.arrayBuffer()), {
        signal: ac.signal,
        onProgress: (done, total) => setBusy({ label: `${label} · quadro ${done} de ${total || "?"}`, done, total, cancel }),
      });
      await a.ready;
      setBusy(null);
      if (ac.signal.aborted) {
        dropAsset(id);
        toast("Importação cancelada");
        continue;
      }
    } else {
      a = registerAsset(meta, new Uint8Array(await file.arrayBuffer()));
      await a.ready;
    }
    if (a.error) {
      dropAsset(id);
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

/** Um arrastar traz arquivos do sistema? No WebKitGTK, o que vem do gerenciador de arquivos
 *  muitas vezes chega só como endereço (text/uri-list), sem o tipo "Files". */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types);
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("application/x-moz-file");
}

/** Arquivos soltos: os File do navegador ou, se vierem só os endereços file://, lidos do disco. */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const files = Array.from(dt.files);
  if (files.length) return files;
  const uris = (dt.getData("text/uri-list") || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("file://"));
  const out: File[] = [];
  for (const u of uris) {
    const path = decodeURIComponent(new URL(u).pathname);
    try {
      const bytes = await api.readFile(path);
      out.push(new File([bytes as BlobPart], path.split("/").pop() || "arquivo"));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }
  return out;
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

/** Começa um tema novo a partir de um exemplo. */
export async function newFromExample(ex: Example): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  clearAssets();
  store.load(ex.make(), null);
  return true;
}

let libDir: Promise<string | null> | null = null;
/** Pasta da biblioteca (~/.config/dv360s-studio/temas). */
export const libraryDir = () => (libDir ??= api.libraryDir().catch(() => null));

const slug = (name: string) =>
  (name || "tema")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "tema";

/** Abre um .dvtheme pelo caminho. */
export async function openPath(path: string, confirm = true): Promise<boolean> {
  if (confirm && !(await confirmDiscard())) return false;
  try {
    setBusy({ label: "Abrindo tema", done: 0, total: 0 });
    const bytes = await api.readFile(path);
    clearAssets();
    const p = unpackTheme(bytes);
    store.load(p, path);
    // vídeos são preparados de novo pelo ffmpeg: espera para o palco já abrir completo
    const videos = Object.values(p.assets).filter((m) => m.type === "video");
    for (const [i, m] of videos.entries()) {
      setBusy({ label: `Preparando vídeo ${i + 1} de ${videos.length}`, done: i, total: videos.length });
      await getAsset(m.id)?.ready;
    }
    toast("Tema aberto", "success");
    return true;
  } catch (e) {
    toast(errMsg(e), "error");
    return false;
  } finally {
    setBusy(null);
  }
}

export async function openDocument() {
  if (!(await confirmDiscard())) return;
  const dir = await libraryDir();
  const path = await open({ multiple: false, directory: false, filters: FILTER, defaultPath: dir ?? undefined });
  if (typeof path !== "string") return;
  await openPath(path, false);
}

/** Compila mostrando o progresso; devolve null se o usuário cancelar. */
async function compileWithProgress(label: string) {
  const ac = new AbortController();
  const wasPlaying = store.get().playing;
  store.set({ playing: false });
  setBusy({ label, done: 0, total: 0, cancel: () => ac.abort() });
  try {
    const t0 = performance.now();
    const out = await compileTheme(
      store.get().project,
      (pr) => setBusy({ label: pr.label, done: pr.done, total: pr.total, cancel: () => ac.abort() }),
      ac.signal,
    );
    if (out.frames >= 10) saveRenderSpeed((performance.now() - t0) / out.frames, out.bytes / out.frames);
    return out;
  } catch (e) {
    if ((e as Error).name === "AbortError") toast("Renderização cancelada");
    else toast(`Falha ao renderizar: ${errMsg(e)}`, "error");
    return null;
  } finally {
    setBusy(null);
    store.set({ playing: wasPlaying });
  }
}

// ---------- estimativa de tempo de renderização ----------

const SPEED_KEY = "dv.renderSpeed";

function saveRenderSpeed(msPerFrame: number, bytesPerFrame: number) {
  try {
    localStorage.setItem(SPEED_KEY, JSON.stringify({ msPerFrame, bytesPerFrame }));
  } catch {
    // só conveniência
  }
}

/** Medida da última renderização (ms e bytes por quadro), se houver. */
export function renderSpeed(): { msPerFrame: number; bytesPerFrame: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(SPEED_KEY) ?? "null");
    return v && v.msPerFrame > 0 ? v : null;
  } catch {
    return null;
  }
}

// ---------- miniatura ----------

const THUMB = 240;

/** Miniatura da tela principal no instante 0 (vai dentro do .dvtheme, para a biblioteca). */
export async function makeThumb(p: Project = store.get().project): Promise<Uint8Array | undefined> {
  const layers = p.screens[0].layers;
  for (const l of layers) {
    if ((l.kind === "media" || l.kind === "background") && l.asset) {
      const a = getAsset(l.asset);
      if (!a) continue;
      await a.ready;
      if (a.meta.type === "video") await ensureVideoFrame(a, mediaTime(a, l, 0));
    }
  }
  const c = document.createElement("canvas");
  c.width = THUMB;
  c.height = THUMB;
  const ctx = c.getContext("2d")!;
  ctx.scale(THUMB / SIZE, THUMB / SIZE);
  ctx.imageSmoothingQuality = "high";
  drawScene(ctx, layers, { t: 0, now: new Date(), mode: "bake" });
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
}

/** Salva o .dvtheme completo (projeto editável + parte renderizada, pronta para o player).
 *  Sem caminho, o padrão é a biblioteca, que aparece na lista de temas e na bandeja. */
export async function saveDocument(saveAs = false) {
  const st = store.get();
  let path = st.filePath;
  if (!path || saveAs) {
    const dir = await libraryDir();
    const name = `${slug(st.project.name)}.dvtheme`;
    const chosen = await save({ filters: FILTER, defaultPath: dir ? `${dir}/${name}` : name });
    if (!chosen) return;
    path = chosen.endsWith(".dvtheme") ? chosen : `${chosen}.dvtheme`;
  }
  await writeDocument(path);
}

async function writeDocument(path: string): Promise<boolean> {
  const out = await compileWithProgress("Salvando tema");
  if (!out) return false;
  try {
    const bytes = packTheme(store.get().project, out.files, await makeThumb());
    await api.writeFile(path, bytes);
    store.set({ filePath: path, dirty: false });
    toast(`Salvo (${formatBytes(bytes.length)})`, "success");
    return true;
  } catch (e) {
    toast(errMsg(e), "error");
    return false;
  }
}

/** Salva direto na biblioteca, sem perguntar onde (um arquivo novo se o nome já existir). */
export async function saveToLibrary(existing: string[]): Promise<boolean> {
  const dir = await libraryDir();
  if (!dir) {
    toast("Biblioteca indisponível", "error");
    return false;
  }
  const cur = store.get().filePath;
  if (cur?.startsWith(`${dir}/`)) return writeDocument(cur);
  const base = slug(store.get().project.name);
  let path = `${dir}/${base}.dvtheme`;
  for (let i = 2; existing.includes(path); i++) path = `${dir}/${base}-${i}.dvtheme`;
  return writeDocument(path);
}

/** Renderiza e manda para o player (que fica rodando mesmo com o editor fechado). */
export async function applyToScreen() {
  const out = await compileWithProgress("Preparando tema para a tela");
  if (!out) return;
  try {
    const bytes = packTheme(null, out.files);
    // se o tema veio da biblioteca e não mudou, ele fica marcado como o que está na tela
    const st = store.get();
    await api.applyTheme(bytes, st.dirty ? null : st.filePath);
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
