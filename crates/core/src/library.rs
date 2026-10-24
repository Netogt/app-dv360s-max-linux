//! Biblioteca de temas: os `.dvtheme` completos em `~/.config/dv360s-studio/temas/`.
//! O editor salva ali por padrão; o editor e a bandeja listam e aplicam a partir dela.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::{pack, paths, service};

/// Miniatura gravada pelo editor dentro do `.dvtheme`.
pub const THUMB: &str = "thumb.jpg";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibTheme {
    pub path: String,
    pub name: String,
    /// milissegundos desde 1970 (para ordenar e mostrar "editado há…")
    pub modified: u64,
    pub size: u64,
    pub screens: usize,
    pub has_thumb: bool,
    pub active: bool,
}

pub fn active_path() -> Option<PathBuf> {
    let p = std::fs::read_to_string(paths::active_source()).ok()?;
    let p = PathBuf::from(p.trim());
    p.is_file().then_some(p)
}

fn summary(path: &Path, active: Option<&Path>) -> Option<LibTheme> {
    let meta = std::fs::metadata(path).ok()?;
    let entries = pack::read_entries(path, |n| n == "manifest.json" || n == THUMB).ok()?;
    let manifest = entries.iter().find(|(n, _)| n == "manifest.json");
    let json: serde_json::Value = manifest.and_then(|(_, d)| serde_json::from_slice(d).ok()).unwrap_or_default();
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let name = json.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or(stem);
    let screens = json.get("screens").and_then(|v| v.as_array()).map_or(1, |a| a.len().max(1));
    Some(LibTheme {
        path: path.to_string_lossy().into_owned(),
        name,
        modified: meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64),
        size: meta.len(),
        screens,
        has_thumb: entries.iter().any(|(n, _)| n == THUMB),
        active: active == Some(path),
    })
}

/// Temas da biblioteca, do mais recente para o mais antigo.
pub fn list() -> Vec<LibTheme> {
    let active = active_path();
    let mut out: Vec<LibTheme> = std::fs::read_dir(paths::library_dir())
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "dvtheme"))
                .filter_map(|p| summary(&p, active.as_deref()))
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

pub fn thumb(path: &Path) -> Option<Vec<u8>> {
    pack::read_entries(path, |n| n == THUMB).ok()?.pop().map(|(_, d)| d)
}

/// O arquivo está dentro da biblioteca? (para só apagar o que é dela)
pub fn contains(path: &Path) -> bool {
    let (Ok(dir), Ok(p)) = (paths::library_dir().canonicalize(), path.canonicalize()) else {
        return false;
    };
    p.starts_with(dir)
}

/// Lembra qual tema da biblioteca está na tela (None = algo aplicado de fora dela).
pub fn set_active_source(path: Option<&Path>) {
    match path {
        Some(p) => {
            let _ = paths::write_atomic(&paths::active_source(), p.to_string_lossy().as_bytes());
        }
        None => {
            let _ = std::fs::remove_file(paths::active_source());
        }
    }
}

/// Copia só a parte de exibição (manifest + render/) para o tema ativo e garante o player.
pub fn apply(path: &Path) -> Result<(), String> {
    let mut entries = pack::read_entries(path, |n| n == "manifest.json" || n.starts_with("render/"))?;
    if !entries.iter().any(|(n, _)| n == "manifest.json") {
        return Err("este tema ainda não foi renderizado; abra no editor e salve de novo".into());
    }
    // o manifest primeiro, como o editor grava
    entries.sort_by_key(|(n, _)| n != "manifest.json");
    paths::write_atomic(&paths::active_theme(), &pack::write_stored(&entries)).map_err(|e| e.to_string())?;
    set_active_source(Some(path));
    service::start_player()
}

pub fn remove(path: &Path) -> Result<(), String> {
    if !contains(path) {
        return Err("só é possível excluir temas da biblioteca".into());
    }
    if active_path().as_deref() == Some(path) {
        set_active_source(None);
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}
