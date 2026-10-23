
## IA e resposta em chunks (`ai.js`, `speech.js`)

`ai.js` pede ao Ollama a resposta em *streaming* (NDJSON) e um separador a corta em frases: a
1ª sai numa vírgula depois de ~22 caracteres (para começar logo), as seguintes só em fim de frase,
sem cortar em "Dr." nem dentro de uma *ação* ainda aberta. Cada chunk é limpo (sem asteriscos, emojis,
aspas) e filtrado. `speech.js` sintetiza os chunks em ordem (a voz atende um por vez), manda cada um
ao Godot assim que pode, e o Godot os enfileira e emenda (`main.gd` → `_speech_queue`). A decisão de
*quando* começar usa estimativas atualizadas a cada síntese (segundos de cálculo por segundo de áudio,
segundos de áudio por caractere) e o limite `SPEECH_MAX_GAP_SECONDS`.

## Fila e prioridades (`server/src/speech.js`)

Uma ação por vez, nada é cortado no meio:
dança (90) > agradecimento (80) > boas-vindas (60) > comentário de quem está no
TOP 5 (55) > comentário (50). Um presente que chega durante uma fala entra na
frente da fila e acontece assim que a fala termina. Até 3 danças ficam na fila;
o excesso de uma rajada é descartado. Boas-vindas agrupam até 3 nomes a cada 4 s
e são puladas se a fila estiver cheia.

## Boca sincronizada

1. O servidor gera o WAV da fala e calcula a energia (RMS) a cada 30 ms → envelope 0..1.
2. Envia `speech_ready` com o caminho do áudio e o envelope.
3. O Godot (`voice_sync.gd`) toca o áudio e, a cada frame, lê a posição real de
   reprodução para pegar o valor do envelope.
4. `character.gd` abre a boca com esse valor: shape keys do lábio (amplificadas 2x;
   acima disso o lábio serrilha) e dentes (`Teeth/Open`). A abertura é discreta
   porque o rig original do modelo abre pouco.

## Voz clonada (`server/voice/voice_server.py`)

Servidor HTTP local com a mesma API para XTTS v2 e Chatterbox. O modelo e a
"impressão" da voz de referência ficam em memória. Depois de cada síntese,
`tidyWav` (lipsync.js) corta o "resto" de som que esses modelos deixam depois de um
silêncio no final e encurta pausas internas acima de 0,9 s (verificado com
transcrição pelo Whisper: nenhuma palavra cortada). A fila prepara a próxima fala
enquanto a atual toca.

## Cenário

- Céu: a foto `sky-background` não é panorâmica; fica num plano preso à câmera, no
  fundo, cortando as laterais para 9:16 (`stage.gd` → `_setup_sky`).
- Pés no chão: o topo da ilha é um disco irregular centrado atrás do personagem.
  `island_offset` em `stage.gd` traz o trecho plano para baixo dos pés, com o chão
  em y = 0. Se mudar a ilha/escala, recalcule com
  `godot --headless --path game --script res://tools/measure_ground.gd`.

Medido em teste real: correlação 0,88–0,90 entre envelope e abertura da boca.

## Danças (`dance_retarget.gd` + `character.gd`)

As animações do Mixamo (`jamal.fbx` = Flair, `confidenceholic.fbx` = Rumba
Dancing) não têm malha, só o esqueleto `mixamorig`. Os dois esqueletos estão em
T-pose, com Y para cima e olhando para +Z, então o retarget usa só rotações
**globais**: para cada osso mapeado, `delta = global_animado * global_descanso⁻¹`
no Mixamo; no personagem esse delta vira rotação relativa ao ancestral mapeado.
Isso independe dos eixos internos de cada osso. O quadril também desce/sobe
(escalado pela altura do quadril) e o deslocamento horizontal do loop é removido
para a animação não "pular" ao reiniciar. A animação repete até 20 s com a música
(fade-out no fim).

Se um `.fbx` faltar, entram as danças feitas por código (versão anterior), que
trocam de passo nas batidas detectadas pelo `beat_tracker.gd`.

## Modelos

Os `.blend` foram convertidos com o Blender 5.1 portátil pelos scripts de
`game/tools/` (os originais não foram alterados):

- `export_character.py`: aplica modificadores preservando as shape keys, converte
  materiais "Diffuse BSDF" (que o glTF ignora) para Principled, transfere pesos
  das luvas presos em alvos de IK, mantém a pose do rosto (olhos abertos) e grava
  a piscada como animação `Blink`.
- `export_props.py`: rochas e grama (texturas que não vieram nos arquivos são
  removidas; a cor é definida no Godot).

Para reconverter:

```
blender -b "personagem principal.blend" --python game/tools/export_character.py -- game/assets/models/personagem.glb
```

Texturas ausentes nos arquivos enviados: corpo/sapatos HD, pedras (`Stones_*`),
terreno da ilha (`rocky-rugged-terrain_*`) e grama. Por isso a ilha, as rochas e
a grama usam cores sólidas.

## Mensagens WebSocket

Servidor → jogo: `speech_ready`, `dance_start`, `top_supporters_update`.
Jogo → servidor: `hello`, `heartbeat`, `speech_finished`, `dance_finished`.
