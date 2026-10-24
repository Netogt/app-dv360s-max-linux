// Telas condicionais: abas acima do palco e o editor de condições no painel direito.

import { useCallback, useEffect, useRef, useState } from "react";
import { background, cloneLayers, newRule, screen, SCREEN_PRESETS } from "../defaults";
import { liveReadings, realReadings, setSimulated, useSimulated, watchSensors } from "../render/sensors";
import { activeScreen, describeRule, MONTHS, ruleOk, rulesUseSensors, SENSOR_INFO, WEEKDAYS } from "../render/rules";
import { addScreen, curScreen, moveScreen, removeScreen, selectScreen, store, updateScreen, useStore } from "../store";
import type { Rule, RuleType, Screen, SensorName } from "../types";
import { NumberField, Row, Section, Segmented, Select, Slider, Toggle, useDismiss } from "./controls";
import { toast } from "./feedback";
import { IconCalendar, IconClock, IconMore, IconPlus, IconThermometer, IconTrash, IconX } from "./icons";

/** Reavalia as condições com o relógio (a cada 15 s) e com os sensores (quando mudam). */
function useNow() {
  const [, tick] = useState(0);
  useSimulated();
  const usesSensors = useStore((s) => rulesUseSensors(s.project));
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    const off = usesSensors ? watchSensors(() => tick((n) => n + 1)) : undefined;
    return () => {
      clearInterval(t);
      off?.();
    };
  }, [usesSensors]);
  return { now: new Date(), sens: liveReadings() };
}

/** Exclui com aviso (Ctrl Z desfaz). */
function deleteScreen(sc: Screen, isMain: boolean) {
  removeScreen(sc.id);
  toast(isMain ? `Tela “${sc.name}” excluída; a seguinte virou a principal (Ctrl Z desfaz)` : `Tela “${sc.name}” excluída (Ctrl Z desfaz)`);
}

function ruleIcon(t: RuleType) {
  return t === "sensor" ? <IconThermometer size={12} /> : t === "time" ? <IconClock size={12} /> : <IconCalendar size={12} />;
}

function Menu({ button, children, align = "left" }: {
  button: (open: boolean, toggle: () => void) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div className="popover-anchor" ref={ref}>
      {button(open, () => setOpen(!open))}
      {open && (
        <div className="menu" role="menu" style={align === "right" ? { left: "auto", right: 0 } : undefined}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function ScreenTabs() {
  const screens = useStore((s) => s.project.screens);
  const screenId = useStore((s) => s.screenId);
  const project = useStore((s) => s.project);
  const { now, sens } = useNow();
  const live = activeScreen(project, now, sens);
  const cur = curScreen(store.get());
  const curIndex = screens.findIndex((s) => s.id === cur.id);

  const create = (name: string, rules: Rule[], copy: boolean) => {
    const base = copy ? cloneLayers(cur.layers) : [background()];
    // nomes únicos: "Noite", "Noite 2"...
    let n = name;
    for (let i = 2; screens.some((s) => s.name === n); i++) n = `${name} ${i}`;
    addScreen(screen(n, base, rules));
  };

  return (
    <div className="screen-tabs">
      {/* só a lista rola; os menus ficam fora dela para não serem cortados */}
      <div className="screen-tab-list" role="tablist" aria-label="Telas">
      {screens.map((sc, i) => (
        <button
          key={sc.id}
          type="button"
          role="tab"
          aria-selected={sc.id === screenId}
          className={`screen-tab ${sc.id === screenId ? "on" : ""}`}
          onClick={() => selectScreen(sc.id)}
          title={
            i === 0
              ? "Tela principal: aparece quando nenhuma outra vale"
              : sc.rules.length
                ? sc.rules.map(describeRule).join(sc.any ? " ou " : " e ")
                : "Sem condição: esta tela nunca aparece"
          }
        >
          {live === i && <span className="live-dot" title="É esta que vale agora" />}
          <span className="screen-tab-name">{sc.name}</span>
          {i > 0 && (
            <span className="screen-tab-rules">
              {sc.rules.length ? [...new Set(sc.rules.map((r) => r.type))].map((t) => <span key={t}>{ruleIcon(t)}</span>) : "—"}
            </span>
          )}
          {screens.length > 1 && (
            <span
              role="button"
              tabIndex={-1}
              className="screen-tab-close"
              title="Excluir esta tela"
              aria-label={`Excluir a tela ${sc.name}`}
              onClick={(e) => {
                e.stopPropagation();
                deleteScreen(sc, i === 0);
              }}
            >
              <IconX size={12} />
            </span>
          )}
        </button>
      ))}
      </div>

      <Menu
        button={(open, toggle) => (
          <button type="button" className={`icon-btn ${open ? "active" : ""}`} onClick={toggle} title="Nova tela condicional" aria-haspopup="menu">
            <IconPlus size={15} />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-caption">Nova tela (começa como cópia de “{cur.name}”)</div>
            <div className="menu-group">
              {SCREEN_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    create(p.name, p.rules(), true);
                  }}
                >
                  <span className="menu-icon">{ruleIcon(p.rules()[0].type)}</span>
                  <span className="menu-label">{p.label}</span>
                  <span className="menu-hint">{p.hint}</span>
                </button>
              ))}
            </div>
            <div className="menu-group">
              <button type="button" role="menuitem" className="menu-item" onClick={() => (close(), create("Nova tela", [], false))}>
                <span className="menu-icon"><IconPlus size={14} /></span>
                <span className="menu-label">Tela em branco</span>
                <span className="menu-hint">sem condição</span>
              </button>
            </div>
          </>
        )}
      </Menu>

      {screens.length > 1 && (
        <Menu
          align="right"
          button={(open, toggle) => (
            <button type="button" className={`icon-btn ${open ? "active" : ""}`} onClick={toggle} title="Opções da tela" aria-haspopup="menu">
              <IconMore size={15} />
            </button>
          )}
        >
          {(close) => (
            <div className="menu-group">
              {curIndex > 0 && (
                <>
                  <button type="button" className="menu-item" onClick={() => (close(), create(cur.name, structuredClone(cur.rules), true))}>
                    Duplicar tela
                  </button>
                  <button type="button" className="menu-item" disabled={curIndex <= 1} onClick={() => (close(), moveScreen(cur.id, -1))}>
                    ← Aumentar prioridade
                  </button>
                  <button type="button" className="menu-item" disabled={curIndex >= screens.length - 1} onClick={() => (close(), moveScreen(cur.id, 1))}>
                    Diminuir prioridade →
                  </button>
                </>
              )}
              <button type="button" className="menu-item danger" onClick={() => (close(), deleteScreen(cur, curIndex === 0))}>
                Excluir tela “{cur.name}”
              </button>
            </div>
          )}
        </Menu>
      )}
    </div>
  );
}

