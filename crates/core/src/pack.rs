//! ZIP mínimo. O editor grava o `.dvtheme` sem compressão (método 0), já que JPEG, PNG e vídeo
//! não comprimem; assim basta ler o diretório central e fatiar o buffer.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

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

fn bad() -> String {
    "arquivo de tema inválido (ZIP corrompido)".to_string()
}

struct Entry {
    name: String,
    size: usize,
    /// posição do cabeçalho local
    local: usize,
}

/// Fim do diretório central dentro de `tail` (os últimos bytes do arquivo).
fn find_eocd(tail: &[u8]) -> Result<usize, String> {
    if tail.len() < 22 {
        return Err(bad());
    }
    (0..=tail.len() - 22).rev().find(|&i| tail[i..i + 4] == [0x50, 0x4b, 0x05, 0x06]).ok_or_else(bad)
}

fn parse_central(cd: &[u8], count: usize) -> Result<Vec<Entry>, String> {
    let mut out = Vec::with_capacity(count);
    let mut p = 0;
    for _ in 0..count {
        if p + 46 > cd.len() || cd[p..p + 4] != [0x50, 0x4b, 0x01, 0x02] {
            return Err(bad());
        }
        let method = u16_at(cd, p + 10);
        let size = u32_at(cd, p + 20);
        let (n, e, c) = (u16_at(cd, p + 28), u16_at(cd, p + 30), u16_at(cd, p + 32));
        let local = u32_at(cd, p + 42);
        if p + 46 + n > cd.len() {
            return Err(bad());
        }
        let name = String::from_utf8_lossy(&cd[p + 46..p + 46 + n]).into_owned();
        p += 46 + n + e + c;
        if name.ends_with('/') {
            continue;
        }
        if method != 0 {
            return Err(format!("'{name}' está comprimido; regrave o tema pelo editor"));
        }
        out.push(Entry { name, size, local });
    }
    Ok(out)
}

impl Pack {
    pub fn parse(data: Vec<u8>) -> Result<Pack, String> {
        let min = data.len().saturating_sub(22 + 0xFFFF);
        let eocd = min + find_eocd(&data[min..])?;
        let count = u16_at(&data, eocd + 10);
        let cd = u32_at(&data, eocd + 16);
        if cd > eocd {
            return Err(bad());
        }
        let mut entries = HashMap::with_capacity(count);
        for e in parse_central(&data[cd..eocd], count)? {
            if e.local + 30 > data.len() {
                return Err(bad());
            }
            let start = e.local + 30 + u16_at(&data, e.local + 26) + u16_at(&data, e.local + 28);
            if start + e.size > data.len() {
                return Err(bad());
            }
            entries.insert(e.name, (start, e.size));
        }
        Ok(Pack { data, entries })
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.entries.get(name).map(|&(s, n)| &self.data[s..s + n])
    }
}

/// Lê do disco só as entradas escolhidas (sem carregar o arquivo inteiro: um tema com vídeo
/// pode ter centenas de MB, e a biblioteca só precisa do manifest e da miniatura).
pub fn read_entries(path: &Path, wanted: impl Fn(&str) -> bool) -> Result<Vec<(String, Vec<u8>)>, String> {
    let io = |e: std::io::Error| e.to_string();
    let mut f = File::open(path).map_err(io)?;
    let len = f.metadata().map_err(io)?.len() as usize;
    let tail_len = len.min(22 + 0xFFFF);
    let mut tail = vec![0u8; tail_len];
    f.seek(SeekFrom::Start((len - tail_len) as u64)).map_err(io)?;
    f.read_exact(&mut tail).map_err(io)?;
    let eocd = find_eocd(&tail)?;
    let count = u16_at(&tail, eocd + 10);
    let cd_size = u32_at(&tail, eocd + 12);
    let cd_off = u32_at(&tail, eocd + 16);
    if cd_off + cd_size > len {
        return Err(bad());
    }
    let mut cd = vec![0u8; cd_size];
    f.seek(SeekFrom::Start(cd_off as u64)).map_err(io)?;
    f.read_exact(&mut cd).map_err(io)?;
    let mut out = Vec::new();
    for e in parse_central(&cd, count)? {
        if !wanted(&e.name) {
            continue;
        }
        let mut head = [0u8; 30];
        f.seek(SeekFrom::Start(e.local as u64)).map_err(io)?;
        f.read_exact(&mut head).map_err(io)?;
        let skip = u16_at(&head, 26) + u16_at(&head, 28);
        f.seek(SeekFrom::Current(skip as i64)).map_err(io)?;
        let mut data = vec![0u8; e.size];
        f.read_exact(&mut data).map_err(io)?;
        out.push((e.name, data));
    }
    Ok(out)
}

fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let t = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *v = c;
        }
        t
    });
    !data.iter().fold(!0u32, |c, &b| t[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8))
}

/// Grava um ZIP sem compressão (o mesmo formato que o editor gera).
pub fn write_stored(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    let total: usize = entries.iter().map(|(n, d)| 30 + 46 + 2 * n.len() + d.len()).sum();
    let mut out = Vec::with_capacity(total + 22);
    let mut central = Vec::new();
    for (name, data) in entries {
        let crc = crc32(data).to_le_bytes();
        let size = (data.len() as u32).to_le_bytes();
        let nlen = (name.len() as u16).to_le_bytes();
        let local = (out.len() as u32).to_le_bytes();
        // cabeçalho local: versão 10, sem flags, método 0, data/hora zeradas
        out.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        out.extend_from_slice(&crc);
        out.extend_from_slice(&size);
        out.extend_from_slice(&size);
        out.extend_from_slice(&nlen);
        out.extend_from_slice(&[0, 0]);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);

        central.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02, 20, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        central.extend_from_slice(&crc);
        central.extend_from_slice(&size);
        central.extend_from_slice(&size);
        central.extend_from_slice(&nlen);
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&local);
        central.extend_from_slice(name.as_bytes());
    }
    let cd_off = (out.len() as u32).to_le_bytes();
    let cd_size = (central.len() as u32).to_le_bytes();
    let count = (entries.len() as u16).to_le_bytes();
    out.extend_from_slice(&central);
    out.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    out.extend_from_slice(&count);
    out.extend_from_slice(&count);
    out.extend_from_slice(&cd_size);
    out.extend_from_slice(&cd_off);
    out.extend_from_slice(&[0, 0]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let entries = vec![("manifest.json".to_string(), b"{}".to_vec()), ("render/a.jpg".to_string(), vec![1, 2, 3])];
        let zip = write_stored(&entries);
        let p = Pack::parse(zip.clone()).unwrap();
        assert_eq!(p.get("render/a.jpg"), Some(&[1u8, 2, 3][..]));
        let tmp = std::env::temp_dir().join(format!("dv360s-pack-{}.zip", std::process::id()));
        std::fs::write(&tmp, &zip).unwrap();
        let got = read_entries(&tmp, |n| n == "manifest.json").unwrap();
        std::fs::remove_file(&tmp).unwrap();
        assert_eq!(got, vec![("manifest.json".to_string(), b"{}".to_vec())]);
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }
}
