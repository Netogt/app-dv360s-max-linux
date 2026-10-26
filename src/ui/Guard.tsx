// Um erro ao desenhar um painel não pode apagar o editor inteiro (o React desmonta tudo):
// cada área fica num Guard, que mostra o erro no lugar dela e deixa tentar de novo.

import { Component, type ReactNode } from "react";
import { api } from "../io";
import { IconAlert } from "./icons";

export function logError(where: string, e: unknown) {
  const text = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  console.error(where, e);
  api.logError(`${where}: ${text}`).catch(() => {});
}

/** Erros fora do React (eventos, promessas) também vão para o log. */
export function watchGlobalErrors() {
  window.addEventListener("error", (e) => logError("erro", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logError("promessa", e.reason));
}

export class Guard extends Component<{ name: string; className?: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    logError(this.props.name, `${error.message}\n${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`guard ${this.props.className ?? ""}`} role="alert">
        <IconAlert size={22} />
        <strong>Erro em “{this.props.name}”</strong>
        <code>{error.message}</code>
        <span className="muted small">O projeto não foi perdido. Detalhes em ~/.config/dv360s-studio/editor.log</span>
        <div className="guard-actions">
          <button type="button" className="btn primary" onClick={() => this.setState({ error: null })}>
            Tentar de novo
          </button>
          <button type="button" className="btn" onClick={() => location.reload()}>
            Recarregar o editor
          </button>
        </div>
      </div>
    );
  }
}
