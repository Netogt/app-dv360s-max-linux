//! Composição dos quadros no player. Trabalha num buffer RGB 480x480; camadas com alfa
//! são guardadas pré-multiplicadas para a interpolação na rotação não gerar bordas escuras.

use std::time::{Duration, Instant};

use chrono::{DateTime, Datelike, Local, Timelike};

use crate::pack::Pack;
use crate::protocol::MAX_JPEG;
use crate::rules;
use crate::sensors::{self, Readings};
use crate::theme::{Align, Manifest, Piece, Rule, ScreenSpec, SegmentSpec, TextSpec, FORMAT, VERSION};
use crate::SIZE;

pub const RGB_LEN: usize = SIZE * SIZE * 3;

pub struct Theme {
    pub name: String,
    pub fps: f32,
    pub quality: u8,
    /// `[0]` = principal
    screens: Vec<Screen>,
    active: usize,
    switched: Option<Instant>,
    hold: Duration,
    hysteresis: f32,
}

struct Screen {
    name: String,
    any: bool,
    rules: Vec<Rule>,
    segs: Vec<Seg>,
}

enum Seg {
    Frames(Frames),
    Text(Text),
}

struct Frames {
    data: Vec<Vec<u8>>,
    opaque: bool,
    png: bool,
    /// último quadro decodificado: RGB se opaco, RGBA pré-multiplicado se não
    cache: Option<(usize, Vec<u8>)>,
}

struct Text {
    spec: TextSpec,
    atlas: Vec<u8>,
    aw: usize,
    ah: usize,
    line: Vec<u8>,
    lw: usize,
    lh: usize,
    keys: Vec<String>,
}

fn premultiply(px: &mut [u8]) {
    for p in px.chunks_exact_mut(4) {
        let a = p[3] as u32;
        if a != 255 {
            p[0] = (p[0] as u32 * a / 255) as u8;
            p[1] = (p[1] as u32 * a / 255) as u8;
            p[2] = (p[2] as u32 * a / 255) as u8;
        }
    }
}

impl Theme {
    pub fn load(bytes: Vec<u8>) -> Result<Theme, String> {
        let pack = Pack::parse(bytes)?;
        let raw = pack.get("manifest.json").ok_or("o arquivo não tem manifest.json (não é um tema)")?;
        let m: Manifest = serde_json::from_slice(raw).map_err(|e| format!("manifest.json inválido: {e}"))?;
        if m.format != FORMAT || m.version > VERSION {
            return Err(format!("formato {} v{} não suportado (atualize o player)", m.format, m.version));
        }
        let specs = if m.screens.is_empty() {
            vec![ScreenSpec { name: m.name.clone(), any: false, rules: Vec::new(), segments: m.segments }]
        } else {
            m.screens
        };
        let mut screens = Vec::with_capacity(specs.len());
        for s in specs {
            screens.push(Screen { name: s.name, any: s.any, rules: s.rules, segs: load_segs(&pack, s.segments)? });
        }
        Ok(Theme {
            name: m.name,
            fps: m.fps.clamp(1.0, 60.0),
            quality: m.quality.clamp(30, 100),
            screens,
            active: 0,
            switched: None,
            hold: Duration::from_secs_f32(m.hold.clamp(0.0, 3600.0)),
            hysteresis: m.hysteresis.clamp(0.0, 50.0),
        })
    }

    fn segs(&self) -> &[Seg] {
        &self.screens[self.active].segs
    }

    pub fn screen_name(&self) -> &str {
        &self.screens[self.active].name
    }

    pub fn screen_count(&self) -> usize {
        self.screens.len()
    }

    /// Força uma tela (diagnóstico: `--snapshot ... [tela]`).
    pub fn force_screen(&mut self, i: usize) {
        self.active = i.min(self.screens.len() - 1);
    }

    /// Escolhe a tela pelas condições: a primeira (depois da principal) que vale; senão a
    /// principal. Depois de uma troca, espera `hold` antes de trocar de novo.
    /// Devolve true se a tela mudou.
    pub fn select(&mut self, now: &DateTime<Local>, sens: &Readings) -> bool {
        let next = (1..self.screens.len())
            .find(|&i| {
                let s = &self.screens[i];
                let margin = if i == self.active { self.hysteresis } else { 0.0 };
                rules::screen_ok(&s.rules, s.any, now, sens, margin)
            })
            .unwrap_or(0);
        if next == self.active || self.switched.is_some_and(|t| t.elapsed() < self.hold) {
            return false;
        }
        self.active = next;
        self.switched = Some(Instant::now());
        true
    }

