//! Transporte USB (libusb). Desvincula o `usbhid` e escreve direto no endpoint 0x01,
//! como o `dv360s.py`.

use std::time::{Duration, Instant};

use rusb::{Context, DeviceHandle, UsbContext};

use crate::protocol::{self, EP_OUT, PID, PKT, VID};

/// Qualquer comando zera o watchdog (~11 s); 4 s dá folga.
pub const KEEPALIVE: Duration = Duration::from_secs(4);
const WRITE_TIMEOUT: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DevError {
    NotFound,
    NoPermission,
    Busy,
    Usb(String),
}

impl std::fmt::Display for DevError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DevError::NotFound => write!(f, "cooler 1800:3008 não encontrado"),
            DevError::NoPermission => write!(f, "sem permissão no USB (instale a regra udev)"),
            DevError::Busy => write!(f, "dispositivo em uso por outro programa"),
            DevError::Usb(e) => write!(f, "erro USB: {e}"),
        }
    }
}

impl From<rusb::Error> for DevError {
    fn from(e: rusb::Error) -> Self {
        match e {
            rusb::Error::Access => DevError::NoPermission,
            rusb::Error::NoDevice | rusb::Error::NotFound => DevError::NotFound,
            rusb::Error::Busy => DevError::Busy,
            e => DevError::Usb(e.to_string()),
        }
    }
}

/// O cooler aparece no barramento? (não abre o dispositivo)
pub fn present() -> bool {
    let Ok(ctx) = Context::new() else { return false };
    let Ok(list) = ctx.devices() else { return false };
    list.iter().any(|d| {
        d.device_descriptor()
            .map(|dd| dd.vendor_id() == VID && dd.product_id() == PID)
            .unwrap_or(false)
    })
}

pub struct Display {
    ctx: Option<Context>,
    handle: Option<DeviceHandle<Context>>,
    last_tx: Instant,
    brightness: u8,
}

impl Display {
    pub fn new(brightness: u8) -> Self {
        Display { ctx: Context::new().ok(), handle: None, last_tx: Instant::now(), brightness }
    }

    pub fn is_open(&self) -> bool {
        self.handle.is_some()
    }

    /// Abre o dispositivo e inicia a sessão (DIS + LIG).
    pub fn open(&mut self) -> Result<(), DevError> {
        if self.ctx.is_none() {
            self.ctx = Some(Context::new()?);
        }
        let ctx = self.ctx.as_ref().unwrap();
        let dev = ctx
            .devices()?
            .iter()
            .find(|d| {
                d.device_descriptor()
                    .map(|dd| dd.vendor_id() == VID && dd.product_id() == PID)
                    .unwrap_or(false)
            })
            .ok_or(DevError::NotFound)?;
        let h = dev.open()?;
        if h.kernel_driver_active(0).unwrap_or(false) {
            let _ = h.detach_kernel_driver(0);
        }
        // já vem configurado na maioria das vezes; o pyusb faz o mesmo set_configuration()
        let _ = h.set_active_configuration(1);
        h.claim_interface(0)?;
        self.handle = Some(h);
        self.write(&protocol::dis())?;
        self.write(&protocol::lig(self.brightness))?;
        Ok(())
    }

    fn write(&mut self, data: &[u8]) -> Result<(), DevError> {
        let h = self.handle.as_ref().ok_or(DevError::NotFound)?;
        for chunk in data.chunks(PKT) {
            if let Err(e) = h.write_interrupt(EP_OUT, chunk, WRITE_TIMEOUT) {
                // o dispositivo reinicia quando o watchdog estoura: descarta o handle
                self.handle = None;
                return Err(e.into());
            }
        }
        self.last_tx = Instant::now();
        Ok(())
    }

    pub fn send_jpeg(&mut self, jpeg: &[u8]) -> Result<(), DevError> {
        let pkt = protocol::draw(jpeg).map_err(DevError::Usb)?;
        self.write(&pkt)
    }

    pub fn keepalive_due(&self) -> bool {
        self.last_tx.elapsed() >= KEEPALIVE
    }

    pub fn keepalive(&mut self) -> Result<(), DevError> {
        self.write(&protocol::connect())
    }

    pub fn set_brightness(&mut self, b: u8) -> Result<(), DevError> {
        self.brightness = b;
        if self.is_open() {
            self.write(&protocol::lig(b))?;
        }
        Ok(())
    }

    /// CLE (volta ao logo) e libera a interface. Não devolve o `usbhid`: no Linux esse
    /// rebind coincidiu com a tela apagando.
    pub fn close(&mut self) {
        if self.handle.is_some() {
            let _ = self.write(&protocol::cle());
        }
        if let Some(h) = self.handle.take() {
            let _ = h.release_interface(0);
        }
    }
}

impl Drop for Display {
    fn drop(&mut self) {
        self.close();
    }
}
