//! Comandos do editor. O editor nunca abre o USB: quem fala com o cooler é sempre o
//! `dv360s-player`; o editor grava o tema/configuração, controla o processo e, na prévia ao
//! vivo, manda quadros prontos para ele pelo socket.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use dv360s_core::paths::{self, PlayerConfig, PlayerStatus};
use dv360s_core::{library, live, service};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager};

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
/// `x-path`: o arquivo da biblioteca de onde ele veio, se for o caso.
#[tauri::command]
fn apply_theme(request: Request<'_>) -> Result<(), String> {
    let (data, source) = raw_request(&request)?;
    paths::write_atomic(&paths::active_theme(), data).map_err(|e| e.to_string())?;
    let source = source.map(PathBuf::from).filter(|p| library::contains(p));
    library::set_active_source(source.as_deref());
    service::start_player()
}

#[tauri::command]
fn start_player() -> Result<(), String> {
    service::start_player()
}

#[tauri::command]
fn stop_player() {
    service::stop_player();
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
    tray_running: bool,
    tray_autostart: bool,
    tray_found: bool,
    config: PlayerConfig,
}

#[tauri::command]
async fn player_status() -> StatusOut {
    let running = service::player_running();
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
        autostart: service::autostart_enabled(service::PLAYER),
        player_found: service::find_bin(service::PLAYER).is_some(),
        tray_running: service::tray_running(),
        tray_autostart: service::autostart_enabled(service::TRAY),
        tray_found: service::find_bin(service::TRAY).is_some(),
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
    service::set_autostart(service::PLAYER, enabled)
}

/// Ícone na bandeja: liga (e passa a iniciar com a sessão) ou desliga.
#[tauri::command]
fn set_tray(enabled: bool) -> Result<(), String> {
    if enabled {
        service::set_autostart(service::TRAY, true).or_else(|_| service::start_tray())
    } else {
        let _ = service::set_autostart(service::TRAY, false);
        service::stop_tray();
        Ok(())
    }
}

// ---------- biblioteca ----------

#[tauri::command]
fn library_dir() -> Result<String, String> {
    let dir = paths::library_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
async fn library_list() -> Vec<library::LibTheme> {
    library::list()
}

#[tauri::command]
async fn library_thumb(path: String) -> Response {
    Response::new(library::thumb(Path::new(&path)).unwrap_or_default())
}

#[tauri::command]
async fn library_apply(path: String) -> Result<(), String> {
    library::apply(Path::new(&path))
}

#[tauri::command]
fn library_delete(path: String) -> Result<(), String> {
    library::remove(Path::new(&path))
}

// ---------- prévia ao vivo ----------

/// Quadro da prévia (RGBA 480×480) → girado como o player gira → JPEG → player.
/// Cabeçalho `x-q`: qualidade JPEG do tema.
#[tauri::command]
async fn live_frame(request: Request<'_>) -> Result<(), String> {
    use dv360s_core::render::{encode_jpeg, rotate_rgb, RGB_LEN};
    let (data, _) = raw_request(&request)?;
    if data.len() != RGB_LEN / 3 * 4 {
        return Err("quadro com tamanho inválido".into());
    }
    if !service::player_running() {
        // o primeiro quadro se perde; os próximos já chegam
        return service::start_player();
    }
    let q: u8 = request.headers().get("x-q").and_then(|v| v.to_str().ok()?.parse().ok()).unwrap_or(85);
    let mut rgb = Vec::with_capacity(RGB_LEN);
    for px in data.chunks_exact(4) {
        rgb.extend_from_slice(&px[..3]);
    }
    let rotation = PlayerConfig::load().rotation;
    if rotation != 0 {
        let mut out = vec![0u8; RGB_LEN];
        rotate_rgb(&rgb, &mut out, rotation);
        rgb = out;
    }
    let jpeg = encode_jpeg(&rgb, q)?;
    live::send(live::FRAME, &jpeg)
}

/// Nada mudou na prévia, mas o editor continua espelhando.
#[tauri::command]
fn live_ping() -> Result<(), String> {
    live::send(live::PING, &[])
}

#[tauri::command]
fn live_end() {
    let _ = live::send(live::END, &[]);
}

/// Erros da interface vão para o terminal e para ~/.config/dv360s-studio/editor.log.
#[tauri::command]
fn log_error(message: String) {
    use std::io::Write;
    eprintln!("[editor] {message}");
    let path = paths::config_dir().join("editor.log");
    // não deixa o log crescer sem limite
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 512 * 1024) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let when = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "[{when}] {message}");
    }
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

/// Importações de vídeo canceladas pelo usuário (por id).
fn cancelled() -> &'static Mutex<HashSet<String>> {
    static C: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

#[tauri::command]
fn cancel_video(id: String) {
    if let Ok(mut c) = cancelled().lock() {
        c.insert(id);
    }
}

