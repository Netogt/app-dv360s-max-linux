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

Detalhes de cada parte (compilação do tema, loop do player, serviços, build) em
[docs/ARQUITETURA.md](docs/ARQUITETURA.md).

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

### 1. Dependências do sistema (uma vez)

Arch/CachyOS:

```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 libusb ffmpeg rustup nodejs npm
rustup default stable
```

`ffmpeg` só é usado para importar vídeos no editor.

### 2. PATH

O `install.sh` instala os programas em `~/.local/bin`. Se ele não estiver no PATH:

```bash
fish_add_path $HOME/.local/bin                  # fish
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc   # bash
```

Se o Rust ou o Node foram instalados fora do pacman (por exemplo com `rustup` em `~/.cargo/bin` ou
Node extraído em `~/.local/node/bin`), adicione essas pastas também, ou `cargo`/`npx` não serão
encontrados.

### 3. Compilar e instalar

```bash
./scripts/install.sh
```

O script:

1. roda `npm install`;
2. compila o editor, o player e a bandeja em release;
3. copia `dv360s-studio`, `dv360s-player` e `dv360s-tray` para `~/.local/bin`;
4. cria o atalho **DV360S Studio** no menu de aplicativos;
5. instala a regra udev `/etc/udev/rules.d/99-dv360s.rules` para acessar o USB sem root (pede a
   senha só na primeira vez). A regra também pode ser instalada pelo app: botão de status do
   cooler › **Permitir acesso ao USB**;
6. reinicia o player e a bandeja, se já estiverem rodando como serviço.

### 4. Ligar o início automático (uma vez, no editor)

O script **não** liga o início com o sistema. Abra o DV360S Studio, clique no botão de status do
cooler (canto superior) e ligue:

- **Iniciar com o sistema**: o player vira um serviço de usuário do systemd e sobe no login;
- **Ícone na bandeja** (opcional): idem para o `dv360s-tray`, que sobe com a sessão gráfica.

> Se esses serviços foram ligados antes usando os binários de `target/release/` (rodando direto da
> pasta do projeto), desligue e ligue de novo depois do `install.sh`. Assim eles passam a apontar
> para `~/.local/bin` e não param se a pasta do projeto for movida ou apagada.

### 5. Usar

Monte o tema e clique em **Enviar para a tela**. Pode fechar o editor depois: o player continua
rodando e volta sozinho quando o computador reinicia.

### Atualizar depois de mudar o código

Feche o editor (só pode haver uma instância aberta) e rode de novo:

```bash
./scripts/install.sh
```

Ele recompila, substitui os binários e reinicia o player e a bandeja.

### Conferir se está funcionando

```bash
systemctl --user status dv360s-player dv360s-tray   # os dois "active (running)"
dv360s-player --sensores                            # temperaturas detectadas
journalctl --user -u dv360s-player -f               # log do player ao vivo
```

Mais em [Problemas comuns](#problemas-comuns).

### Só o executável, sem instalar

```bash
npx tauri build --no-bundle                         # editor → target/release/dv360s-studio
cargo build --release -p dv360s-player -p dv360s-tray
```

O editor sozinho não mostra nada no cooler: quem fala com o USB é o player. Para gerar pacotes
`.deb`, `.rpm` e AppImage em `target/release/bundle/`, use `npm run build`. Os pacotes dependem do
WebKitGTK 4.1 e do libusb instalados no sistema.

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
