#!/usr/bin/env bash
# Compila e instala o DV360S Studio no usuário atual (~/.local), sem precisar de root
# — exceto a regra udev, que dá acesso ao USB do cooler (pede a senha uma vez).
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/256x256/apps"
RULE=/etc/udev/rules.d/99-dv360s.rules

echo "==> Dependências do frontend"
npm install --no-audit --no-fund

echo "==> Compilando o player e o editor (release)"
cargo build --release -p dv360s-player
npx tauri build --no-bundle

echo "==> Instalando em $BIN"
install -Dm755 target/release/dv360s-player "$BIN/dv360s-player"
install -Dm755 target/release/dv360s-studio "$BIN/dv360s-studio"
install -Dm644 src-tauri/icons/128x128@2x.png "$ICONS/dv360s-studio.png"
mkdir -p "$APPS"
cat > "$APPS/dv360s-studio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=DV360S Studio
Comment=Temas para a tela do water cooler
Exec=$BIN/dv360s-studio
Icon=dv360s-studio
Categories=Utility;Graphics;
Terminal=false
EOF

if [ ! -f "$RULE" ]; then
  echo "==> Regra udev (acesso ao USB sem root) — pode pedir a senha"
  echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="1800", ATTR{idProduct}=="3008", MODE="0666"' | sudo tee "$RULE" >/dev/null
  sudo udevadm control --reload
  sudo udevadm trigger --subsystem-match=usb --attr-match=idVendor=1800
fi

# se o serviço já estiver ativo, reinicia com o binário novo
if systemctl --user is-active --quiet dv360s-player.service 2>/dev/null; then
  systemctl --user restart dv360s-player.service
fi

echo
echo "Pronto. Abra o \"DV360S Studio\" pelo menu de aplicativos (ou rode dv360s-studio)."
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Obs.: $BIN não está no PATH." ;; esac
