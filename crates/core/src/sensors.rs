//! Temperaturas e uso da CPU, GPU e RAM lidos do sysfs/procfs, com `nvidia-smi` como
//! alternativa. Baseado no `sensors.rs` do projeto `monitor`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Readings {
    pub cpu_temp: Option<f32>,
    pub gpu_hot: Option<f32>,
    pub gpu_temp: Option<f32>,
    /// uso em %
    pub cpu_use: Option<f32>,
    pub gpu_use: Option<f32>,
    pub ram_use: Option<f32>,
}

/// Nomes usados nos templates (`{cpuTemp}`) e nas condições das telas.
pub const NAMES: [&str; 6] = ["cpuTemp", "gpuHot", "gpuTemp", "cpuUse", "gpuUse", "ramUse"];

impl Readings {
    pub fn get(&self, name: &str) -> Option<f32> {
        match name {
            "cpuTemp" => self.cpu_temp,
            "gpuHot" => self.gpu_hot,
            "gpuTemp" => self.gpu_temp,
            "cpuUse" => self.cpu_use,
            "gpuUse" => self.gpu_use,
            "ramUse" => self.ram_use,
            _ => None,
        }
    }
}

fn read_str(p: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(p).ok().map(|s| s.trim().to_string())
}

/// Temperatura em °C de um arquivo hwmon (miligraus).
fn read_temp(p: &Path) -> Option<f32> {
    read_str(p)?.parse::<f32>().ok().map(|v| v / 1000.0)
}

struct Hwmon {
    name: String,
    path: PathBuf,
}

impl Hwmon {
    fn all() -> Vec<Hwmon> {
        let Ok(rd) = fs::read_dir("/sys/class/hwmon") else { return Vec::new() };
        let mut list: Vec<Hwmon> = rd
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                Some(Hwmon { name: read_str(path.join("name"))?, path })
            })
            .collect();
        list.sort_by(|a, b| a.path.cmp(&b.path));
        list
    }

    /// `tempN_input` cujo `tempN_label` (em minúsculas) satisfaz o predicado.
    fn temp_by_label(&self, pred: impl Fn(&str) -> bool) -> Option<PathBuf> {
        (1..=32).find_map(|i| {
            let l = read_str(self.path.join(format!("temp{i}_label")))?;
            pred(&l.to_lowercase()).then(|| self.path.join(format!("temp{i}_input")))
        })
    }
}

/// (ocioso, total) agregados da primeira linha de /proc/stat
fn read_proc_stat() -> Option<(u64, u64)> {
    let s = fs::read_to_string("/proc/stat").ok()?;
    let vals: Vec<u64> = s.lines().next()?.split_whitespace().skip(1).filter_map(|v| v.parse().ok()).collect();
    if vals.len() < 4 {
        return None;
    }
    let total = vals.iter().take(8).sum();
    Some((vals[3] + vals.get(4).copied().unwrap_or(0), total))
}

fn read_ram_use() -> Option<f32> {
    let s = fs::read_to_string("/proc/meminfo").ok()?;
    let field = |k: &str| -> Option<f32> {
        s.lines().find(|l| l.starts_with(k))?.split_whitespace().nth(1)?.parse().ok()
    };
    let (total, avail) = (field("MemTotal:")?, field("MemAvailable:")?);
    (total > 0.0).then(|| (1.0 - avail / total) * 100.0)
}

pub struct Sensors {
    cpu_temp: Option<PathBuf>,
    gpu_hot: Option<PathBuf>,
    gpu_temp: Option<PathBuf>,
    gpu_busy: Option<PathBuf>,
    nvidia: bool,
    prev_stat: Option<(u64, u64)>,
}

impl Sensors {
    /// Procura os sensores uma vez; depois cada leitura é só abrir alguns arquivos.
    pub fn discover() -> Sensors {
        let hw = Hwmon::all();

        // AMD: Tdie/Tctl (pacote); Intel: "Package id 0"
        let cpu_temp = hw.iter().find_map(|h| match h.name.as_str() {
            "k10temp" | "zenpower" => h.temp_by_label(|l| l == "tdie").or_else(|| h.temp_by_label(|l| l == "tctl")),
            "coretemp" => h.temp_by_label(|l| l.starts_with("package")),
            _ => None,
        });

        // AMD: hotspot = "junction". Numa APU com placa de vídeo, a integrada também é "amdgpu"
        // mas não tem junction — por isso a preferência é pela que tem.
        let amd: Vec<&Hwmon> = hw.iter().filter(|h| h.name == "amdgpu").collect();
        let gpu = amd.iter().find(|h| h.temp_by_label(|l| l == "junction").is_some()).or(amd.first());
        let (gpu_hot, mut gpu_temp, gpu_busy) = match gpu {
            Some(g) => (
                g.temp_by_label(|l| l == "junction"),
                g.temp_by_label(|l| l == "edge").or_else(|| Some(g.path.join("temp1_input")).filter(|p| p.exists())),
                Some(g.path.join("device/gpu_busy_percent")).filter(|p| p.exists()),
            ),
            None => (None, None, None),
        };
        if gpu_temp.is_none() {
            gpu_temp = hw
                .iter()
                .filter(|h| matches!(h.name.as_str(), "nouveau" | "radeon" | "i915" | "xe"))
                .map(|h| h.path.join("temp1_input"))
                .find(|p| p.exists());
        }
        let nvidia = gpu_temp.is_none()
            && Command::new("nvidia-smi").arg("-L").output().is_ok_and(|o| o.status.success());

        Sensors { cpu_temp, gpu_hot, gpu_temp, gpu_busy, nvidia, prev_stat: read_proc_stat() }
    }

    pub fn read(&mut self) -> Readings {
        // uso da CPU: diferença entre esta leitura de /proc/stat e a anterior
        let mut cpu_use = None;
        if let Some((idle, total)) = read_proc_stat() {
            if let Some((pi, pt)) = self.prev_stat {
                let dt = total.saturating_sub(pt);
                if dt > 0 {
                    cpu_use = Some((1.0 - idle.saturating_sub(pi) as f32 / dt as f32) * 100.0);
                }
            }
            self.prev_stat = Some((idle, total));
        }
        let mut r = Readings {
            cpu_temp: self.cpu_temp.as_deref().and_then(read_temp),
            gpu_hot: self.gpu_hot.as_deref().and_then(read_temp),
            gpu_temp: self.gpu_temp.as_deref().and_then(read_temp),
            cpu_use,
            gpu_use: self.gpu_busy.as_deref().and_then(read_str).and_then(|s| s.parse().ok()),
            ram_use: read_ram_use(),
        };
        if self.nvidia {
            // a NVIDIA não expõe o hotspot pelo nvidia-smi
            let out = Command::new("nvidia-smi")
                .args(["--query-gpu=temperature.gpu,utilization.gpu", "--format=csv,noheader,nounits"])
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").to_string())
                .unwrap_or_default();
            let mut it = out.split(',').map(|v| v.trim().parse::<f32>().ok());
            r.gpu_temp = it.next().flatten();
            r.gpu_use = it.next().flatten();
        }
        r
    }
}
