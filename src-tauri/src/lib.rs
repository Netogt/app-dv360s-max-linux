//! Comandos do editor. O editor nunca abre o USB: quem fala com o cooler é sempre o
//! `dv360s-player`, e o editor só grava o tema/configuração e controla o processo.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use dv360s_core::paths::{self, PlayerConfig, PlayerStatus};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

const SERVICE: &str = "dv360s-player.service";
const UDEV_RULE: &str = "/etc/udev/rules.d/99-dv360s.rules";

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Corpo binário + caminho no cabeçalho `x-path` (codificado com encodeURIComponent).
fn raw_request<'a>(req: &'a Request<'_>) -> Result<(&'a [u8], Option<String>), String> {
    let InvokeBody::Raw(data) = req.body() else {
        return Err("corpo da requisição precisa ser binário".into());
    };
    let path = req.headers().get("x-path").and_then(|v| v.to_str().ok()).map(percent_decode);
    Ok((data.as_slice(), path))
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| format!("não foi possível ler {path}: {e}"))
}

#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let (data, path) = raw_request(&request)?;
    let path = path.ok_or("caminho ausente")?;
    paths::write_atomic(Path::new(&path), data).map_err(|e| format!("não foi possível gravar {path}: {e}"))
}

#[tauri::command]
fn save_draft(request: Request<'_>) -> Result<(), String> {
    let (data, _) = raw_request(&request)?;
    paths::write_atomic(&paths::draft(), data).map_err(|e| e.to_string())
}

/// Rascunho salvo automaticamente (vazio se não houver).
#[tauri::command]
fn load_draft() -> Response {
    Response::new(std::fs::read(paths::draft()).unwrap_or_default())
}

/// Grava o tema ativo (o player recarrega sozinho) e garante que o player está rodando.
#[tauri::command]
fn apply_theme(request: Request<'_>) -> Result<(), String> {
    let (data, _) = raw_request(&request)?;
    paths::write_atomic(&paths::active_theme(), data).map_err(|e| e.to_string())?;
    start_player()
}

