//! Avaliação das condições das telas. A mesma lógica existe no editor
//! (`src/render/rules.ts`) para mostrar qual tela vale agora.

use chrono::{DateTime, Datelike, Local, Timelike};

use crate::sensors::Readings;
use crate::theme::Rule;

/// Folga das condições de sensor enquanto a tela já está ativa, para não ficar
/// alternando quando o valor oscila em torno do limite.
pub const HYSTERESIS: f32 = 2.0;

fn hhmm(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    Some(h.trim().parse::<u32>().ok()? % 24 * 60 + m.trim().parse::<u32>().ok()? % 60)
}

fn mmdd(s: &str) -> Option<u32> {
    let (m, d) = s.split_once('-')?;
    Some(m.trim().parse::<u32>().ok()? * 100 + d.trim().parse::<u32>().ok()?)
}

/// `v` está em [a, b] considerando que o intervalo pode dar a volta (ex.: 22h–6h, dez–jan).
fn in_wrapped(v: u32, a: u32, b: u32, end_inclusive: bool) -> bool {
    let before_end = if end_inclusive { v <= b } else { v < b };
    if a <= b {
        v >= a && before_end
    } else {
        v >= a || before_end
    }
}

pub fn rule_ok(r: &Rule, now: &DateTime<Local>, sens: &Readings, active: bool) -> bool {
    match r {
        Rule::Time { from, to } => match (hhmm(from), hhmm(to)) {
            (Some(a), Some(b)) if a == b => true, // o dia todo
            (Some(a), Some(b)) => in_wrapped(now.hour() * 60 + now.minute(), a, b, false),
            _ => false,
        },
        Rule::Weekday { days } => days.contains(&(now.weekday().num_days_from_sunday() as u8)),
        Rule::Date { from, to } => match (mmdd(from), mmdd(to)) {
            (Some(a), Some(b)) => in_wrapped(now.month() * 100 + now.day(), a, b, true),
            _ => false,
        },
        Rule::Sensor { sensor, op, value } => {
            let Some(v) = sens.get(sensor) else { return false };
            let h = if active { HYSTERESIS } else { 0.0 };
            match op.as_str() {
                "<=" => v <= value + h,
                _ => v >= value - h,
            }
        }
    }
}

/// Uma tela sem condições nunca aparece sozinha (só a principal é o padrão).
pub fn screen_ok(rules: &[Rule], any: bool, now: &DateTime<Local>, sens: &Readings, active: bool) -> bool {
    if rules.is_empty() {
        return false;
    }
    if any {
        rules.iter().any(|r| rule_ok(r, now, sens, active))
    } else {
        rules.iter().all(|r| rule_ok(r, now, sens, active))
    }
}

pub fn uses_sensors(rules: &[Rule]) -> bool {
    rules.iter().any(|r| matches!(r, Rule::Sensor { .. }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(from: &str, to: &str) -> Rule {
        Rule::Time { from: from.into(), to: to.into() }
    }

    #[test]
    fn horario_passando_da_meia_noite() {
        let s = Readings::default();
        let at = |h, m| Local.with_ymd_and_hms(2026, 10, 23, h, m, 0).unwrap();
        assert!(rule_ok(&t("22:00", "06:00"), &at(23, 30), &s, false));
        assert!(rule_ok(&t("22:00", "06:00"), &at(5, 59), &s, false));
        assert!(!rule_ok(&t("22:00", "06:00"), &at(6, 0), &s, false));
        assert!(!rule_ok(&t("22:00", "06:00"), &at(12, 0), &s, false));
        assert!(rule_ok(&t("08:00", "18:00"), &at(8, 0), &s, false));
        assert!(!rule_ok(&t("08:00", "18:00"), &at(18, 0), &s, false));
    }

    #[test]
    fn periodo_do_ano_e_dia_da_semana() {
        let s = Readings::default();
        let natal = Rule::Date { from: "12-15".into(), to: "01-06".into() };
        assert!(rule_ok(&natal, &Local.with_ymd_and_hms(2026, 12, 25, 12, 0, 0).unwrap(), &s, false));
        assert!(rule_ok(&natal, &Local.with_ymd_and_hms(2027, 1, 6, 12, 0, 0).unwrap(), &s, false));
        assert!(!rule_ok(&natal, &Local.with_ymd_and_hms(2026, 10, 23, 12, 0, 0).unwrap(), &s, false));
        let fds = Rule::Weekday { days: vec![0, 6] };
        assert!(rule_ok(&fds, &Local.with_ymd_and_hms(2026, 10, 24, 12, 0, 0).unwrap(), &s, false)); // sábado
        assert!(!rule_ok(&fds, &Local.with_ymd_and_hms(2026, 10, 23, 12, 0, 0).unwrap(), &s, false)); // sexta
    }

    #[test]
    fn sensor_com_folga() {
        let now = Local::now();
        let quente = Rule::Sensor { sensor: "gpuHot".into(), op: ">=".into(), value: 80.0 };
        let s = |v| Readings { gpu_hot: Some(v), ..Default::default() };
        assert!(!rule_ok(&quente, &now, &s(79.0), false));
        assert!(rule_ok(&quente, &now, &s(80.0), false));
        // já ativa: só sai abaixo de 78
        assert!(rule_ok(&quente, &now, &s(78.5), true));
        assert!(!rule_ok(&quente, &now, &s(77.5), true));
        // sensor ausente nunca vale
        assert!(!rule_ok(&quente, &now, &Readings::default(), false));
    }
}
