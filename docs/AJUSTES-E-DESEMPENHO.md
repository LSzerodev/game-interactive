# Ajustes, desempenho e detalhes técnicos

> Notas do autor (medidas no PC dele: i5-10400F, RX 5500 XT). Os caminhos e tempos são exemplos; o guia de instalação está no [README](../README.md).

O personagem principal fica no centro da tela, responde os comentários da live do
TikTok **falando com a boca sincronizada** (IA local no Ollama, com a personalidade do **Sonic**) e reage à live:

| Evento no TikTok | Reação |
|---|---|
| Comentário | Mostra na caixa COMENTARIO e responde falando, chamando a pessoa pelo nome |
| Tiny Diny (dinossaurinho) | Dança do **Jamal** (animação `Flair.fbx`) com `MONTAGEM LOUCURA EXTREMA.mp3`, depois agradece |
| Donut | Dança **ConfidenceHolic** (animação `Rumba Dancing.fbx`) com `MONTAGEM ALQUIMIA.mp3`, depois agradece |
| Rosa | Só agradece pela rosa |
| Alguém entra na live | Acena com a mão e fala o nome ("Fala, Ana, seja bem-vindo!") |
| Curtida / share / presente | Pontos no **TOP 5 DA LIVE** |

```
game-3d-gamedot/
  game/     projeto Godot 4.7 (cenas, scripts, modelos convertidos)
  server/   Node.js: TikTok, Ollama, voz (TTS), sincronia labial, fila, WebSocket
  start.ps1 sobe o servidor e abre o jogo
```

## Rodar

