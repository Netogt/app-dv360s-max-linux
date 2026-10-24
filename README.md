# DV360S Studio

Editor de temas para a tela de 480×480 do water cooler DV360S (HOTSPOTEK USB HID, `1800:3008`).
Monte o layout em camadas — fundo com imagem, GIF ou vídeo, hora e data ao vivo, textos,
formas e desenho livre — e envie para a tela.

O protocolo USB vem da engenharia reversa em [`../dv360s-max`](../dv360s-max/Engenharia-reversa-water-coole.md).

## Como funciona

São três programas:

| | O que faz | Quando roda |
|---|---|---|
| **DV360S Studio** (`dv360s-studio`) | Editor (Tauri 2 + React + TypeScript). Monta o tema e gera o arquivo `.dvtheme`. | Só enquanto você edita |
| **Player** (`dv360s-player`) | Binário Rust de ~1 MB, sem interface. Lê o `.dvtheme` e mantém a tela atualizada. | O tempo todo (ou com o sistema) |
| **Bandeja** (`dv360s-tray`, opcional) | Ícone na bandeja (~5 MB de RAM): troca o tema da biblioteca, brilho, rotação, liga/desliga o player, abre o editor. | Com a sessão, se ligado no app |

O editor **nunca** fala com o USB; quem fala é o player. Ao clicar em **Enviar para a tela**, o editor
renderiza o tema, grava `~/.config/dv360s-studio/active.dvtheme` e garante que o player está rodando.
O player percebe o arquivo novo em até 1 s e troca o conteúdo. Pode fechar o editor depois.

### Por que o player é leve

O editor "compila" o tema antes de enviar:

- Tudo que não depende do relógio (fundo, imagens, formas, texto, desenho) vira quadros prontos:
  um JPEG só para tema estático, ou uma sequência em loop quando há GIF/vídeo.
- Hora e data viram um **atlas de sprites** (dígitos, nomes de dias/meses, trechos fixos) renderizado
  com a fonte, o contorno e a sombra que você escolheu. O player só cola os sprites — não precisa de
  fonte, navegador nem decodificador de vídeo.
- O player só codifica e envia um quadro quando o conteúdo muda. Relógio sem segundos = 1 JPEG por
  minuto; no resto do tempo vai só um `CONNECT` a cada 4 s, para o watchdog do cooler não estourar.
- Tema que é só uma sequência de JPEGs (GIF/vídeo sem relógio) é enviado direto do arquivo, sem
  recodificar.

## Recursos do editor

- **Prévia ao vivo** (botão *Ao vivo*, Ctrl L): o cooler espelha o editor enquanto você mexe, sem
  renderizar o tema. Ao desligar (ou fechar o editor), o tema aplicado volta sozinho em até 3 s.
- **Biblioteca** (*Temas*, Ctrl O): os temas salvos em `~/.config/dv360s-studio/temas/`, com miniatura;
  pôr na tela, editar ou excluir. É a mesma lista que aparece na bandeja.
- **Exemplos** (*Novo*, Ctrl N): relógio grande, monitor de temperatura, minimalista, alerta de GPU
  quente e dia/noite, para começar.
- **Simular sensores**: testa as telas por temperatura/uso sem esquentar o PC (só no editor).
- Estimativa de tamanho e de tempo de renderização do loop; progresso ao importar vídeo, com cancelar.
- **Camadas** com ordem por arrastar, visibilidade, bloqueio, renomear (duplo clique), duplicar.
- **Fundo**: cor sólida, degradê linear/radial, ou imagem/GIF/vídeo (preencher, caber, esticar).
- **Mídia**: imagem, GIF animado e vídeo (MP4/WebM/MKV), com cantos arredondados, velocidade e recorte (início/fim).
- **Hora / data** ao vivo, com modelos prontos ou template próprio (`{HH}:{mm}`, `{dddd}, {D} de {MMMM}`…), idioma, fonte do sistema, contorno e sombra.
- **Texto** com várias linhas, **formas** (retângulo, elipse, anel) e **desenho livre** (pincel e borracha).
- Mover, redimensionar e girar no palco, com guias de alinhamento; guia circular para telas redondas.
- Desfazer/refazer, atalhos de teclado, arrastar arquivos do sistema, colar imagem (Ctrl V), rascunho automático.
- Controle do player: brilho, rotação, iniciar com o sistema (serviço `systemd --user`), permissão USB.

