//! Arquivos compartilhados entre o editor e o player, em `~/.config/dv360s-studio/`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));
    base.join("dv360s-studio")
}

/// Tema que o player está exibindo (só a parte renderizada).
pub fn active_theme() -> PathBuf {
    config_dir().join("active.dvtheme")
}

pub fn player_config() -> PathBuf {
    config_dir().join("player.json")
}

pub fn player_status() -> PathBuf {
    config_dir().join("status.json")
}

pub fn player_pid() -> PathBuf {
    config_dir().join("player.pid")
}

pub fn draft() -> PathBuf {
    config_dir().join("rascunho.dvtheme")
}

/// Pasta da biblioteca de temas (os `.dvtheme` completos que o usuário salvou).
pub fn library_dir() -> PathBuf {
    config_dir().join("temas")
}

/// Caminho, na biblioteca, do tema que está ativo (para marcá-lo na lista e na bandeja).
pub fn active_source() -> PathBuf {
    config_dir().join("active-source")
}

/// Socket por onde o editor manda a prévia ao vivo para o player.
pub fn live_socket() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .map(|d| d.join("dv360s-live.sock"))
        .unwrap_or_else(|| config_dir().join("live.sock"))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct PlayerConfig {
    pub brightness: u8,
    /// Rotação final da imagem enviada (0, 90, 180, 270).
    pub rotation: u16,
}

impl Default for PlayerConfig {
    fn default() -> Self {
        PlayerConfig { brightness: 100, rotation: 0 }
    }
}

impl PlayerConfig {
    pub fn load() -> Self {
        std::fs::read(player_config())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct PlayerStatus {
    pub pid: u32,
    /// playing | waiting_device | no_permission | no_theme | error | stopped
    pub state: String,
    pub message: String,
    pub theme: String,
    /// tela (das condições) que está sendo exibida
    pub screen: String,
}

/// Grava de forma atômica (arquivo temporário + rename), para o outro lado nunca ler pela metade.
pub fn write_atomic(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(tmp, path)
}

/// O processo com esse pid ainda é o player?
pub fn pid_is_player(pid: u32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .map(|c| c.trim() == "dv360s-player")
        .unwrap_or(false)
}

pub fn running_player_pid() -> Option<u32> {
    let pid: u32 = std::fs::read_to_string(player_pid()).ok()?.trim().parse().ok()?;
    pid_is_player(pid).then_some(pid)
}
