//! Montagem dos pacotes. Todo comando começa com `CRT\0\0` + 3 letras ASCII e é
//! preenchido com zeros até um múltiplo de 1024 bytes.

pub const VID: u16 = 0x1800;
pub const PID: u16 = 0x3008;
pub const EP_OUT: u8 = 0x01;
pub const PKT: usize = 1024;
/// O campo de tamanho do DRA tem 2 bytes: cabeçalho (32) + JPEG precisa caber em 0xFFFF.
pub const MAX_JPEG: usize = 0xFFFF - 32;

fn pad(mut b: Vec<u8>) -> Vec<u8> {
    let rest = (PKT - b.len() % PKT) % PKT;
    b.resize(b.len() + rest, 0);
    b
}

pub fn cmd(name: &[u8], rest: &[u8]) -> Vec<u8> {
    let mut b = b"CRT\0\0".to_vec();
    b.extend_from_slice(name);
    b.extend_from_slice(rest);
    pad(b)
}

/// Abre a sessão (arma o watchdog de ~11 s).
pub fn dis() -> Vec<u8> {
    cmd(b"DIS", b"")
}

/// Brilho 1-100 (o piso real é ~10; 0 não apaga a tela).
pub fn lig(brightness: u8) -> Vec<u8> {
    cmd(b"LIG", &[0, 0, brightness.clamp(1, 100)])
}

/// Keep-alive de 1 pacote.
pub fn connect() -> Vec<u8> {
    cmd(b"CONNECT", b"")
}

/// Fim de sessão limpo: a tela volta ao logo sem reiniciar o dispositivo.
pub fn cle() -> Vec<u8> {
    cmd(b"CLE", b"\0\0DC")
}

/// Comando DRA com um JPEG 480x480 completo.
pub fn draw(jpeg: &[u8]) -> Result<Vec<u8>, String> {
    if jpeg.len() > MAX_JPEG {
        return Err(format!("JPEG de {} bytes passa do limite de {MAX_JPEG}", jpeg.len()));
    }
    let total = (32 + jpeg.len()) as u16;
    let mut b = Vec::with_capacity(32 + jpeg.len() + PKT);
    b.extend_from_slice(b"CRT\0\0DRA\0\0");
    b.extend_from_slice(&total.to_be_bytes());
    b.push(0xB1); // ignorado pelo firmware; mantido igual ao software original
    b.resize(32, 0);
    b.extend_from_slice(jpeg);
    Ok(pad(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pacotes_iguais_ao_python() {
        let c = connect();
        assert_eq!(c.len(), 1024);
        assert_eq!(&c[..12], b"CRT\0\0CONNECT");
        assert_eq!(&cle()[..12], b"CRT\0\0CLE\0\0DC");
        assert_eq!(&lig(150)[..11], b"CRT\0\0LIG\0\0\x64");

        let jpg = vec![0xAB; 4227];
        let d = draw(&jpg).unwrap();
        assert_eq!(&d[..13], b"CRT\0\0DRA\0\0\x10\xa3\xb1");
        assert_eq!(d.len(), 5 * 1024);
        assert_eq!(&d[32..32 + 4227], &jpg[..]);
    }
}