// ---------- editor de condições ----------

const SENSORS = Object.entries(SENSOR_INFO).map(([value, i]) => ({ value: value as SensorName, label: i.label }));
const MONTH_OPTS = MONTHS.map((m, i) => ({ value: i + 1, label: m }));

function MonthDay({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [m, d] = value.split("-").map(Number);
  const set = (mm: number, dd: number) => onChange(`${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  return (
    <div className="month-day">
      <NumberField value={d} min={1} max={31} onChange={(v) => set(m, v)} />
      <Select value={m} options={MONTH_OPTS} onChange={(v) => set(v, d)} />
    </div>
  );
}

function RuleEditor({ sc, r }: { sc: Screen; r: Rule }) {
  const { now, sens } = useNow();
  const set = (patch: Partial<Rule>) =>
    updateScreen(sc.id, (s) => ({ rules: s.rules.map((x) => (x.id === r.id ? ({ ...x, ...patch } as Rule) : x)) }), `${r.id}`);
  const remove = () => updateScreen(sc.id, (s) => ({ rules: s.rules.filter((x) => x.id !== r.id) }));
  const ok = ruleOk(r, now, sens);
  const title = { time: "Horário", weekday: "Dias da semana", date: "Época do ano", sensor: "Sensor" }[r.type];

  return (
    <div className={`rule ${ok ? "ok" : ""}`}>
      <div className="rule-head">
        <span className="with-icon">
          {ruleIcon(r.type)} {title}
        </span>
        <span className={`rule-state ${ok ? "ok" : ""}`}>{ok ? "vale agora" : "não vale agora"}</span>
        <button type="button" className="icon-btn ghost" onClick={remove} title="Remover condição">
          <IconX size={13} />
        </button>
      </div>
      {r.type === "time" && (
        <div className="rule-row">
          <input className="text" type="time" value={r.from} onChange={(e) => set({ from: e.currentTarget.value })} />
          <span className="muted">até</span>
          <input className="text" type="time" value={r.to} onChange={(e) => set({ to: e.currentTarget.value })} />
        </div>
      )}
      {r.type === "weekday" && (
        <div className="weekdays">
          {WEEKDAYS.map((w, i) => (
            <button
              key={w}
              type="button"
              className={`chip ${r.days.includes(i) ? "on" : ""}`}
              onClick={() => set({ days: r.days.includes(i) ? r.days.filter((d) => d !== i) : [...r.days, i].sort() })}
            >
              {w}
            </button>
          ))}
        </div>
      )}
      {r.type === "date" && (
        <div className="rule-row">
          <MonthDay value={r.from} onChange={(v) => set({ from: v })} />
          <span className="muted">até</span>
          <MonthDay value={r.to} onChange={(v) => set({ to: v })} />
        </div>
      )}
      {r.type === "sensor" && (
        <>
          <Select value={r.sensor} options={SENSORS} onChange={(v) => set({ sensor: v })} />
          <div className="rule-row">
            <Segmented
              value={r.op}
              onChange={(v) => set({ op: v })}
              options={[
                { value: ">=", label: "≥ maior ou igual" },
                { value: "<=", label: "≤ menor ou igual" },
              ]}
            />
          </div>
          <div className="rule-row">
            <NumberField value={r.value} min={0} max={SENSOR_INFO[r.sensor].max} suffix={SENSOR_INFO[r.sensor].unit} onChange={(v) => set({ value: v })} />
            <span className="muted small">
              agora: {sens[r.sensor] == null ? "sem leitura" : `${Math.round(sens[r.sensor]!)}${SENSOR_INFO[r.sensor].unit}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function ScreenSettings() {
  const sc = useStore((s) => curScreen(s));
  const isMain = useStore((s) => s.project.screens[0].id === sc.id);
  const priority = useStore((s) => s.project.screens.findIndex((x) => x.id === sc.id));
  const { now, sens } = useNow();
  const project = useStore((s) => s.project);
  const live = project.screens[activeScreen(project, now, sens)];
  const addRule = (t: RuleType) => updateScreen(sc.id, (s) => ({ rules: [...s.rules, newRule(t)] }));

  return (
    <Section title="Tela">
      <Row label="Nome">
        <input className="text" value={sc.name} onChange={(e) => updateScreen(sc.id, { name: e.currentTarget.value }, `${sc.id}:name`)} />
      </Row>
      {isMain ? (
        <p className="note">
          Aparece sempre que nenhuma tela condicional vale. Crie telas que aparecem por horário, dia, época do ano ou
          temperatura/uso no <strong>+</strong> acima do palco.
        </p>
      ) : (
        <>
          <Row label="Mostrar se">
            <Segmented
              value={sc.any ? "any" : "all"}
              onChange={(v) => updateScreen(sc.id, { any: v === "any" })}
              options={[
                { value: "all", label: "todas valem" },
                { value: "any", label: "qualquer uma" },
              ]}
            />
          </Row>
          {sc.rules.map((r) => (
            <RuleEditor key={r.id} sc={sc} r={r} />
          ))}
          {sc.rules.length === 0 && <p className="note warn">Sem condição esta tela nunca aparece. Adicione uma abaixo.</p>}
          <div className="btn-row">
            <span className="muted small">+ Condição:</span>
            <button type="button" className="btn small" onClick={() => addRule("time")}>Horário</button>
            <button type="button" className="btn small" onClick={() => addRule("weekday")}>Dias</button>
            <button type="button" className="btn small" onClick={() => addRule("date")}>Época</button>
            <button type="button" className="btn small" onClick={() => addRule("sensor")}>Sensor</button>
          </div>
          <p className="note">
            Prioridade {priority}: se mais de uma tela valer ao mesmo tempo, aparece a mais à esquerda. A tela sai assim que
            a condição deixa de valer (ajuste a folga em Tema).
          </p>
        </>
      )}
      <p className="note">
        Agora valeria: <strong>{live.name}</strong>
      </p>
      {project.screens.length > 1 && (
        <div className="btn-row">
          <button type="button" className="btn small danger-outline" onClick={() => deleteScreen(sc, isMain)}>
            <IconTrash size={13} /> Excluir esta tela
          </button>
        </div>
      )}
    </Section>
  );
}

/** Valores de mentira para testar telas por temperatura/uso (só no editor). */
export function SensorSimulator() {
  const sim = useSimulated();
  const usedByRules = useStore((s) => rulesUseSensors(s.project));
  const start = () => {
    const real = realReadings();
    const init: Partial<Record<SensorName, number>> = {};
    for (const k of Object.keys(SENSOR_INFO) as SensorName[]) init[k] = Math.round(real[k] ?? 50);
    setSimulated(init);
  };
  return (
    <Section title="Simular sensores" defaultOpen={usedByRules}>
      <Toggle checked={sim != null} onChange={(v) => (v ? start() : setSimulated(null))} label="Usar valores de teste" />
      {sim ? (
        <>
          {(Object.keys(SENSOR_INFO) as SensorName[]).map((k) => (
            <Row key={k} label={SENSOR_INFO[k].label}>
              <Slider
                value={sim[k] ?? 0}
                min={0}
                max={SENSOR_INFO[k].max}
                onChange={(v) => setSimulated({ ...sim, [k]: v })}
                format={(v) => `${v}${SENSOR_INFO[k].unit}`}
              />
            </Row>
          ))}
          <p className="note">
            Só no editor: a prévia, as abas e “Agora valeria” usam estes valores. O tema aplicado no cooler continua
            lendo os sensores reais; a prévia ao vivo mostra o que você vê aqui.
          </p>
        </>
      ) : (
        <p className="note">Teste as telas por temperatura ou uso sem precisar esquentar o PC.</p>
      )}
    </Section>
  );
}
