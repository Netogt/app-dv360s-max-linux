//! dv360s-player: mantém um `.dvtheme` na tela do cooler, sem interface gráfica.
//!
//! - Só recodifica e envia um quadro quando o conteúdo muda (relógio de minutos = 1 JPEG por
//!   minuto); no resto do tempo manda um CONNECT a cada 4 s para o watchdog não estourar.
//! - Recarrega sozinho o tema e o `player.json` quando o editor os regrava.
//! - Se o cooler reiniciar ou for desconectado, espera ele voltar e reabre.
//! - SIGTERM/SIGINT: envia CLE (a tela volta ao logo) e sai.
//!
//! Uso: dv360s-player [arquivo.dvtheme]   (padrão: ~/.config/dv360s-studio/active.dvtheme)
//!      dv360s-player --snapshot saida.jpg [arquivo.dvtheme] [quadro] [tela]   (renderiza sem o cooler)
//!      dv360s-player --sensores                                         (temperaturas detectadas)

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use chrono::{Local, Timelike};
use dv360s_core::device::{DevError, Display};
use dv360s_core::paths::{self, PlayerConfig, PlayerStatus};
use dv360s_core::render::{self, Theme, RGB_LEN};
use dv360s_core::sensors::{Readings, Sensors};

fn log(msg: impl AsRef<str>) {
    eprintln!("[{}] {}", Local::now().format("%H:%M:%S"), msg.as_ref());
}

fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

struct Status {
    cur: PlayerStatus,
    /// nome da tela exibida (temas com telas condicionais)
    screen: String,
}

impl Status {
    fn set(&mut self, state: &str, message: impl Into<String>, theme: &str) {
        let next = PlayerStatus {
            pid: std::process::id(),
            state: state.into(),
            message: message.into(),
            theme: theme.into(),
            screen: self.screen.clone(),
        };
        if next != self.cur {
            if !next.message.is_empty() {
                log(format!("{}: {}", next.state, next.message));
            }
            let _ = paths::write_atomic(&paths::player_status(), &serde_json::to_vec(&next).unwrap_or_default());
            self.cur = next;
        }
    }
}

