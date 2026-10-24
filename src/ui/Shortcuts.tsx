// Lista de atalhos (painel "Atalhos" e janela aberta com "?").

import { useEffect, useSyncExternalStore } from "react";
import { IconX } from "./icons";

export const SHORTCUTS: [string, string][] = [
  ["Ctrl N", "Novo tema (em branco ou exemplo)"],
  ["Ctrl O", "Meus temas"],
  ["Ctrl S", "Salvar (Ctrl Shift S: salvar como)"],
  ["Ctrl Enter", "Enviar para a tela"],
  ["Ctrl L", "Ligar/desligar a prévia ao vivo no cooler"],
  ["Ctrl Z / Ctrl Shift Z", "Desfazer / refazer"],
  ["Ctrl D", "Duplicar camada"],
  ["Ctrl ↑ / Ctrl ↓", "Subir / descer a camada"],
  ["Delete", "Excluir camada"],
  ["Setas", "Mover 1 px (Shift: 10 px)"],
  ["V / B / E", "Selecionar / pincel / borracha"],
  ["Espaço", "Tocar / pausar a prévia"],
  ["Ctrl + / Ctrl − / Ctrl 0", "Zoom / ajustar à janela"],
  ["Ctrl V", "Colar imagem como camada"],
  ["Shift ao redimensionar", "Inverte a trava de proporção"],
  ["Alt ao redimensionar", "A partir do centro"],
  ["Ctrl ao mover", "Sem encaixe nas guias"],
  ["?", "Esta lista"],
];

export function ShortcutList() {
  return (
    <dl className="shortcuts">
      {SHORTCUTS.map(([k, d]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{d}</dd>
        </div>
      ))}
    </dl>
  );
}

let open = false;
const ls = new Set<() => void>();
export function toggleShortcuts(v = !open) {
  open = v;
  ls.forEach((l) => l());
}

export function ShortcutsModal() {
  const isOpen = useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
    () => open,
  );
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        toggleShortcuts(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && toggleShortcuts(false)}>
      <div className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="Atalhos">
        <div className="modal-foot">
          <span className="modal-title">Atalhos do teclado</span>
          <button type="button" className="icon-btn" onClick={() => toggleShortcuts(false)} aria-label="Fechar">
            <IconX size={16} />
          </button>
        </div>
        <ShortcutList />
      </div>
    </div>
  );
}
