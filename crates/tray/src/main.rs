//! dv360s-tray: ícone na bandeja (StatusNotifierItem) para trocar o tema da biblioteca, o
//! brilho e a rotação da tela do cooler, ligar/desligar o player e abrir o editor.
//!
//! Não desenha nada nem fala com o USB: só lê/grava os arquivos de `~/.config/dv360s-studio/`
//! (como o editor) e controla o player. Olha os arquivos a cada 2 s.

use std::time::Duration;

use dv360s_core::library::{self, LibTheme};
use dv360s_core::paths::{self, PlayerConfig, PlayerStatus};
use dv360s_core::service;
use ksni::blocking::TrayMethods;
use ksni::menu::{CheckmarkItem, RadioGroup, RadioItem, StandardItem, SubMenu};
use ksni::MenuItem;

const BRIGHTNESS: [u8; 5] = [10, 25, 50, 75, 100];
const ROTATION: [u16; 4] = [0, 90, 180, 270];

#[derive(Clone, PartialEq, Default)]
struct Snapshot {
    running: bool,
    status: PlayerStatus,
    cfg: PlayerConfig,
    themes: Vec<LibTheme>,
}

impl Snapshot {
    fn read() -> Snapshot {
        let running = service::player_running();
        let status = if running {
            std::fs::read(paths::player_status())
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default()
        } else {
            PlayerStatus::default()
        };
        Snapshot { running, status, cfg: PlayerConfig::load(), themes: library::list() }
    }

    fn label(&self) -> String {
        if !self.running {
            return "Player parado".into();
        }
        match self.status.state.as_str() {
            "playing" if self.status.screen.is_empty() || self.status.screen == "Principal" => format!("Na tela: {}", self.status.theme),
            "playing" => format!("Na tela: {} › {}", self.status.theme, self.status.screen),
            "no_permission" => "Sem permissão no USB".into(),
            "waiting_device" => "Aguardando o cooler".into(),
            "no_theme" => "Nenhum tema aplicado".into(),
            "error" => format!("Erro: {}", self.status.message),
            _ => "Iniciando…".into(),
        }
    }
}

struct Tray {
    s: Snapshot,
    /// último erro de uma ação do menu (mostrado no topo até a próxima ação)
    error: Option<String>,
}

impl Tray {
    fn save_cfg(&mut self, f: impl FnOnce(&mut PlayerConfig)) {
        let mut cfg = PlayerConfig::load();
        f(&mut cfg);
        let data = serde_json::to_vec_pretty(&cfg).unwrap_or_default();
        self.error = paths::write_atomic(&paths::player_config(), &data).err().map(|e| e.to_string());
        self.s.cfg = cfg;
    }

    fn act(&mut self, r: Result<(), String>) {
        self.error = r.err();
        self.s = Snapshot::read();
    }
}

fn open_editor() -> Result<(), String> {
    let bin = service::find_bin(service::EDITOR).ok_or("editor não encontrado")?;
    service::spawn_detached(&bin, &[], None)
}

/// Anel com o gradiente do ícone do app (cinza quando o player está parado).
fn icon(size: i32, on: bool) -> ksni::Icon {
    let n = size as usize;
    let mut data = Vec::with_capacity(n * n * 4);
    let c = (size as f32 - 1.0) / 2.0;
    let (r_out, r_in) = (c, c * 0.62);
    let stops: [[f32; 3]; 3] = [[91.0, 140.0, 255.0], [56.0, 189.0, 248.0], [167.0, 139.0, 250.0]];
    for y in 0..n {
        for x in 0..n {
            let (dx, dy) = (x as f32 - c, y as f32 - c);
            let d = (dx * dx + dy * dy).sqrt();
            // borda suavizada de 1 px dos dois lados do anel
            let a = ((r_out + 0.5 - d).clamp(0.0, 1.0) * (d - r_in + 0.5).clamp(0.0, 1.0)) * 255.0;
            let t = ((x + y) as f32 / (2.0 * n as f32)).clamp(0.0, 1.0) * 2.0;
            let (s0, s1, k) = if t < 1.0 { (stops[0], stops[1], t) } else { (stops[1], stops[2], t - 1.0) };
            let mut rgb = [0.0; 3];
            for i in 0..3 {
                rgb[i] = s0[i] + (s1[i] - s0[i]) * k;
            }
            if !on {
                let g = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
                rgb = [g * 0.7; 3];
            }
            data.extend_from_slice(&[a as u8, rgb[0] as u8, rgb[1] as u8, rgb[2] as u8]);
        }
    }
    ksni::Icon { width: size, height: size, data }
}