fn snapshot(out: &Path, theme_path: &Path, frame: u64, screen: Option<usize>) -> Result<(), String> {
    let mut t = Theme::load(std::fs::read(theme_path).map_err(|e| e.to_string())?)?;
    let mut rgb = vec![0u8; RGB_LEN];
    let sens = if t.uses_sensors() { Sensors::discover().read() } else { Readings::default() };
    let now = Local::now();
    match screen {
        Some(i) => t.force_screen(i),
        None => {
            t.select(&now, &sens);
        }
    }
    let t0 = Instant::now();
    t.render(frame, &now, &sens, &mut rgb);
    let jpeg = render::encode_jpeg(&rgb, t.quality)?;
    eprintln!(
        "\"{}\" › tela \"{}\": quadro {frame} renderizado em {:.1} ms, JPEG de {} bytes{}",
        t.name,
        t.screen_name(),
        t0.elapsed().as_secs_f64() * 1000.0,
        jpeg.len(),
        if t.animated() { " (tema animado)" } else { "" }
    );
    std::fs::write(out, jpeg).map_err(|e| e.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--sensores") {
        let mut s = Sensors::discover();
        std::thread::sleep(Duration::from_millis(500)); // o uso da CPU precisa de duas leituras
        let r = s.read();
        let f = |v: Option<f32>, u: &str| v.map_or("não encontrado".into(), |t| format!("{t:.1} {u}"));
        println!("CPU:            {}  (uso {})", f(r.cpu_temp, "°C"), f(r.cpu_use, "%"));
        println!("Hotspot da GPU: {}", f(r.gpu_hot, "°C"));
        println!("GPU:            {}  (uso {})", f(r.gpu_temp, "°C"), f(r.gpu_use, "%"));
        println!("RAM em uso:     {}", f(r.ram_use, "%"));
        return;
    }
    if args.first().map(String::as_str) == Some("--snapshot") {
        let out = args.get(1).map(PathBuf::from).unwrap_or_else(|| "snapshot.jpg".into());
        let theme = args.get(2).map(PathBuf::from).unwrap_or_else(paths::active_theme);
        let frame = args.get(3).and_then(|f| f.parse().ok()).unwrap_or(0);
        let screen = args.get(4).and_then(|f| f.parse().ok());
        if let Err(e) = snapshot(&out, &theme, frame, screen) {
            eprintln!("erro: {e}");
            std::process::exit(1);
        }
        return;
    }
    let theme_path: PathBuf = args.first().map(PathBuf::from).unwrap_or_else(paths::active_theme);

    if let Some(pid) = paths::running_player_pid() {
        if pid != std::process::id() {
            eprintln!("dv360s-player já está rodando (pid {pid}).");
            std::process::exit(1);
        }
    }
    let _ = paths::write_atomic(&paths::player_pid(), std::process::id().to_string().as_bytes());

    let stop = Arc::new(AtomicBool::new(false));
    for sig in [signal_hook::consts::SIGTERM, signal_hook::consts::SIGINT, signal_hook::consts::SIGHUP] {
        let _ = signal_hook::flag::register(sig, Arc::clone(&stop));
    }

    let mut status = Status { cur: PlayerStatus::default(), screen: String::new() };
    let mut cfg = PlayerConfig::load();
    let mut cfg_mtime = mtime(&paths::player_config());
    let mut theme: Option<Theme> = None;
    let mut theme_mtime: Option<SystemTime> = None;
    let mut disp = Display::new(cfg.brightness);
    let mut last_key: Option<String> = None;
    let mut last_check = Instant::now() - Duration::from_secs(10);
    let mut retry_at = Instant::now();
    let mut start = Instant::now();
    let mut rgb = vec![0u8; RGB_LEN];
    let mut rotated = vec![0u8; RGB_LEN];
    // sensores: procurados só se algum tema usar temperatura, e lidos no máximo 1x por segundo
    let mut sensors: Option<Sensors> = None;
    let mut sens = Readings::default();
    let mut sens_at = Instant::now() - Duration::from_secs(10);

    log(format!("tema: {}", theme_path.display()));

    while !stop.load(Ordering::Relaxed) {
        // 1) arquivos alterados pelo editor (um stat por segundo)
        if last_check.elapsed() >= Duration::from_secs(1) {
            last_check = Instant::now();
            let m = mtime(&theme_path);
            if m != theme_mtime {
                theme_mtime = m;
                theme = None;
                if m.is_some() {
                    match std::fs::read(&theme_path).map_err(|e| e.to_string()).and_then(Theme::load) {
                        Ok(t) => {
                            log(format!("tema carregado: {}", t.name));
                            theme = Some(t);
                            status.screen.clear();
                            last_key = None;
                            start = Instant::now();
                        }
                        Err(e) => status.set("error", format!("tema inválido: {e}"), ""),
                    }
                }
            }
            let m = mtime(&paths::player_config());
            if m != cfg_mtime {
                cfg_mtime = m;
                let next = PlayerConfig::load();
                if next.brightness != cfg.brightness {
                    let _ = disp.set_brightness(next.brightness);
                }
                if next.rotation != cfg.rotation {
                    last_key = None;
                }
                cfg = next;
            }
        }

        let Some(t) = theme.as_mut() else {
            disp.close();
            if status.cur.state != "error" {
                status.set("no_theme", "nenhum tema aplicado", "");
            }
            std::thread::sleep(Duration::from_millis(500));
            continue;
        };

        // 2) dispositivo
        if !disp.is_open() {
            if Instant::now() < retry_at {
                std::thread::sleep(Duration::from_millis(250));
                continue;
            }
            match disp.open() {
                Ok(()) => {
                    log("cooler conectado");
                    last_key = None;
                }
                Err(e) => {
                    let state = match e {
                        DevError::NoPermission => "no_permission",
                        _ => "waiting_device",
                    };
                    status.set(state, e.to_string(), &t.name);
                    retry_at = Instant::now() + Duration::from_secs(2);
                    continue;
                }
            }
        }
        status.set("playing", "", &t.name);

        // 3) quadro
        let now = Local::now();
        let frame = (start.elapsed().as_secs_f64() * t.fps as f64) as u64;
        if t.uses_sensors() && sens_at.elapsed() >= Duration::from_millis(990) {
            sens = sensors.get_or_insert_with(Sensors::discover).read();
            sens_at = Instant::now();
        }
        if t.select(&now, &sens) || status.screen.is_empty() {
            if t.screen_count() > 1 {
                log(format!("tela: {}", t.screen_name()));
            }
            status.screen = t.screen_name().to_string();
            status.set("playing", "", &t.name);
            last_key = None;
            start = Instant::now();
            continue;
        }
        let key = t.key(frame, &now, &sens);
        let result = if last_key.as_deref() != Some(key.as_str()) {
            let sent = match t.passthrough(frame).filter(|_| cfg.rotation == 0) {
                Some(jpeg) => disp.send_jpeg(jpeg),
                None => {
                    t.render(frame, &now, &sens, &mut rgb);
                    let src = if cfg.rotation == 0 {
                        &rgb
                    } else {
                        render::rotate_rgb(&rgb, &mut rotated, cfg.rotation);
                        &rotated
                    };
                    match render::encode_jpeg(src, t.quality) {
                        Ok(jpeg) => disp.send_jpeg(&jpeg),
                        Err(e) => Err(DevError::Usb(e)),
                    }
                }
            };
            if sent.is_ok() {
                last_key = Some(key);
            }
            sent
        } else if disp.keepalive_due() {
            disp.keepalive()
        } else {
            Ok(())
        };
        if let Err(e) = result {
            status.set("waiting_device", format!("{e}; reabrindo"), &t.name);
            disp.close();
            last_key = None;
            retry_at = Instant::now() + Duration::from_millis(500);
            continue;
        }

        // 4) dorme até o próximo quadro (animado) ou o próximo segundo (estático/relógio)
        let wait = if t.animated() {
            let next = (frame + 1) as f64 / t.fps as f64;
            Duration::from_secs_f64((next - start.elapsed().as_secs_f64()).max(0.001))
        } else {
            let ms_into_second = now.nanosecond() as u64 / 1_000_000 % 1000;
            Duration::from_millis(1000 - ms_into_second + 5)
        };
        std::thread::sleep(wait.min(Duration::from_secs(1)));
    }

    log("encerrando (CLE)");
    disp.close();
    let _ = std::fs::remove_file(paths::player_pid());
    status.set("stopped", "", "");
}
