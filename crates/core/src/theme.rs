//! Formato do `manifest.json` dentro do `.dvtheme`.
//!
//! O editor "compila" o tema: tudo o que não muda com o relógio vira quadros prontos
//! (JPEG para a base opaca, PNG com alfa para camadas acima de um relógio). Hora e data
//! viram um atlas de sprites (dígitos, nomes de dias/meses, trechos literais) que o player
//! só precisa colar na posição certa — sem fonte nem rasterizador de texto no player.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const FORMAT: &str = "dv360s-theme";
/// v1: uma tela só (`segments`). v2: várias telas com condições (`screens`).
pub const VERSION: u32 = 2;

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub name: String,
    pub fps: f32,
    #[serde(default = "default_quality")]
    pub quality: u8,
    /// segundos mínimos numa tela antes de trocar de novo
    #[serde(default = "default_hold")]
    pub hold: f32,
    /// v1
    #[serde(default)]
    pub segments: Vec<SegmentSpec>,
    /// v2: `[0]` é a tela principal (vale quando nenhuma outra vale)
    #[serde(default)]
    pub screens: Vec<ScreenSpec>,
}

fn default_quality() -> u8 {
    85
}

fn default_hold() -> f32 {
    5.0
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSpec {
    pub name: String,
    /// true: basta uma condição; false: todas precisam valer
    #[serde(default)]
    pub any: bool,
    #[serde(default)]
    pub rules: Vec<Rule>,
    pub segments: Vec<SegmentSpec>,
}

/// Condição para uma tela aparecer.
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Rule {
    /// "HH:MM" até "HH:MM" (fim exclusivo; pode passar da meia-noite)
    Time { from: String, to: String },
    /// 0 = domingo ... 6 = sábado
    Weekday { days: Vec<u8> },
    /// "MM-DD" até "MM-DD" (inclusivo; pode virar o ano)
    Date { from: String, to: String },
    /// sensor: cpuTemp, gpuHot, gpuTemp, cpuUse, gpuUse, ramUse; op: ">=" ou "<="
    Sensor { sensor: String, op: String, value: f32 },
}

/// Camadas na ordem de desenho (de baixo para cima).
#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SegmentSpec {
    /// Sequência de quadros 480x480: `{dir}/00000.{ext}` ... Um quadro só = imagem fixa.
    #[serde(rename_all = "camelCase")]
    Frames { dir: String, count: usize, ext: String, opaque: bool },
    Text(TextSpec),
}

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextSpec {
    /// x, y, largura, altura (px da tela); a rotação é em torno do centro.
    #[serde(rename = "box")]
    pub bbox: [f32; 4],
    pub rotation: f32,
    pub opacity: f32,
    pub align: Align,
    pub atlas: String,
    pub sprite_height: u32,
    pub sprites: HashMap<String, Sprite>,
    pub pieces: Vec<Piece>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct Sprite {
    /// x, y, w, h no atlas
    pub r: [u32; 4],
    /// avanço horizontal do texto
    pub adv: f32,
    /// margem à esquerda (contorno/sombra) antes da origem do texto
    pub ox: f32,
}

/// Um trecho: um token de data/hora (`HH`, `mm`, `dddd`...) ou um literal (`l0`, `l1`...).
#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct Piece {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tok: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lit: Option<String>,
}