impl ksni::Tray for Tray {
    fn id(&self) -> String {
        "dv360s-studio".into()
    }

    fn title(&self) -> String {
        "DV360S Studio".into()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        let on = self.s.running && self.s.status.state == "playing";
        [22, 32, 48].into_iter().map(|s| icon(s, on)).collect()
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        ksni::ToolTip { title: "DV360S Studio".into(), description: self.s.label(), ..Default::default() }
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        let r = open_editor();
        self.act(r);
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        let s = &self.s;
        let mut items: Vec<MenuItem<Self>> = vec![StandardItem { label: s.label(), enabled: false, ..Default::default() }.into()];
        if let Some(e) = &self.error {
            items.push(StandardItem { label: format!("⚠ {e}"), enabled: false, ..Default::default() }.into());
        }
        items.push(MenuItem::Separator);

        let themes: Vec<MenuItem<Self>> = if s.themes.is_empty() {
            vec![StandardItem { label: "Nenhum tema salvo na biblioteca".into(), enabled: false, ..Default::default() }.into()]
        } else {
            s.themes
                .iter()
                .map(|t| {
                    let path = t.path.clone();
                    CheckmarkItem {
                        label: t.name.replace('_', "__"),
                        checked: t.active,
                        activate: Box::new(move |this: &mut Self| {
                            let r = library::apply(std::path::Path::new(&path));
                            this.act(r);
                        }),
                        ..Default::default()
                    }
                    .into()
                })
                .collect()
        };
        items.push(SubMenu { label: "Tema".into(), submenu: themes, ..Default::default() }.into());

        let bright = BRIGHTNESS.iter().enumerate().min_by_key(|(_, &b)| b.abs_diff(s.cfg.brightness)).map_or(0, |(i, _)| i);
        items.push(
            SubMenu {
                label: format!("Brilho ({}%)", s.cfg.brightness),
                submenu: vec![RadioGroup {
                    selected: bright,
                    select: Box::new(|this: &mut Self, i| this.save_cfg(|c| c.brightness = BRIGHTNESS[i])),
                    options: BRIGHTNESS.iter().map(|b| RadioItem { label: format!("{b}%"), ..Default::default() }).collect(),
                }
                .into()],
                ..Default::default()
            }
            .into(),
        );
        let rot = ROTATION.iter().position(|&r| r == s.cfg.rotation).unwrap_or(0);
        items.push(
            SubMenu {
                label: "Girar a tela".into(),
                submenu: vec![RadioGroup {
                    selected: rot,
                    select: Box::new(|this: &mut Self, i| this.save_cfg(|c| c.rotation = ROTATION[i])),
                    options: ROTATION.iter().map(|r| RadioItem { label: format!("{r}°"), ..Default::default() }).collect(),
                }
                .into()],
                ..Default::default()
            }
            .into(),
        );
        items.push(
            CheckmarkItem {
                label: "Player ligado".into(),
                checked: s.running,
                activate: Box::new(|this: &mut Self| {
                    let r = if this.s.running {
                        service::stop_player();
                        Ok(())
                    } else {
                        service::start_player()
                    };
                    this.act(r);
                }),
                ..Default::default()
            }
            .into(),
        );
        items.push(MenuItem::Separator);
        items.push(
            StandardItem {
                label: "Abrir o editor".into(),
                icon_name: "document-edit".into(),
                activate: Box::new(|this: &mut Self| {
                    let r = open_editor();
                    this.act(r);
                }),
                ..Default::default()
            }
            .into(),
        );
        items.push(
            StandardItem {
                label: "Fechar o ícone".into(),
                icon_name: "window-close".into(),
                activate: Box::new(|_| std::process::exit(0)),
                ..Default::default()
            }
            .into(),
        );
        items
    }
}

fn main() {
    if !service::pids_named(service::TRAY).is_empty() {
        eprintln!("dv360s-tray já está rodando.");
        std::process::exit(0);
    }
    let handle = match (Tray { s: Snapshot::read(), error: None }).assume_sni_available(true).spawn() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("não foi possível criar o ícone na bandeja: {e}");
            std::process::exit(1);
        }
    };
    let mut last = Snapshot::default();
    while !handle.is_closed() {
        std::thread::sleep(Duration::from_secs(2));
        let next = Snapshot::read();
        // só avisa a bandeja quando algo mudou (evita tráfego no D-Bus)
        if next != last {
            last = next.clone();
            handle.update(|t| t.s = next);
        }
    }
}
