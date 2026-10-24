//! Controle dos processos de fundo (player e ícone da bandeja), usado pelo editor e pela
//! bandeja: localizar os binários, iniciar/parar e ligar o início com a sessão (systemd --user).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::paths;

pub const PLAYER: &str = "dv360s-player";
pub const TRAY: &str = "dv360s-tray";
pub const EDITOR: &str = "dv360s-studio";

/// Procura um binário ao lado do executável atual, em ~/.local/bin e no PATH.
pub fn find_bin(name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        candidates.push(dir.join(name));
    }
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin").join(name));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join(name)));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn service(name: &str) -> String {
    format!("{name}.service")
}

fn unit_path(name: &str) -> PathBuf {
    paths::config_dir().parent().unwrap_or(Path::new(".")).join("systemd/user").join(service(name))
}

fn systemctl(args: &[&str]) -> Result<String, String> {
    let out = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|e| format!("systemctl: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() {
        Ok(text)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn autostart_enabled(name: &str) -> bool {
    unit_path(name).is_file() && systemctl(&["is-enabled", &service(name)]).is_ok()
}

/// Inicia um binário desacoplado (grupo de processos próprio: sobrevive ao fechar quem o abriu).
pub fn spawn_detached(bin: &Path, args: &[&str], log: Option<&Path>) -> Result<(), String> {
    let mut cmd = Command::new(bin);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::null());
    match log {
        Some(p) => {
            if let Some(dir) = p.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            cmd.stderr(std::fs::File::create(p).map_err(|e| e.to_string())?);
        }
        None => {
            cmd.stderr(Stdio::null());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| format!("não foi possível iniciar {}: {e}", bin.display()))?;
    // recolhe o processo quando ele terminar (senão fica "defunct" enquanto quem abriu viver,
    // como a bandeja, que roda o tempo todo)
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn kill_manual_player() {
    if let Some(pid) = paths::running_player_pid() {
        let _ = Command::new("kill").arg(pid.to_string()).status();
        for _ in 0..30 {
            if !paths::pid_is_player(pid) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
}

pub fn player_running() -> bool {
    paths::running_player_pid().is_some()
}

pub fn start_player() -> Result<(), String> {
    if player_running() {
        return Ok(());
    }
    if autostart_enabled(PLAYER) {
        return systemctl(&["start", &service(PLAYER)]).map(|_| ());
    }
    let bin = find_bin(PLAYER).ok_or("dv360s-player não encontrado (rode scripts/install.sh ou cargo build)")?;
    spawn_detached(&bin, &[], Some(&paths::config_dir().join("player.log")))
}

pub fn stop_player() {
    if autostart_enabled(PLAYER) {
        let _ = systemctl(&["stop", &service(PLAYER)]);
    }
    kill_manual_player();
}

/// Liga/desliga o serviço de usuário do systemd que inicia `name` com a sessão.
/// A bandeja depende da sessão gráfica; o player só precisa do usuário logado.
pub fn set_autostart(name: &str, enabled: bool) -> Result<(), String> {
    let svc = service(name);
    if !enabled {
        let _ = systemctl(&["disable", "--now", &svc]);
        let _ = std::fs::remove_file(unit_path(name));
        let _ = systemctl(&["daemon-reload"]);
        return Ok(());
    }
    let bin = find_bin(name).ok_or_else(|| format!("{name} não encontrado"))?;
    let unit = if name == TRAY {
        format!(
            "[Unit]\nDescription=DV360S Studio - ícone na bandeja\nPartOf=graphical-session.target\nAfter=graphical-session.target\n\n\
             [Service]\nExecStart=\"{}\"\nRestart=on-failure\nRestartSec=5\n\n\
             [Install]\nWantedBy=graphical-session.target\n",
            bin.display()
        )
    } else {
        format!(
            "[Unit]\nDescription=DV360S Studio - tela do water cooler\nAfter=default.target\n\n\
             [Service]\nExecStart=\"{}\"\nRestart=on-failure\nRestartSec=3\n\n\
             [Install]\nWantedBy=default.target\n",
            bin.display()
        )
    };
    paths::write_atomic(&unit_path(name), unit.as_bytes()).map_err(|e| e.to_string())?;
    if name == PLAYER {
        kill_manual_player();
    } else {
        kill_by_name(name);
    }
    systemctl(&["daemon-reload"])?;
    systemctl(&["enable", "--now", &svc]).map(|_| ())
}

/// pids de processos com esse nome (lê /proc/*/comm).
pub fn pids_named(name: &str) -> Vec<u32> {
    let me = std::process::id();
    std::fs::read_dir("/proc")
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
                .filter(|&pid| pid != me)
                .filter(|pid| std::fs::read_to_string(format!("/proc/{pid}/comm")).is_ok_and(|c| c.trim() == name))
                .collect()
        })
        .unwrap_or_default()
}

fn kill_by_name(name: &str) {
    for pid in pids_named(name) {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

pub fn tray_running() -> bool {
    !pids_named(TRAY).is_empty()
}

pub fn start_tray() -> Result<(), String> {
    if tray_running() {
        return Ok(());
    }
    if autostart_enabled(TRAY) {
        return systemctl(&["start", &service(TRAY)]).map(|_| ());
    }
    let bin = find_bin(TRAY).ok_or("dv360s-tray não encontrado (rode scripts/install.sh)")?;
    spawn_detached(&bin, &[], None)
}

pub fn stop_tray() {
    if autostart_enabled(TRAY) {
        let _ = systemctl(&["stop", &service(TRAY)]);
    }
    kill_by_name(TRAY);
}
