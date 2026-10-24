//! Prévia ao vivo: enquanto o editor está espelhando, ele manda quadros prontos ao player por um
//! socket Unix de datagramas (um quadro cabe num datagrama: JPEG ≤ 64 KB). O player mostra esses
//! quadros no lugar do tema e volta ao tema sozinho se o editor parar de mandar.

use std::os::unix::net::UnixDatagram;
use std::time::Duration;

use crate::paths;

/// Mensagens: 'F' + JPEG (quadro), 'P' (continua ao vivo, nada mudou), 'E' (fim).
pub const FRAME: u8 = b'F';
pub const PING: u8 = b'P';
pub const END: u8 = b'E';

/// Sem notícias do editor por esse tempo, o player volta ao tema.
pub const TIMEOUT: Duration = Duration::from_secs(3);

pub fn send(kind: u8, payload: &[u8]) -> Result<(), String> {
    let sock = UnixDatagram::unbound().map_err(|e| e.to_string())?;
    let mut msg = Vec::with_capacity(payload.len() + 1);
    msg.push(kind);
    msg.extend_from_slice(payload);
    sock.send_to(&msg, paths::live_socket()).map(|_| ()).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => "o player não está rodando".to_string(),
        _ => e.to_string(),
    })
}

/// Lado do player.
pub fn bind() -> std::io::Result<UnixDatagram> {
    let path = paths::live_socket();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let _ = std::fs::remove_file(&path);
    UnixDatagram::bind(&path)
}