    /// Tem alguma sequência de quadros (GIF/vídeo) na tela atual?
    pub fn animated(&self) -> bool {
        self.segs().iter().any(|s| matches!(s, Seg::Frames(f) if f.data.len() > 1))
    }

    /// Precisa ler sensores? (texto com temperatura/uso ou condição de sensor em alguma tela)
    pub fn uses_sensors(&self) -> bool {
        self.screens.iter().any(|sc| {
            rules::uses_sensors(&sc.rules)
                || sc.segs.iter().any(|s| matches!(s, Seg::Text(t) if uses_sensors(&t.spec.pieces)))
        })
    }

    /// Precisa reavaliar a cada segundo? (condições de horário/data mudam com o relógio)
    pub fn has_rules(&self) -> bool {
        self.screens.iter().skip(1).any(|s| !s.rules.is_empty())
    }

    /// Identifica o conteúdo do quadro: se não mudou, não há o que reenviar.
    pub fn key(&self, frame: u64, now: &DateTime<Local>, sens: &Readings) -> String {
        let mut k = format!("{}#", self.active);
        let mut keys = Vec::new();
        for s in self.segs() {
            match s {
                Seg::Frames(f) => {
                    if f.data.len() > 1 {
                        k.push_str(&(frame as usize % f.data.len()).to_string());
                    }
                }
                Seg::Text(t) => {
                    keys.clear();
                    resolve(&t.spec.pieces, now, sens, &mut keys);
                    k.push_str(&keys.join(","));
                }
            }
            k.push('|');
        }
        k
    }

    /// Tela que é só uma sequência de JPEGs opacos: dá para enviar os bytes do arquivo direto,
    /// sem decodificar nem recodificar.
    pub fn passthrough(&self, frame: u64) -> Option<&[u8]> {
        match self.segs() {
            [Seg::Frames(f)] if f.opaque && !f.png => {
                let d = &f.data[frame as usize % f.data.len()];
                (d.len() <= MAX_JPEG).then_some(d.as_slice())
            }
            _ => None,
        }
    }

    /// Desenha o quadro `frame` (contado a partir do início, na taxa `fps`) em `out` (RGB).
    pub fn render(&mut self, frame: u64, now: &DateTime<Local>, sens: &Readings, out: &mut [u8]) {
        out.fill(0);
        let active = self.active;
        for s in &mut self.screens[active].segs {
            match s {
                Seg::Frames(f) => {
                    let idx = frame as usize % f.data.len();
                    if f.cache.as_ref().map(|c| c.0) != Some(idx) {
                        f.cache = decode(&f.data[idx], f.opaque, f.png).map(|px| (idx, px));
                    }
                    let Some((_, px)) = &f.cache else { continue };
                    if f.opaque {
                        out.copy_from_slice(px);
                    } else {
                        blend_full(out, px);
                    }
                }
                Seg::Text(t) => t.draw(now, sens, out),
            }
        }
    }
}

fn load_segs(pack: &Pack, specs: Vec<SegmentSpec>) -> Result<Vec<Seg>, String> {
    let mut segs = Vec::with_capacity(specs.len());
    for s in specs {
        match s {
            SegmentSpec::Frames { dir, count, ext, opaque } => {
                let mut data = Vec::with_capacity(count);
                for i in 0..count {
                    let name = format!("{dir}/{i:05}.{ext}");
                    data.push(pack.get(&name).ok_or_else(|| format!("falta {name}"))?.to_vec());
                }
                if data.is_empty() {
                    continue;
                }
                segs.push(Seg::Frames(Frames { data, opaque, png: ext == "png", cache: None }));
            }
            SegmentSpec::Text(spec) => {
                let png = pack.get(&spec.atlas).ok_or_else(|| format!("falta {}", spec.atlas))?;
                let img = image::load_from_memory_with_format(png, image::ImageFormat::Png)
                    .map_err(|e| format!("atlas inválido: {e}"))?
                    .to_rgba8();
                let (aw, ah) = (img.width() as usize, img.height() as usize);
                let mut atlas = img.into_raw();
                premultiply(&mut atlas);
                let lw = spec.bbox[2].ceil().max(1.0) as usize;
                let lh = spec.bbox[3].ceil().max(1.0) as usize;
                segs.push(Seg::Text(Text {
                    spec,
                    atlas,
                    aw,
                    ah,
                    line: vec![0; lw * lh * 4],
                    lw,
                    lh,
                    keys: Vec::new(),
                }));
            }
        }
    }
    Ok(segs)
}

