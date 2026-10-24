import { useCallback, useEffect, useRef, useState } from "react";
import { applyToScreen, saveDocument } from "../actions";
import { setLive, useLive } from "../live";
import { api, type PlayerConfig, type PlayerStatus } from "../io";
import { playerConfig, usePlayerConfig } from "../playerConfig";
import { store, useStore } from "../store";
import { Segmented, Slider, Toggle, useDismiss } from "./controls";
import { toast } from "./feedback";
import { IconAlert, IconCpu, IconFile, IconFolder, IconRedo, IconSave, IconSend, IconSun, IconUndo } from "./icons";
import { openLibrary } from "./Library";

type Tone = "ok" | "warn" | "off" | "error";

function describe(s: PlayerStatus | null): { tone: Tone; label: string; detail: string } {
  if (!s) return { tone: "off", label: "Verificando…", detail: "" };
  if (!s.playerFound) return { tone: "warn", label: "Player não encontrado", detail: "Compile com “npm run player” ou instale com scripts/install.sh." };
  switch (s.state) {
    case "playing":
      return { tone: "ok", label: "Na tela", detail: `Exibindo “${s.theme}”.` };
    case "no_permission":
      return { tone: "warn", label: "Sem permissão USB", detail: "O sistema não deixa o player abrir o cooler. Instale a regra udev abaixo." };
    case "waiting_device":
      return { tone: "warn", label: "Aguardando cooler", detail: s.devicePresent ? s.message : "O cooler (1800:3008) não aparece no USB. Ele reinicia sozinho em ~3 s se ficou sem dados." };
    case "no_theme":
      return { tone: "off", label: "Nenhum tema aplicado", detail: "Use “Enviar para a tela” para começar." };
    case "error":
      return { tone: "error", label: "Erro no player", detail: s.message };
    default:
      return {
        tone: "off",
        label: "Player parado",
        detail: s.devicePresent ? "Cooler conectado. Envie um tema para começar." : "Cooler não detectado no USB.",
      };
  }
}