fn player_bin() -> Option<PathBuf> {
    let name = "dv360s-player";
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

fn unit_path() -> PathBuf {
    paths::config_dir().parent().unwrap_or(Path::new(".")).join("systemd/user").join(SERVICE)
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

fn autostart_enabled() -> bool {
    unit_path().is_file() && systemctl(&["is-enabled", SERVICE]).is_ok()
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

#[tauri::command]
fn start_player() -> Result<(), String> {
    if paths::running_player_pid().is_some() {
        return Ok(());
    }
    if autostart_enabled() {
        return systemctl(&["start", SERVICE]).map(|_| ());
    }
    let bin = player_bin().ok_or("dv360s-player não encontrado (rode scripts/install.sh ou cargo build)")?;
    std::fs::create_dir_all(paths::config_dir()).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(paths::config_dir().join("player.log")).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(bin);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(log);
    #[cfg(unix)]
    {
        // grupo próprio: o player continua vivo quando o editor é fechado
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("não foi possível iniciar o player: {e}"))
}

#[tauri::command]
fn stop_player() -> Result<(), String> {
    if autostart_enabled() {
        let _ = systemctl(&["stop", SERVICE]);
    }
    kill_manual_player();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusOut {
    running: bool,
    #[serde(flatten)]
    status: PlayerStatus,
    device_present: bool,
    udev_rule: bool,
    autostart: bool,
    player_found: bool,
    config: PlayerConfig,
}

#[tauri::command]
async fn player_status() -> StatusOut {
    let running = paths::running_player_pid().is_some();
    let mut status: PlayerStatus = std::fs::read(paths::player_status())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    if !running {
        status = PlayerStatus { state: "stopped".into(), ..Default::default() };
    }
    StatusOut {
        running,
        status,
        device_present: dv360s_core::device::present(),
        udev_rule: Path::new(UDEV_RULE).is_file() || Path::new("/usr/lib/udev/rules.d/99-dv360s.rules").is_file(),
        autostart: autostart_enabled(),
        player_found: player_bin().is_some(),
        config: PlayerConfig::load(),
    }
}

#[tauri::command]
fn set_player_config(config: PlayerConfig) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    paths::write_atomic(&paths::player_config(), &data).map_err(|e| e.to_string())
}

/// Liga/desliga o serviço de usuário do systemd que inicia o player com a sessão.
#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    if !enabled {
        let _ = systemctl(&["disable", "--now", SERVICE]);
        let _ = std::fs::remove_file(unit_path());
        let _ = systemctl(&["daemon-reload"]);
        return Ok(());
    }
    let bin = player_bin().ok_or("dv360s-player não encontrado")?;
    let unit = format!(
        "[Unit]\nDescription=DV360S Studio - tela do water cooler\nAfter=default.target\n\n\
         [Service]\nExecStart=\"{}\"\nRestart=on-failure\nRestartSec=3\n\n\
         [Install]\nWantedBy=default.target\n",
        bin.display()
    );
    paths::write_atomic(&unit_path(), unit.as_bytes()).map_err(|e| e.to_string())?;
    kill_manual_player();
    systemctl(&["daemon-reload"])?;
    systemctl(&["enable", "--now", SERVICE]).map(|_| ())
}

/// Instala a regra udev (pede a senha pelo polkit) para usar o USB sem root.
#[tauri::command]
async fn install_udev_rule() -> Result<(), String> {
    let script = format!(
        "printf '%s\\n' 'SUBSYSTEM==\"usb\", ATTR{{idVendor}}==\"1800\", ATTR{{idProduct}}==\"3008\", MODE=\"0666\"' > {UDEV_RULE} \
         && udevadm control --reload && udevadm trigger --subsystem-match=usb --attr-match=idVendor=1800"
    );
    let st = Command::new("pkexec")
        .args(["sh", "-c", &script])
        .status()
        .map_err(|e| format!("pkexec: {e}"))?;
    if st.success() {
        Ok(())
    } else {
        Err("instalação cancelada ou negada".into())
    }
}

/// Quadros de um vídeo, decodificados pelo ffmpeg. O <video> do WebKitGTK não serve: neste
/// sistema ele decodifica, mas os quadros não chegam ao canvas (saem pretos), e sem os plugins
/// do GStreamer ele derruba a página. Corpo: bytes do vídeo; cabeçalhos `x-ext`, `x-fps`,
/// `x-max` (segundos). Resposta: u32 n + n × (u32 tamanho + JPEG), little-endian.
#[tauri::command]
async fn extract_video(request: Request<'_>) -> Result<Response, String> {
    let (data, _) = raw_request(&request)?;
    let data = data.to_vec();
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let ext: String = header("x-ext").unwrap_or_else(|| "mp4".into()).chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    let fps: f32 = header("x-fps").and_then(|v| v.parse::<f32>().ok()).unwrap_or(20.0).clamp(1.0, 60.0);
    let max: f32 = header("x-max").and_then(|v| v.parse::<f32>().ok()).unwrap_or(120.0).clamp(1.0, 600.0);

    tauri::async_runtime::spawn_blocking(move || {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!("dv360s-video-{}-{nanos}.{ext}", std::process::id()));
        std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-nostdin", "-i"])
            .arg(&tmp)
            .args([
                "-an",
                "-t",
                &max.to_string(),
                "-vf",
                &format!("fps={fps},scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease"),
                "-c:v",
                "mjpeg",
                "-q:v",
                "3",
                "-f",
                "image2pipe",
                "pipe:1",
            ])
            .output();
        let _ = std::fs::remove_file(&tmp);
        let out = out.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Para usar vídeo, instale o ffmpeg: sudo pacman -S ffmpeg".to_string()
            } else {
                format!("ffmpeg: {e}")
            }
        })?;
        // o mjpeg do ffmpeg é uma sequência de JPEGs completos (FFD8 ... FFD9)
        let mut frames: Vec<&[u8]> = Vec::new();
        let buf = &out.stdout;
        let mut start = 0;
        let mut i = 2;
        while i + 1 < buf.len() {
            if buf[i] == 0xFF && buf[i + 1] == 0xD9 {
                frames.push(&buf[start..i + 2]);
                start = i + 2;
                i = start + 2;
            } else {
                i += 1;
            }
        }
        if frames.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("não foi possível ler o vídeo: {}", err.lines().last().unwrap_or("formato desconhecido")));
        }
        let mut res = Vec::with_capacity(buf.len() + frames.len() * 4 + 4);
        res.extend_from_slice(&(frames.len() as u32).to_le_bytes());
        for f in frames {
            res.extend_from_slice(&(f.len() as u32).to_le_bytes());
            res.extend_from_slice(f);
        }
        Ok(Response::new(res))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Temperaturas atuais, para a prévia das camadas de sensor.
#[tauri::command]
async fn read_sensors() -> dv360s_core::sensors::Readings {
    use dv360s_core::sensors::Sensors;
    use std::sync::{Mutex, OnceLock};
    // um só leitor: o uso da CPU é a diferença entre leituras consecutivas
    static SENSORS: OnceLock<Mutex<Sensors>> = OnceLock::new();
    let m = SENSORS.get_or_init(|| Mutex::new(Sensors::discover()));
    m.lock().map(|mut s| s.read()).unwrap_or_default()
}

#[tauri::command]
async fn list_fonts() -> Vec<String> {
    let mut fonts: Vec<String> = Command::new("fc-list")
        .args([":", "family"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(|l| l.split(',').next())
                .map(|f| f.trim().replace('\\', ""))
                .filter(|f| !f.is_empty() && !f.starts_with('.') && !f.ends_with(".pcf"))
                .collect()
        })
        .unwrap_or_default();
    fonts.sort_by_key(|f| f.to_lowercase());
    fonts.dedup();
    fonts
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            save_draft,
            load_draft,
            apply_theme,
            start_player,
            stop_player,
            player_status,
            set_player_config,
            set_autostart,
            install_udev_rule,
            read_sensors,
            extract_video,
            list_fonts
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o DV360S Studio");
}