Atalhos: **Ctrl S** salvar · **Ctrl Enter** enviar · **Ctrl L** ao vivo · **Ctrl O** temas · **Ctrl N** novo ·
**Ctrl Z / Ctrl Shift Z** · **Ctrl D** duplicar · **Delete** · setas (Shift = 10 px) · **V / B / E** selecionar,
pincel, borracha · **Espaço** tocar/pausar · **?** lista completa.

## Instalar

Requisitos (Arch/CachyOS): `webkit2gtk-4.1`, `libusb`, `ffmpeg` (para importar vídeo), Rust e Node.

```bash
./scripts/install.sh
```

Isso compila em release, instala `dv360s-studio`, `dv360s-player` e `dv360s-tray` em `~/.local/bin`, cria o atalho no
menu e instala a regra udev `/etc/udev/rules.d/99-dv360s.rules` (pede a senha uma vez). A regra também
pode ser instalada pelo próprio app: botão de status do cooler › **Permitir acesso ao USB**.

## Desenvolvimento

```bash
npm install
npm run dev        # compila o player (debug) e abre o editor com hot reload
npm run build      # player + app em release (pacotes .deb/.rpm/AppImage em target/release/bundle)
cargo test -p dv360s-core
```

```
crates/core/     protocolo USB, leitor do .dvtheme e renderizador (compartilhado)
crates/player/   dv360s-player
crates/tray/     dv360s-tray (StatusNotifierItem via ksni, sem GTK)
src-tauri/       comandos do editor (arquivos, controle do player, udev, fontes)
src/             frontend React: store, render/ (canvas, compilação), ui/
```

## O player na linha de comando

```bash
dv360s-player                         # toca ~/.config/dv360s-studio/active.dvtheme
dv360s-player tema.dvtheme            # toca outro arquivo
dv360s-player --snapshot q.jpg tema.dvtheme 0   # renderiza o quadro 0 num JPEG, sem o cooler
```

Ao receber SIGTERM/SIGINT ele envia `CLE` e a tela volta ao logo. Configuração em
`~/.config/dv360s-studio/player.json` (`brightness`, `rotation`), relida automaticamente; estado em `status.json`;
log em `player.log` quando iniciado pelo editor. A prévia ao vivo chega por um socket Unix de datagramas
(`$XDG_RUNTIME_DIR/dv360s-live.sock`, ver [`crates/core/src/live.rs`](crates/core/src/live.rs)).

## Formato `.dvtheme`

ZIP **sem compressão** (o player lê direto do buffer):

```
manifest.json            o que o player toca
render/s0/00000.jpg ...  quadros 480×480 da base (JPEG; PNG com alfa nas camadas acima de um relógio)
render/t1.png            atlas de sprites de uma camada de hora/data
thumb.jpg                miniatura para a biblioteca
project.json             o projeto editável (camadas)
assets/<id>.<ext>        mídias originais
```

O arquivo salvo pelo editor tem as duas partes; o tema enviado para a tela leva só a de exibição.
O esquema do `manifest.json` está em [`crates/core/src/theme.rs`](crates/core/src/theme.rs).

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Sem permissão USB" | Instale a regra udev (botão no app ou `install.sh`) e reconecte o cooler. |
| "Aguardando cooler" | O cooler reinicia se ficar ~11 s sem dados e volta em ~3 s; o player reabre sozinho. Feche o software original se estiver aberto. |
| Vídeo não abre | `sudo pacman -S ffmpeg`. O editor decodifica o vídeo com o ffmpeg (o `<video>` do WebKitGTK não entrega quadros ao canvas). |
| Tema longo demora para enviar | Cada quadro do loop é renderizado; reduza **Loop máx.** ou os quadros/s em *Tema*. |
