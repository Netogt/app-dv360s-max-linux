//! Avaliação das condições das telas. A mesma lógica existe no editor
//! (`src/render/rules.ts`) para mostrar qual tela vale agora.

use chrono::{DateTime, Datelike, Local, Timelike};

use crate::sensors::Readings;
use crate::theme::Rule;


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

/// `margin`: folga das condições de sensor (só para a tela que já está ativa, para ela não
/// ficar alternando quando o valor oscila no limite). Os valores são comparados arredondados,
/// como aparecem na tela: "≥ 60" deixa de valer quando mostra 59.
pub fn rule_ok(r: &Rule, now: &DateTime<Local>, sens: &Readings, margin: f32) -> bool {
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
            let v = v.round();
            match op.as_str() {
                "<=" => v <= value + margin,
                _ => v >= value - margin,
            }
        }
    }
}

/// Uma tela sem condições nunca aparece sozinha (só a principal é o padrão).
pub fn screen_ok(rules: &[Rule], any: bool, now: &DateTime<Local>, sens: &Readings, margin: f32) -> bool {
    if rules.is_empty() {
        return false;
    }
    if any {
        rules.iter().any(|r| rule_ok(r, now, sens, margin))
    } else {
        rules.iter().all(|r| rule_ok(r, now, sens, margin))
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
        assert!(rule_ok(&t("22:00", "06:00"), &at(23, 30), &s, 0.0));
        assert!(rule_ok(&t("22:00", "06:00"), &at(5, 59), &s, 0.0));
        assert!(!rule_ok(&t("22:00", "06:00"), &at(6, 0), &s, 0.0));
        assert!(!rule_ok(&t("22:00", "06:00"), &at(12, 0), &s, 0.0));
        assert!(rule_ok(&t("08:00", "18:00"), &at(8, 0), &s, 0.0));
        assert!(!rule_ok(&t("08:00", "18:00"), &at(18, 0), &s, 0.0));
    }

    #[test]
    fn periodo_do_ano_e_dia_da_semana() {
        let s = Readings::default();
        let natal = Rule::Date { from: "12-15".into(), to: "01-06".into() };
        assert!(rule_ok(&natal, &Local.with_ymd_and_hms(2026, 12, 25, 12, 0, 0).unwrap(), &s, 0.0));
        assert!(rule_ok(&natal, &Local.with_ymd_and_hms(2027, 1, 6, 12, 0, 0).unwrap(), &s, 0.0));
        assert!(!rule_ok(&natal, &Local.with_ymd_and_hms(2026, 10, 23, 12, 0, 0).unwrap(), &s, 0.0));
        let fds = Rule::Weekday { days: vec![0, 6] };
        assert!(rule_ok(&fds, &Local.with_ymd_and_hms(2026, 10, 24, 12, 0, 0).unwrap(), &s, 0.0)); // sábado
        assert!(!rule_ok(&fds, &Local.with_ymd_and_hms(2026, 10, 23, 12, 0, 0).unwrap(), &s, 0.0)); // sexta
    }

    #[test]
    fn sensor_arredondado_e_folga() {
        let now = Local::now();
        let quente = Rule::Sensor { sensor: "gpuHot".into(), op: ">=".into(), value: 60.0 };
        let s = |v| Readings { gpu_hot: Some(v), ..Default::default() };
        assert!(!rule_ok(&quente, &now, &s(59.4), 0.0)); // aparece 59
        assert!(rule_ok(&quente, &now, &s(59.6), 0.0)); // aparece 60
        assert!(rule_ok(&quente, &now, &s(60.0), 0.0));
        // com folga de 2: só sai quando mostrar 57
        assert!(rule_ok(&quente, &now, &s(58.0), 2.0));
        assert!(!rule_ok(&quente, &now, &s(57.0), 2.0));
        // sensor ausente nunca vale
        assert!(!rule_ok(&quente, &now, &Readings::default(), 0.0));
    }
}