#[derive(Serialize, Clone)]
struct VideoProgress<'a> {
    id: &'a str,
    done: usize,
    total: usize,
}

/// Duração do vídeo em segundos (ffprobe vem junto com o ffmpeg).
fn probe_duration(file: &Path) -> Option<f32> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"])
        .arg(file)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// Quadros de um vídeo, decodificados pelo ffmpeg. O <video> do WebKitGTK não serve: neste
/// sistema ele decodifica, mas os quadros não chegam ao canvas (saem pretos), e sem os plugins
/// do GStreamer ele derruba a página. Corpo: bytes do vídeo; cabeçalhos `x-id`, `x-ext`,
/// `x-fps`, `x-max` (segundos). O progresso sai no evento `video-progress`.
/// Resposta: u32 n + n × (u32 tamanho + JPEG), little-endian.
#[tauri::command]
async fn extract_video(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    let (data, _) = raw_request(&request)?;
    let data = data.to_vec();
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let id = header("x-id").unwrap_or_default();
    let ext: String = header("x-ext").unwrap_or_else(|| "mp4".into()).chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    let fps: f32 = header("x-fps").and_then(|v| v.parse::<f32>().ok()).unwrap_or(20.0).clamp(1.0, 60.0);
    let max: f32 = header("x-max").and_then(|v| v.parse::<f32>().ok()).unwrap_or(120.0).clamp(1.0, 600.0);

    tauri::async_runtime::spawn_blocking(move || {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!("dv360s-video-{}-{nanos}.{ext}", std::process::id()));
        std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
        drop(data);
        let result = run_ffmpeg(&app, &id, &tmp, fps, max);
        let _ = std::fs::remove_file(&tmp);
        if let Ok(mut c) = cancelled().lock() {
            c.remove(&id);
        }
        result.map(Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run_ffmpeg(app: &AppHandle, id: &str, file: &Path, fps: f32, max: f32) -> Result<Vec<u8>, String> {
    let total = probe_duration(file).map_or(0, |d| (d.min(max) * fps).ceil() as usize);
    let mut child = Command::new("ffmpeg")
        .args(["-v", "error", "-nostdin", "-i"])
        .arg(file)
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
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Para usar vídeo, instale o ffmpeg: sudo pacman -S ffmpeg".to_string()
            } else {
                format!("ffmpeg: {e}")
            }
        })?;
    let mut stderr = child.stderr.take().expect("stderr");
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = std::io::Read::read_to_string(&mut stderr, &mut s);
        s
    });
    let mut stdout = child.stdout.take().expect("stdout");

    // o mjpeg do ffmpeg é uma sequência de JPEGs completos (FFD8 ... FFD9)
    let mut buf: Vec<u8> = Vec::new();
    let mut frames: Vec<(usize, usize)> = Vec::new();
    let mut start = 0;
    let mut scan = 2;
    let mut chunk = vec![0u8; 256 * 1024];
    let mut last_emit = std::time::Instant::now();
    loop {
        if cancelled().lock().is_ok_and(|c| c.contains(id)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("importação cancelada".into());
        }
        let n = std::io::Read::read(&mut stdout, &mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        while scan + 1 < buf.len() {
            if buf[scan] == 0xFF && buf[scan + 1] == 0xD9 {
                frames.push((start, scan + 2));
                start = scan + 2;
                scan = start + 2;
            } else {
                scan += 1;
            }
        }
        if last_emit.elapsed() >= std::time::Duration::from_millis(150) {
            last_emit = std::time::Instant::now();
            let _ = app.emit("video-progress", VideoProgress { id, done: frames.len(), total: total.max(frames.len()) });
        }
    }
    let _ = child.wait();
    let err = err_reader.join().unwrap_or_default();
    if frames.is_empty() {
        return Err(format!("não foi possível ler o vídeo: {}", err.lines().last().unwrap_or("formato desconhecido")));
    }
    let mut res = Vec::with_capacity(buf.len() + frames.len() * 4 + 4);
    res.extend_from_slice(&(frames.len() as u32).to_le_bytes());
    for (a, b) in frames {
        res.extend_from_slice(&((b - a) as u32).to_le_bytes());
        res.extend_from_slice(&buf[a..b]);
    }
    Ok(res)
}

/// Temperaturas atuais, para a prévia das camadas de sensor.
#[tauri::command]
async fn read_sensors() -> dv360s_core::sensors::Readings {
    use dv360s_core::sensors::Sensors;
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
        // abrir de novo (ícone da bandeja, menu de apps) só traz a janela que já está aberta
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
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
            set_tray,
            library_dir,
            library_list,
            library_thumb,
            library_apply,
            library_delete,
            live_frame,
            live_ping,
            live_end,
            log_error,
            cancel_video,
            install_udev_rule,
            read_sensors,
            extract_video,
            list_fonts
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o DV360S Studio");
}
