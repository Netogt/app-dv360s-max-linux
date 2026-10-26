# Arquitetura do DV360S Studio

Como o app funciona por dentro: como o tema é montado, como a tela continua atualizada sem o
editor aberto, como tudo inicia com o sistema e como o projeto é compilado.

## Visão geral

São três programas, e só um deles fala com o cooler:

| Programa | Quando roda | O que faz |
|---|---|---|
| `dv360s-studio` (editor) | Só quando você abre | Monta o tema, "compila" e grava em arquivo |
| `dv360s-player` | Sempre, como serviço | Lê o tema e manda as imagens pelo USB |
| `dv360s-tray` (bandeja, opcional) | Com a sessão gráfica | Troca de tema, brilho, rotação, liga/desliga o player |

Eles conversam por arquivos em `~/.config/dv360s-studio/`:

| Arquivo | Quem grava | Quem lê | Conteúdo |
|---|---|---|---|
| `active.dvtheme` | editor, bandeja | player | Tema compilado que está na tela |
| `player.json` | editor, bandeja | player | Brilho e rotação |
| `status.json` | player | editor, bandeja | Estado atual (tocando, sem permissão, esperando o cooler, tela ativa) |
| `player.pid` | player | editor, bandeja | Evita dois players ao mesmo tempo |
| `temas/*.dvtheme` | editor | editor, bandeja | Biblioteca de temas salvos (projeto editável) |
| `active-source` | editor, bandeja | editor, bandeja | De qual tema da biblioteca veio o `active.dvtheme` |
| `rascunho.dvtheme` | editor | editor | Rascunho automático do projeto aberto |
| `editor.log` | editor | você | Erros da interface |

```
 editor ──grava──▶ active.dvtheme / player.json ──lê (1x/s)──▶ player ──USB──▶ cooler
   ▲                                                             │
   └──────────────────────── status.json ◀───────────────────────┘
 editor ──socket (modo Ao vivo)──────────────────────────────▶ player
```

O código comum aos três (protocolo USB, formato do tema, sensores, regras das telas, controle dos
serviços) fica em `crates/core`.

## Estrutura do repositório

```
crates/core/      biblioteca Rust compartilhada
  device.rs         transporte USB (libusb)
  protocol.rs       pacotes CRT… (DIS, LIG, DRA, CONNECT, CLE)
  theme.rs          formato do manifest.json
  render.rs         composição dos quadros no player
  rules.rs          condições das telas (horário, dia, data, sensor)
  sensors.rs        temperaturas e uso de CPU/GPU/RAM
  pack.rs           leitura/escrita de ZIP
  library.rs        biblioteca de temas
  live.rs           socket do modo Ao vivo
  service.rs        iniciar/parar processos e serviços do systemd
  paths.rs          caminhos em ~/.config/dv360s-studio
crates/player/    dv360s-player (sem interface)
crates/tray/      dv360s-tray (ícone StatusNotifierItem)
src-tauri/        lado Rust do editor (comandos chamados pela interface)
src/              interface do editor (React + TypeScript)
  render/           desenho, compilação, mídias, sensores, regras
  ui/               componentes da interface
scripts/install.sh
```

## 1. Montagem do tema (editor)

### O projeto

- Um projeto é uma lista de **telas**. A primeira é a principal; as outras aparecem quando suas
  condições valem.
- Cada tela é uma pilha de **camadas**: fundo, imagem/GIF/vídeo, forma, texto, relógio, sensor e
  desenho livre.
- O palco desenha tudo num canvas de 480×480 em tempo real (`src/render/draw.ts`).
- Vídeos são convertidos em quadros pelo `ffmpeg` na importação. GIFs são decodificados no próprio
  editor.
- O projeto é salvo como `.dvtheme`: um ZIP com `project.json` e as mídias originais em `assets/`.

### A compilação ("Enviar para a tela")

O editor não manda o projeto para o player: ele faz o trabalho pesado antes, para o player poder
ser leve (`src/render/compile.ts`).

1. **Separa as camadas em grupos.** Cada camada de relógio ou sensor quebra a pilha: o que está
   abaixo dela é um grupo, o que está acima é outro.
2. **Grupos fixos viram imagens prontas.** O grupo de baixo vira um JPEG 480×480 opaco. Grupos
   acima de um relógio viram PNG com transparência.
3. **Mídia animada vira uma sequência de quadros.** Se o grupo tem GIF ou vídeo, ele vira
   `00000.jpg`, `00001.jpg`… em loop. O número de quadros é a duração × quadros/s, limitada pelo
   "Loop máx." (2 a 120 s).
4. **Hora, data e sensores viram um atlas de sprites.** O editor desenha, com a fonte, o contorno e
   a sombra escolhidos, uma imagem com todos os pedaços possíveis: dígitos 0–9, nomes de dias e
   meses, trechos fixos, unidades. Junto vai o template (por exemplo `{HH}:{mm}` ou
   `{cpuTemp}°C`). O player só recorta e cola os pedaços; não precisa de fonte nem de desenhar
   texto.
5. **As condições das telas vão no manifesto.** Horário, dia da semana, período do ano e sensor
   (`>=` ou `<=`), além do tempo mínimo em cada tela (`hold`) e da folga (`hysteresis`).

O resultado é um ZIP com `manifest.json` (formato em `crates/core/src/theme.rs`) e a pasta
`render/`, gravado em `~/.config/dv360s-studio/active.dvtheme`.

## 2. Funcionamento sem o editor aberto (player)

O `dv360s-player` (`crates/player/src/main.rs`) é um programa sem janela que roda em loop:

1. **Verifica os arquivos uma vez por segundo.** Se o `active.dvtheme` ou o `player.json` mudarem,
   ele recarrega sozinho. É assim que o editor "envia" um tema: regravando o arquivo.
2. **Escolhe a tela.** Avalia as condições de cada tela com a hora atual e os sensores (lidos de
   `/sys` e `/proc` no máximo uma vez por segundo, e só se o tema usa sensores). A troca respeita o
   tempo mínimo em cada tela.
3. **Monta o quadro.** Cola as imagens prontas e os sprites, gira a imagem se houver rotação
   configurada e codifica em JPEG, baixando a qualidade se passar do limite de ~64 KB do cooler.
4. **Só envia quando o conteúdo muda.** Cada quadro tem uma chave (número do quadro, minuto atual,
   valores dos sensores). Se a chave não mudou, nada é enviado. Um tema estático com relógio de
   minutos manda um JPEG por minuto; no resto do tempo vai só um `CONNECT` a cada 4 s, porque sem
   comandos o watchdog do cooler volta para o logo em ~11 s. Uma sequência de JPEGs sem relógio e
   sem rotação é enviada direto do arquivo, sem recodificar.
5. **Fala com o USB direto pelo libusb** (`crates/core/src/device.rs`). Os comandos são pacotes
   `CRT…` de 1024 bytes: `DIS` abre a sessão, `LIG` ajusta o brilho, `DRA` envia uma imagem,
   `CONNECT` mantém a sessão viva e `CLE` encerra (a tela volta ao logo). O acesso sem root vem da
   regra udev `/etc/udev/rules.d/99-dv360s.rules`.
6. **Sobrevive a desconexões.** Se o cooler for desconectado ou reiniciar, o player espera ele
   voltar e reabre.
7. **Publica o estado** em `status.json`, que o editor e a bandeja mostram.
8. **Encerra limpo.** Ao receber SIGTERM/SIGINT, envia `CLE` e sai.

### Modo Ao vivo

Com o botão **Ao vivo**, o editor renderiza cada quadro do palco, gira, codifica em JPEG e manda
pelo socket Unix `$XDG_RUNTIME_DIR/dv360s-live.sock` (`crates/core/src/live.rs`). Mensagens: `F` +
JPEG (quadro), `P` (ping, a cada 1 s) e `E` (fim). O player repassa os quadros ao cooler; se nada
chegar por 3 s, ou ao receber `E`, volta ao tema salvo.

### Bandeja

O `dv360s-tray` registra um ícone StatusNotifierItem (funciona em KDE, Noctalia, Waybar e outros
painéis com suporte). Ele lê `status.json` e a biblioteca a cada 2 s e, no menu, grava
`active.dvtheme` / `player.json` ou inicia e para o player, do mesmo jeito que o editor.

## 3. Início com o sistema

São **serviços de usuário do systemd**: não precisam de root.

| Serviço | Sobe com | Arquivo |
|---|---|---|
| Player | o login (`default.target`) | `~/.config/systemd/user/dv360s-player.service` |
| Bandeja | a sessão gráfica (`graphical-session.target`), pois depende do painel | `~/.config/systemd/user/dv360s-tray.service` |

Os dois têm `Restart=on-failure`. As unidades são criadas quando você liga "Iniciar com o sistema"
no editor ou na bandeja (`crates/core/src/service.rs`, que roda `systemctl --user enable --now`);
desligar remove a unidade.

O `ExecStart` aponta para o binário que estava em uso quando o serviço foi ligado. Instalando com
`scripts/install.sh`, é `~/.local/bin`; rodando direto da pasta do projeto, é `target/release/`, e
mover ou apagar a pasta faz o serviço parar.

Comandos úteis:

```sh
systemctl --user status dv360s-player
journalctl --user -u dv360s-player -f     # log do player ao vivo
systemctl --user restart dv360s-player
dv360s-player --sensores                  # sensores detectados
dv360s-player --snapshot saida.jpg        # renderiza o tema ativo sem o cooler
```

## 4. Compilação

São duas partes:

- **Rust:** um workspace com quatro crates (`crates/core`, `crates/player`, `crates/tray` e
  `src-tauri`).
- **Interface:** React + TypeScript, empacotada pelo Vite em HTML/JS/CSS.

O Tauri junta as duas: o binário Rust abre uma janela com o WebKitGTK do sistema, carrega a
interface e expõe comandos que o JavaScript chama (gravar arquivo, aplicar tema, extrair vídeo,
etc., em `src-tauri/src/lib.rs`).

```
npx tauri build --no-bundle
  → npm run build              (tsc + vite → dist/)
  → cargo build --release      (embute dist/ dentro do executável)
  → target/release/dv360s-studio

cargo build --release -p dv360s-player -p dv360s-tray
  → target/release/dv360s-player
  → target/release/dv360s-tray
```

- **Desenvolvimento:** `npm run tauri dev` roda o Vite em `localhost:1420` com recarregamento
  automático e um binário de debug. O editor só permite uma instância, então feche o editor normal
  antes.
- **Instalação:** `scripts/install.sh` compila tudo, instala em `~/.local/bin`, cria o atalho no
  menu de apps e a regra udev (pede a senha uma vez) e reinicia os serviços ativos.

### Dependências

- Rust (cargo) e Node.js (npm)
- Bibliotecas do Tauri no Linux: WebKitGTK 4.1, GTK 3, libsoup 3
- `libusb` (player)
- `ffmpeg` / `ffprobe` (importação de vídeo no editor)