function DeviceStatus() {
  const [st, setSt] = useState<PlayerStatus | null>(null);
  const [open, setOpen] = useState(false);
  const cfg = usePlayerConfig();
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      setSt(s);
      playerConfig.sync(s.config);
    } catch {
      // fora do Tauri (ex.: vite no navegador)
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), open ? 1000 : 2500);
    return () => clearInterval(t);
  }, [refresh, open]);

  const update = (patch: Partial<PlayerConfig>) => playerConfig.update(patch);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, "success");
    } catch (e) {
      toast(String(e), "error");
    }
    refresh();
  };

  const d = describe(st);
  const needsUdev = st && (st.state === "no_permission" || (!st.udevRule && st.state !== "playing"));

  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className={`status-pill ${d.tone}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="dot" />
        <IconCpu size={14} />
        <span>{d.label}</span>
      </button>
      {open && st && (
        <div className="menu status-menu">
          <div className="status-head">
            <span className={`dot big ${d.tone}`} />
            <div>
              <div className="status-title">{d.label}</div>
              <div className="muted small">{d.detail}</div>
            </div>
          </div>

          {needsUdev && (
            <div className="callout">
              <IconAlert size={16} />
              <div>
                <div>Permissão de acesso ao cooler</div>
                <div className="muted small">Instala /etc/udev/rules.d/99-dv360s.rules (pede a sua senha).</div>
                <button type="button" className="btn small primary" onClick={() => run(api.installUdev, "Regra instalada. Reconecte o cooler se não funcionar de primeira.")}>
                  Permitir acesso ao USB
                </button>
              </div>
            </div>
          )}

          {cfg && (
            <>
              <div className="menu-field">
                <span className="row-label with-icon">
                  <IconSun size={14} /> Brilho
                </span>
                <Slider value={cfg.brightness} min={10} max={100} step={5} onChange={(v) => update({ brightness: v })} format={(v) => `${v}%`} />
              </div>
              <div className="menu-field">
                <span className="row-label">Girar a tela do cooler</span>
                <Segmented
                  value={cfg.rotation}
                  onChange={(v) => update({ rotation: v })}
                  options={[0, 90, 180, 270].map((r) => ({ value: r, label: `${r}°` }))}
                />
              </div>
            </>
          )}

          <div className="menu-field">
            <Toggle
              checked={st.autostart}
              onChange={(v) => run(() => api.setAutostart(v), v ? "O player vai iniciar junto com o sistema" : "Início automático desligado")}
              label="Iniciar com o sistema"
            />
          </div>
          <div className="menu-field">
            <Toggle
              checked={st.trayRunning}
              onChange={(v) =>
                run(() => api.setTray(v), v ? "Ícone na bandeja ligado (e iniciando com a sessão)" : "Ícone na bandeja desligado")
              }
              label="Ícone na bandeja"
            />
            {!st.trayFound && <span className="muted small">Compile com “cargo build --release -p dv360s-tray” ou rode scripts/install.sh.</span>}
          </div>

          <div className="btn-row">
            {st.running ? (
              <button type="button" className="btn small" onClick={() => run(api.stopPlayer, "Player parado; a tela voltou ao logo")}>
                Parar player
              </button>
            ) : (
              <button type="button" className="btn small" disabled={!st.playerFound} onClick={() => run(api.startPlayer)}>
                Iniciar player
              </button>
            )}
            <span className="muted small">{st.running ? `pid ${st.pid}` : ""}</span>
          </div>
          <p className="note">O player é um processo à parte e bem leve: continua mostrando o tema depois que você fecha o editor.</p>
        </div>
      )}
    </div>
  );
}

function LiveButton() {
  const live = useLive();
  return (
    <button
      type="button"
      className={`btn live-btn ${live ? "on" : ""}`}
      aria-pressed={live}
      onClick={() => setLive(!live)}
      title={
        live
          ? "O cooler está espelhando o editor. Clique para voltar ao tema aplicado (Ctrl L)"
          : "Espelhar o editor no cooler enquanto edita, sem renderizar (Ctrl L)"
      }
    >
      <span className="rec" /> Ao vivo
    </button>
  );
}

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const filePath = useStore((s) => s.filePath);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const file = filePath?.split(/[\\/]/).pop();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          <span />
        </span>
        <span className="brand-name">DV360S Studio</span>
      </div>
      <nav className="toolbar">
        <button type="button" className="tb-btn" onClick={() => openLibrary("examples")} title="Novo tema: em branco ou a partir de um exemplo (Ctrl N)">
          <IconFile size={15} /> Novo
        </button>
        <button type="button" className="tb-btn" onClick={() => openLibrary("mine")} title="Meus temas: abrir, pôr na tela, excluir (Ctrl O)">
          <IconFolder size={15} /> Temas
        </button>
        <button type="button" className="tb-btn" onClick={() => saveDocument()} title="Salvar (Ctrl S) · Salvar como (Ctrl Shift S)">
          <IconSave size={15} /> Salvar
        </button>
        <span className="bar-sep" />
        <button type="button" className="icon-btn" disabled={!canUndo} onClick={() => store.undo()} title="Desfazer (Ctrl Z)">
          <IconUndo size={15} />
        </button>
        <button type="button" className="icon-btn" disabled={!canRedo} onClick={() => store.redo()} title="Refazer (Ctrl Shift Z)">
          <IconRedo size={15} />
        </button>
      </nav>
      <div className="doc-title" title={filePath ?? "Não salvo"}>
        <span className="doc-name">{name || "Sem nome"}</span>
        <span className="muted">{file ?? "não salvo"}</span>
        {dirty && <span className="dirty-dot" title="Alterações não salvas" />}
      </div>
      <div className="topbar-right">
        <DeviceStatus />
        <LiveButton />
        <button type="button" className="btn primary" onClick={applyToScreen} title="Renderiza e envia para o cooler (Ctrl Enter)">
          <IconSend size={15} /> Enviar para a tela
        </button>
      </div>
    </header>
  );
}
