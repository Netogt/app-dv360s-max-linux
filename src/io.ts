// Arquivo .dvtheme (ZIP sem compressão):
//   manifest.json + render/...   o que o player toca (gerado por compileTheme)
//   project.json + assets/...    o projeto editável (camadas + mídias originais)
// O tema aplicado na tela leva só a primeira parte, para o player usar pouca memória.

import { invoke } from "@tauri-apps/api/core";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { migrateProject } from "./defaults";
import { allAssets, registerAsset } from "./render/assets";
import type { Readings } from "./render/text";
import type { AssetMeta, Layer, Project } from "./types";

export interface PlayerConfig {
  brightness: number;
  rotation: number;
}

export interface PlayerStatus {
  running: boolean;
  pid: number;
  state: "playing" | "waiting_device" | "no_permission" | "no_theme" | "error" | "stopped" | "";
  message: string;
  theme: string;
  devicePresent: boolean;
  udevRule: boolean;
  autostart: boolean;
  playerFound: boolean;
  config: PlayerConfig;
}

const raw = (path?: string) => (path ? { headers: { "x-path": encodeURIComponent(path) } } : undefined);

export const api = {
  readFile: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("read_file", { path })),
  writeFile: (path: string, data: Uint8Array) => invoke<void>("write_file", data, raw(path)),
  saveDraft: (data: Uint8Array) => invoke<void>("save_draft", data),
  loadDraft: async () => new Uint8Array(await invoke<ArrayBuffer>("load_draft")),
  applyTheme: (data: Uint8Array) => invoke<void>("apply_theme", data),
  startPlayer: () => invoke<void>("start_player"),
  stopPlayer: () => invoke<void>("stop_player"),
  status: () => invoke<PlayerStatus>("player_status"),
  setConfig: (config: PlayerConfig) => invoke<void>("set_player_config", { config }),
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),
  installUdev: () => invoke<void>("install_udev_rule"),
  listFonts: () => invoke<string[]>("list_fonts"),
  readSensors: () => invoke<Readings>("read_sensors"),
  /** quadros JPEG do vídeo (decodificado pelo ffmpeg) */
  extractVideo: async (data: Uint8Array, ext: string, fps: number, maxSeconds: number) =>
    new Uint8Array(
      await invoke<ArrayBuffer>("extract_video", data, {
        headers: { "x-ext": ext, "x-fps": String(fps), "x-max": String(maxSeconds) },
      }),
    ),
};

const assetRefs = (layers: Layer[]) =>
  new Set(layers.flatMap((l) => (l.kind === "media" || l.kind === "background") && l.asset ? [l.asset] : []));

/** Remove do projeto as mídias que nenhuma camada usa mais. */
export function pruneAssets(p: Project): Project {
  const refs = assetRefs(p.screens.flatMap((sc) => sc.layers));
  const assets: Record<string, AssetMeta> = {};
  for (const [id, m] of Object.entries(p.assets)) if (refs.has(id)) assets[id] = m;
  return { ...p, assets };
}

export function packTheme(p: Project | null, render?: Record<string, Uint8Array>): Uint8Array {
  const files: Zippable = {};
  if (p) {
    const pruned = pruneAssets(p);
    files["project.json"] = strToU8(JSON.stringify(pruned));
    for (const m of Object.values(pruned.assets)) {
      const a = allAssets().get(m.id);
      if (a) files[`assets/${m.file}`] = a.bytes;
    }
  }
  if (render) Object.assign(files, render);
  return zipSync(files, { level: 0 });
}

/** Lê um .dvtheme e registra as mídias. */
export function unpackTheme(bytes: Uint8Array): Project {
  const files = unzipSync(bytes);
  const pj = files["project.json"];
  if (!pj) throw new Error("Este arquivo só tem a parte de exibição do tema e não pode ser editado.");
  const p = migrateProject(JSON.parse(strFromU8(pj)));
  if (p.version !== 2 || !Array.isArray(p.screens) || p.screens.some((sc) => sc.layers[0]?.kind !== "background")) {
    throw new Error("Projeto inválido ou de uma versão mais nova.");
  }
  for (const m of Object.values(p.assets)) {
    const data = files[`assets/${m.file}`];
    if (data) registerAsset(m, data);
  }
  return p;
}