**Mais fácil: dê dois cliques em `Live3D.exe`** (nesta pasta, ao lado de `server\`). Ele abre o jogo,
sobe sozinho o servidor (IA + voz clonada; log em `server\runs\server.log`) e, ao fechar a janela,
encerra tudo. A voz leva ~1 min para ficar pronta depois que a janela abre; antes disso as falas saem
com a voz do Windows. Se o servidor já estiver rodando, o jogo só se conecta a ele. O Ollama precisa
estar aberto (ícone na bandeja). O usuário do TikTok vem de `server\.env`.

Para refazer o `.exe` depois de mudar o jogo:
```powershell
& "C:\caminho\do\Godot_v4.7.2-stable_win64_console.exe" --headless --path game --export-release "Windows Desktop" ..\Live3D.exe
```
(precisa dos modelos de exportação 4.7.2, já instalados). O `.exe` NÃO leva o servidor junto: mantenha a
pasta `server\` ao lado dele.

Alternativa pelo PowerShell:

```powershell
# em server\.env, coloque TIKTOK_USERNAME (o arquivo ja existe)
.\start.ps1
```

O `start.ps1` abre o painel (`http://127.0.0.1:9393`) e o jogo, e o painel inicia
sozinho o servidor de voz clonada (o modelo leva ~1 min para carregar; o status
fica em `/api/status` → `voice.ready`). No painel, a área **Simular** dispara
comentário (com avatar de teste), Tiny Diny, Donut, Rosa e entrada na live, sem
estar ao vivo. No TikTok LIVE Studio, capture a janela do jogo (9:16) com o áudio.

Requisitos: Node 20+, Ollama com `gemma4:e4b` (ou uma API), Godot 4.7,
Python 3.11 (só para a voz clonada local).

## Painel e log (http://127.0.0.1:9393)

O painel mostra o estado de cada parte (TikTok, jogo, IA, voz), quantos eventos chegaram do TikTok
(comentários, entradas, presentes, curtidas, shares e **ignorados**), a fila de fala, o TOP e um **log ao
vivo** de tudo que acontece: comentário recebido → quem vai ser respondido → resposta da IA → áudio
gerado → falando → pontos. Linhas laranja são avisos, vermelhas são erros. Dá para filtrar por tipo
(chat, gift, join, ia, voz, fala...), pausar a rolagem, limpar e copiar. O mesmo texto também vai para
`serverunsserver.log`.

Se um comentário não for respondido, o log diz o motivo: `ignorado (link)`, `ignorado (termo bloqueado)`,
`evento "chat sem texto" em formato inesperado` (o TikTok mudou o formato), `Ollama falhou`, `a síntese
falhou` ou `o jogo não confirmou o fim de ...`. Depois de atualizar o servidor, feche e abra o `Live3D.exe`
de novo (o servidor só recarrega o código ao reiniciar).
## Personagem (o prompt do Sonic)

A personalidade fica em `server/config/persona.md` (o seu prompt, exatamente como você escreveu). Para
usar uma versão sua sem mexer no padrão, copie para `server/private/persona.md` (tem prioridade).
As regras da transmissão (resposta falada: sem asteriscos/emojis, no máximo 2 frases curtas) são
somadas por código depois do prompt, então o arquivo fica só com o seu texto. Cada espectador tem
uma memória curta própria (3 trocas); *ações entre asteriscos* e emojis são removidos antes da voz.

**Atenção:** o prompt tem ~2900 tokens. O servidor carrega o modelo e processa o prompt ao abrir
(~1 min na 1ª vez); depois disso o 1º token de cada resposta sai em ~1 s. Editar o `persona.md` com a
live aberta faz a próxima resposta demorar de novo (30 a 40 s). O contexto fica fixo em 8192
(`OLLAMA_NUM_CTX`): mudar esse valor recarrega o modelo e o padrão do Ollama (4096) truncaria o prompt.

## Resposta em chunks

A IA responde em *streaming* e o texto é cortado em frases conforme sai; cada frase vai para a voz
enquanto a próxima ainda é escrita, e o jogo emenda os áudios sem esperar o servidor.

O limite real é a velocidade da voz clonada: o XTTS gera ~0,47 s de áudio por segundo de cálculo na sua
CPU (2,15x o tempo real), mais devagar do que fala. Então sobra tempo de espera que pode ficar antes
da fala ou em pausas entre as frases. `SPEECH_MAX_GAP_SECONDS` no `.env` escolhe isso:

| valor | efeito |
|---|---|
| `0` | nenhuma pausa: a fala só começa quando o resto chega a tempo (começa mais tarde) |
| `6` (padrão) | começa quando nenhuma pausa passaria de ~6 s (nas pausas aparece "Sonic está pensando...") |
| `999` | toca cada frase assim que fica pronta (começa antes, com pausas de 2 a 8 s) |

Medido com o mesmo comentário: primeira fala em 25 s (valor 0) contra 14 s (valor 999, pausas de 1,8 e
3,4 s). Com voz mais rápida (voz do Windows, ou uma placa NVIDIA) nada disso segura a fala.

## Velocidade da resposta

O que acontece e o que ajuda (medido neste PC, com a voz XTTS de verdade):

- **O comentário aparece na tela na hora** (0 s), com "Sonic está pensando..." até ele começar a falar.
  Antes só aparecia quando a voz começava, depois de toda a espera.
- **Resposta curta** (`REPLY_LENGTH=curta`, padrão: ~1 frase, ~80 caracteres; `normal` = até 2 frases).
  É a alavanca mais forte: cada segundo de fala custa ~2,5 a 3 s de cálculo de voz. Mensagens delicadas
  (sofrimento, abuso...) ignoram o limite curto, para o Sonic poder acolher e citar o CVV 188.
- **Fila**: comentários passam na frente das boas-vindas; boas-vindas só acontecem com o Sonic livre; uma
  resposta que esperou demais na fila é descartada (boas-vindas 25 s, agradecimento 2 min, comentário
  2,5 min) com aviso no log, em vez de ser falada tarde.
- **CPU**: o servidor de voz usa 4 threads (medido: 4 = 6 = 12 em velocidade, porque o XTTS é limitado pela
  memória) e deixa 2 núcleos livres para a IA, o jogo e o TikTok Studio. O jogo roda a 30 fps.
- Resultado: o Sonic começa a falar em ~9 a 15 s com resposta curta (antes 21 a 35 s).

**O que não dá para ganhar neste PC**: o XTTS gera 1 s de fala em ~2,5 s de cálculo. A placa de vídeo
(RX 5500 XT) faria as contas do modelo ~6x mais rápido (medido com DirectML), mas ela só tem 4 GB e o
Windows, a IA e o jogo já usam ~3 GB, então o XTTS não cabe. Com uma placa NVIDIA de 8 GB ou mais:
instale o PyTorch com CUDA em `server\voice\venv-xtts` e use `XTTS_DEVICE=cuda`. Também testei
rodar várias frases em lote (sem ganho nesta CPU) e int8 (pior pronúncia).

Opção `XTTS_INT8=1` (variável de ambiente do servidor de voz) deixa o XTTS ~36% mais rápido, mas
pronuncia pior: "Sonic" virou "Sônipe" e o erro de palavras subiu de 3,2% para 9,5%. Fica desligada.

## Voz do personagem

A voz é clonada de `server/assets/voice/default.wav`, gerado a partir de
`audio-wav/1022.wav` (a versão anterior, de `meuaudio.mp3`, ficou em
`default-meuaudio.wav`). Para trocar de áudio:

```powershell
server\voice\venv-chatterbox\Scripts\python.exe server\voice\prepare_reference.py audio-wav\NOVO.wav server\assets\voice\default.wav
```

Escolha o motor em `server/.env` → `TTS_PROVIDER`:

| Motor | Licença | Tempo neste PC (CPU i5-10400F) | Observação |
|---|---|---|---|
| `xtts` (padrão) | Coqui Public Model License — **não comercial** (`COQUI_TOS_AGREED=1`) | ~2,4x a duração da fala (frase de 10 s ≈ 25 s) | o mais rápido |
| `chatterbox` | MIT (permite uso comercial) | ~6–8x a duração da fala (frase de 6 s ≈ 37 s) | mais fiel, muito lento sem GPU NVIDIA |
| `sapi` | Windows | quase instantâneo | não clona a voz |

Enquanto uma fala ou dança toca, a próxima fala já é gerada. Se a voz clonada
falhar, aquela fala sai com a voz do Windows (a live não fica muda).
Cada motor tem seu ambiente Python em `server/voice/venv-xtts` e
`server/voice/venv-chatterbox` (PyTorch CPU; a placa AMD não roda CUDA).

Use só voz que você tem autorização para usar.

## Danças

As animações do Mixamo (`audio-game/*/…fbx`, copiadas para `game/assets/dances/`)
são retargetadas por código para o esqueleto do personagem
(`game/scripts/dance_retarget.gd`) e repetem em loop até 20 s, junto com a música.
Para trocar uma dança, substitua o `.fbx` (Mixamo, "Without Skin") mantendo o nome.

## Presentes

`server/config/gift_actions.json` liga o nome do presente à reação. O nome é
comparado sem acento/maiúsculas/espaços (`Tiny Diny`, `tinydiny`, `tiny-diny`).
Para mudar sem tocar no padrão, copie para `server/private/gift_actions.json`.

Mais detalhes em [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md).