fn decode(data: &[u8], opaque: bool, png: bool) -> Option<Vec<u8>> {
    let fmt = if png { image::ImageFormat::Png } else { image::ImageFormat::Jpeg };
    let img = image::load_from_memory_with_format(data, fmt).ok()?;
    if img.width() as usize != SIZE || img.height() as usize != SIZE {
        return None;
    }
    if opaque {
        Some(img.to_rgb8().into_raw())
    } else {
        let mut px = img.to_rgba8().into_raw();
        premultiply(&mut px);
        Some(px)
    }
}

#[inline]
fn over(dst: &mut [u8], r: u32, g: u32, b: u32, a: u32) {
    let inv = 255 - a;
    dst[0] = (r + dst[0] as u32 * inv / 255).min(255) as u8;
    dst[1] = (g + dst[1] as u32 * inv / 255).min(255) as u8;
    dst[2] = (b + dst[2] as u32 * inv / 255).min(255) as u8;
}

fn blend_full(out: &mut [u8], src: &[u8]) {
    for (d, s) in out.chunks_exact_mut(3).zip(src.chunks_exact(4)) {
        if s[3] != 0 {
            over(d, s[0] as u32, s[1] as u32, s[2] as u32, s[3] as u32);
        }
    }
}

impl Text {
    fn draw(&mut self, now: &DateTime<Local>, sens: &Readings, out: &mut [u8]) {
        self.keys.clear();
        resolve(&self.spec.pieces, now, sens, &mut self.keys);
        self.line.fill(0);
        let total: f32 = self.keys.iter().filter_map(|k| self.spec.sprites.get(k)).map(|s| s.adv).sum();
        let mut x = match self.spec.align {
            Align::Left => 0.0,
            Align::Center => (self.lw as f32 - total) / 2.0,
            Align::Right => self.lw as f32 - total,
        };
        let y0 = (self.lh as i32 - self.spec.sprite_height as i32) / 2;
        for k in &self.keys {
            let Some(sp) = self.spec.sprites.get(k) else { continue };
            let dx = (x - sp.ox).round() as i32;
            let [sx, sy, sw, sh] = sp.r.map(|v| v as usize);
            for row in 0..sh {
                let ly = y0 + row as i32;
                if ly < 0 || ly as usize >= self.lh || sy + row >= self.ah {
                    continue;
                }
                for col in 0..sw {
                    let lx = dx + col as i32;
                    if lx < 0 || lx as usize >= self.lw || sx + col >= self.aw {
                        continue;
                    }
                    let s = ((sy + row) * self.aw + sx + col) * 4;
                    let a = self.atlas[s + 3] as u32;
                    if a == 0 {
                        continue;
                    }
                    let d = (ly as usize * self.lw + lx as usize) * 4;
                    let inv = 255 - a;
                    for c in 0..4 {
                        let v = self.atlas[s + c] as u32 + self.line[d + c] as u32 * inv / 255;
                        self.line[d + c] = v.min(255) as u8;
                    }
                }
            }
            x += sp.adv;
        }
        let [bx, by, bw, bh] = self.spec.bbox;
        let op = (self.spec.opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
        composite(out, &self.line, self.lw, self.lh, bx, by, bw, bh, self.spec.rotation, op);
    }
}

/// Cola `src` (RGBA pré-multiplicado, sw x sh) na caixa (bx, by, bw, bh) girada `rot` graus
/// (sentido horário, como o `ctx.rotate` do canvas) em torno do centro da caixa.
#[allow(clippy::too_many_arguments)]
fn composite(out: &mut [u8], src: &[u8], sw: usize, sh: usize, bx: f32, by: f32, bw: f32, bh: f32, rot: f32, op: u32) {
    if op == 0 {
        return;
    }
    let n = SIZE as i32;
    let rot = rot.rem_euclid(360.0);
    if rot.abs() < 0.01 || (360.0 - rot).abs() < 0.01 {
        let (ox, oy) = (bx.round() as i32, by.round() as i32);
        for y in 0..sh as i32 {
            let dy = oy + y;
            if !(0..n).contains(&dy) {
                continue;
            }
            for x in 0..sw as i32 {
                let dx = ox + x;
                if !(0..n).contains(&dx) {
                    continue;
                }
                let s = (y as usize * sw + x as usize) * 4;
                let a = src[s + 3] as u32 * op / 255;
                if a == 0 {
                    continue;
                }
                let d = (dy as usize * SIZE + dx as usize) * 3;
                let m = |v: u8| v as u32 * op / 255;
                over(&mut out[d..d + 3], m(src[s]), m(src[s + 1]), m(src[s + 2]), a);
            }
        }
        return;
    }

    let (sin, cos) = rot.to_radians().sin_cos();
    let (cx, cy) = (bx + bw / 2.0, by + bh / 2.0);
    let (hw, hh) = (sw as f32 / 2.0, sh as f32 / 2.0);
    // caixa envolvente da área girada
    let ex = hw * cos.abs() + hh * sin.abs();
    let ey = hw * sin.abs() + hh * cos.abs();
    let x0 = ((cx - ex).floor() as i32).clamp(0, n);
    let x1 = ((cx + ex).ceil() as i32).clamp(0, n);
    let y0 = ((cy - ey).floor() as i32).clamp(0, n);
    let y1 = ((cy + ey).ceil() as i32).clamp(0, n);
    let texel = |x: i32, y: i32, c: usize| -> f32 {
        if x < 0 || y < 0 || x as usize >= sw || y as usize >= sh {
            0.0
        } else {
            src[(y as usize * sw + x as usize) * 4 + c] as f32
        }
    };
    let opf = op as f32 / 255.0;
    for py in y0..y1 {
        for px in x0..x1 {
            let dx = px as f32 + 0.5 - cx;
            let dy = py as f32 + 0.5 - cy;
            let u = dx * cos + dy * sin + hw - 0.5;
            let v = -dx * sin + dy * cos + hh - 0.5;
            if u < -1.0 || v < -1.0 || u > sw as f32 || v > sh as f32 {
                continue;
            }
            let (ux, vy) = (u.floor(), v.floor());
            let (fx, fy) = (u - ux, v - vy);
            let (ix, iy) = (ux as i32, vy as i32);
            let mut c = [0f32; 4];
            for (ch, cv) in c.iter_mut().enumerate() {
                let top = texel(ix, iy, ch) * (1.0 - fx) + texel(ix + 1, iy, ch) * fx;
                let bot = texel(ix, iy + 1, ch) * (1.0 - fx) + texel(ix + 1, iy + 1, ch) * fx;
                *cv = (top * (1.0 - fy) + bot * fy) * opf;
            }
            if c[3] < 0.5 {
                continue;
            }
            let d = (py as usize * SIZE + px as usize) * 3;
            over(&mut out[d..d + 3], c[0] as u32, c[1] as u32, c[2] as u32, c[3] as u32);
        }
    }
}

/// Transforma os trechos do template nas chaves dos sprites para o instante `now`.
pub fn resolve(pieces: &[Piece], now: &DateTime<Local>, sens: &Readings, out: &mut Vec<String>) {
    let digits = |s: String, out: &mut Vec<String>| {
        for c in s.chars() {
            out.push(format!("d{c}"));
        }
    };
    let h12 = match now.hour() % 12 {
        0 => 12,
        h => h,
    };
    for p in pieces {
        if let Some(l) = &p.lit {
            out.push(l.clone());
            continue;
        }
        let Some(tok) = p.tok.as_deref() else { continue };
        match tok {
            "HH" => digits(format!("{:02}", now.hour()), out),
            "H" => digits(now.hour().to_string(), out),
            "hh" => digits(format!("{h12:02}"), out),
            "h" => digits(h12.to_string(), out),
            "mm" => digits(format!("{:02}", now.minute()), out),
            "ss" => digits(format!("{:02}", now.second()), out),
            "DD" => digits(format!("{:02}", now.day()), out),
            "D" => digits(now.day().to_string(), out),
            "MM" => digits(format!("{:02}", now.month()), out),
            "M" => digits(now.month().to_string(), out),
            "YYYY" => digits(now.year().to_string(), out),
            "YY" => digits(format!("{:02}", now.year() % 100), out),
            "dddd" => out.push(format!("wd{}", now.weekday().num_days_from_sunday())),
            "ddd" => out.push(format!("ws{}", now.weekday().num_days_from_sunday())),
            "MMMM" => out.push(format!("mo{}", now.month0())),
            "MMM" => out.push(format!("ms{}", now.month0())),
            "A" => out.push(if now.hour() < 12 { "am" } else { "pm" }.into()),
            t if sensors::NAMES.contains(&t) => {
                match sens.get(t) {
                    Some(t) => digits(format!("{}", t.round().clamp(0.0, 999.0) as u32), out),
                    // sensor indisponível: "--"
                    None => out.extend(["dash".to_string(), "dash".to_string()]),
                }
            }
            _ => {}
        }
    }
}

/// O template usa algum token de sensor?
pub fn uses_sensors(pieces: &[Piece]) -> bool {
    pieces.iter().any(|p| p.tok.as_deref().is_some_and(|t| sensors::NAMES.contains(&t)))
}

/// Gira o buffer RGB final (0, 90, 180 ou 270 graus, sentido horário).
pub fn rotate_rgb(src: &[u8], dst: &mut [u8], deg: u16) {
    let n = SIZE;
    for y in 0..n {
        for x in 0..n {
            let (sx, sy) = match deg {
                90 => (y, n - 1 - x),
                180 => (n - 1 - x, n - 1 - y),
                270 => (n - 1 - y, x),
                _ => (x, y),
            };
            let s = (sy * n + sx) * 3;
            let d = (y * n + x) * 3;
            dst[d..d + 3].copy_from_slice(&src[s..s + 3]);
        }
    }
}

/// Codifica em JPEG e baixa a qualidade até caber no limite de 64 KB do comando DRA.
pub fn encode_jpeg(rgb: &[u8], quality: u8) -> Result<Vec<u8>, String> {
    let mut q = quality;
    loop {
        let mut buf = Vec::with_capacity(64 * 1024);
        jpeg_encoder::Encoder::new(&mut buf, q)
            .encode(rgb, SIZE as u16, SIZE as u16, jpeg_encoder::ColorType::Rgb)
            .map_err(|e| e.to_string())?;
        if buf.len() <= MAX_JPEG || q <= 10 {
            return Ok(buf);
        }
        q = q.saturating_sub(10).max(10);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn tokens() {
        let now = Local.with_ymd_and_hms(2026, 3, 8, 21, 5, 9).unwrap(); // domingo
        let pieces: Vec<Piece> = serde_json::from_str(
            r#"[{"tok":"HH"},{"lit":"l0"},{"tok":"mm"},{"tok":"dddd"},{"tok":"MMM"},{"tok":"h"},{"tok":"A"}]"#,
        )
        .unwrap();
        let mut out = Vec::new();
        let sens = Readings { cpu_temp: Some(57.6), gpu_hot: None, gpu_temp: Some(9.0), ..Default::default() };
        resolve(&pieces, &now, &sens, &mut out);
        assert_eq!(out, ["d2", "d1", "l0", "d0", "d5", "wd0", "ms2", "d9", "pm"]);

        let pieces: Vec<Piece> =
            serde_json::from_str(r#"[{"tok":"cpuTemp"},{"lit":"l1"},{"tok":"gpuHot"},{"tok":"gpuTemp"}]"#).unwrap();
        out.clear();
        resolve(&pieces, &now, &sens, &mut out);
        assert_eq!(out, ["d5", "d8", "l1", "dash", "dash", "d9"]);
        assert!(uses_sensors(&pieces));
    }

    #[test]
    fn rotacao_sentido_horario() {
        let mut src = vec![0u8; RGB_LEN];
        src[..3].copy_from_slice(&[255, 0, 0]); // pixel vermelho no canto superior esquerdo
        let mut dst = vec![0u8; RGB_LEN];
        let at = |x: usize, y: usize| (y * SIZE + x) * 3;
        rotate_rgb(&src, &mut dst, 90);
        assert_eq!(dst[at(SIZE - 1, 0)], 255, "90°: vai para o canto superior direito");
        rotate_rgb(&src, &mut dst, 180);
        assert_eq!(dst[at(SIZE - 1, SIZE - 1)], 255);
        rotate_rgb(&src, &mut dst, 270);
        assert_eq!(dst[at(0, SIZE - 1)], 255);
    }

    #[test]
    fn jpeg_cabe_no_limite() {
        // ruído é o pior caso para o JPEG
        let mut rgb = vec![0u8; RGB_LEN];
        let mut s = 1u32;
        for v in rgb.iter_mut() {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            *v = s as u8;
        }
        let j = encode_jpeg(&rgb, 95).unwrap();
        assert!(j.len() <= MAX_JPEG, "{}", j.len());
    }
}
