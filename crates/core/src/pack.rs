//! Leitor mínimo de ZIP. O editor grava o `.dvtheme` sem compressão (método 0), já que
//! JPEG, PNG e vídeo não comprimem; assim basta ler o diretório central e fatiar o buffer.

use std::collections::HashMap;

pub struct Pack {
    data: Vec<u8>,
    entries: HashMap<String, (usize, usize)>,
}

fn u16_at(b: &[u8], o: usize) -> usize {
    u16::from_le_bytes([b[o], b[o + 1]]) as usize
}

fn u32_at(b: &[u8], o: usize) -> usize {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) as usize
}

impl Pack {
    pub fn parse(data: Vec<u8>) -> Result<Pack, String> {
        let bad = || "arquivo de tema inválido (ZIP corrompido)".to_string();
        if data.len() < 22 {
            return Err(bad());
        }
        let min = data.len().saturating_sub(22 + 0xFFFF);
        let eocd = (min..=data.len() - 22)
            .rev()
            .find(|&i| data[i..i + 4] == [0x50, 0x4b, 0x05, 0x06])
            .ok_or_else(bad)?;
        let count = u16_at(&data, eocd + 10);
        let mut p = u32_at(&data, eocd + 16);
        let mut entries = HashMap::with_capacity(count);
        for _ in 0..count {
            if p + 46 > data.len() || data[p..p + 4] != [0x50, 0x4b, 0x01, 0x02] {
                return Err(bad());
            }
            let method = u16_at(&data, p + 10);
            let size = u32_at(&data, p + 20);
            let (n, e, c) = (u16_at(&data, p + 28), u16_at(&data, p + 30), u16_at(&data, p + 32));
            let local = u32_at(&data, p + 42);
            let name = String::from_utf8_lossy(&data[p + 46..p + 46 + n]).into_owned();
            p += 46 + n + e + c;
            if name.ends_with('/') {
                continue;
            }
            if method != 0 {
                return Err(format!("'{name}' está comprimido; regrave o tema pelo editor"));
            }
            if local + 30 > data.len() {
                return Err(bad());
            }
            let start = local + 30 + u16_at(&data, local + 26) + u16_at(&data, local + 28);
            if start + size > data.len() {
                return Err(bad());
            }
            entries.insert(name, (start, size));
        }
        Ok(Pack { data, entries })
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.entries.get(name).map(|&(s, n)| &self.data[s..s + n])
    }
}
