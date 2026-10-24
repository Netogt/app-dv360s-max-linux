//! Núcleo do DV360S Studio: protocolo do display, leitura do `.dvtheme` e renderização.
//!
//! O display (HOTSPOTEK USB HID, VID 1800 / PID 3008) recebe JPEGs 480x480 por um endpoint
//! interrupt OUT, em pacotes de 1024 bytes. Ver `dv360s-max/Engenharia-reversa-water-coole.md`.

pub mod device;
pub mod library;
pub mod live;
pub mod pack;
pub mod paths;
pub mod protocol;
pub mod render;
pub mod rules;
pub mod sensors;
pub mod service;
pub mod theme;

/// Lado da tela em pixels (a tela é quadrada).
pub const SIZE: usize = 480;
