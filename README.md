<div align="center">

# 🎮 Live 3D

**Um personagem 3D que conversa com a sua live do TikTok.**
Ele lê os comentários, responde **falando com a boca sincronizada**, dança quando chega presente e dá boas-vindas a quem entra.

Feito com **Godot 4** + **Node.js** · Código aberto · Criado por **Luis Felipe**

[![Comunidade no Telegram](https://img.shields.io/badge/Telegram-entrar%20na%20comunidade-26A5E4?logo=telegram&logoColor=white)](https://t.me/+dodaVsUWVoQ0Yjhh)

</div>

---

## ✨ O que ele faz

| Evento no TikTok | Reação do personagem |
|---|---|
| 💬 Comentário | Mostra na tela e **responde falando**, chamando a pessoa pelo nome |
| 🦖 Tiny Diny | Dança do **Jamal** com música, depois agradece |
| 🍩 Donut | Dança **ConfidenceHolic** com música, depois agradece |
| 🌹 Rosa | Agradece pela rosa |
| 👋 Alguém entra | Acena e fala o nome ("Fala, Ana, seja bem-vinda!") |
| ❤️ Curtida / share / presente | Pontos no **TOP 5 DA LIVE** |

As reações dos presentes e a personalidade do personagem são **editáveis pelo painel**.

## 🧩 Como é montado

```
TikTok Live ─► servidor (Node.js) ─► IA escreve a resposta ─► voz fala ─► jogo (Godot) mostra e dança
                     │
                     └── painel de controle: http://127.0.0.1:9393  (configura tudo)
```

- **IA** (quem escreve): Ollama local, **OpenAI**, **Google Gemini** ou qualquer API compatível com a da OpenAI.
- **Voz** (quem fala): voz do Windows, **OpenAI**, **Gemini**, **ElevenLabs**, ou voz clonada local (XTTS / Chatterbox).

Tudo isso você escolhe **no painel**, sem editar arquivo nenhum.

## 📋 O que precisa para funcionar

| Item | Para quê | Obrigatório? |
|---|---|---|
| **Windows 10/11** | o jogo (`Live3D.exe`) e a voz do Windows | sim |
| **[Node.js 20+](https://nodejs.org)** | roda o servidor (TikTok, IA, voz, painel) | sim |
| **Jogo**: `Live3D.exe` (Releases) **ou** [Godot 4.7](https://godotengine.org) para abrir a pasta `game/` | mostrar o personagem | sim |
| **Uma IA**: [Ollama](https://ollama.com) (grátis, local) **ou** chave de API OpenAI/Gemini | escrever as respostas | sim |
| **Uma voz**: a do Windows (já vem) **ou** chave de API **ou** voz local | falar | sim (a do Windows serve para começar) |
| Python 3.11 | só para a voz clonada **local** | não |
| TikTok LIVE Studio (ou outro) | capturar a janela do jogo (9:16) com áudio e transmitir | para ir ao vivo |

> 💡 **Caminho mais fácil para começar:** Node.js + `Live3D.exe` + **chave do Gemini** (grátis) + **voz do Windows**. Zero instalação pesada.

## 🚀 Começando

### 1. Baixe

- **Só quer jogar?** Baixe o `Live3D.zip` na aba [**Releases**](../../releases) e extraia. Ele já vem com a pasta `server/` ao lado do `.exe`.
- **Quer o código?**
  ```powershell
  git clone https://github.com/LSzerodev/game-interactive.git
  cd game-interactive
  ```

### 2. Rode

**Opção A, dois cliques:** abra o `Live3D.exe`. Ele sobe o servidor sozinho (na 1ª vez instala as dependências, pode levar um minuto) e o encerra quando você fecha a janela. O log fica em `server\runs\server.log`.

**Opção B, pelo PowerShell** (a partir do código-fonte):
```powershell
.\start.ps1
```
Abre o servidor e o painel. Para abrir também o jogo pelo Godot, defina antes `$env:GODOT_EXE = "C:\caminho\Godot_v4.7.exe"`, ou abra a pasta `game/` no Godot e aperte F5.

### 3. Configure pelo painel

Abra **http://127.0.0.1:9393** (abre sozinho na opção B). Nas abas:

| Aba | O que configura |
|---|---|
| **Painel** | estado de cada parte, comentários chegando, fila de fala, TOP 5, log ao vivo e **simulador** (testa comentário, presente e entrada sem estar ao vivo) |
| **IA** | quem escreve: Ollama, OpenAI, Gemini ou compatível · modelo · chave · criatividade · tamanho da resposta · botão **Salvar e testar** |
| **Voz** | quem fala: Windows, OpenAI, Gemini, ElevenLabs, XTTS, Chatterbox · voz · chave · botão **Salvar e testar** (toca uma frase) |
| **TikTok** | usuário da live, proxy, nome do personagem |
| **Personagem** | o prompt (personalidade) e o mapa de presentes → reações |

Mudou algo? **Vale na hora**, sem reiniciar.

### 4. Vá ao vivo

1. Na aba **TikTok**, coloque seu usuário e salve; na aba **Painel** clique **Conectar**.
2. No TikTok LIVE Studio, capture a janela do jogo (9:16) **com o áudio**.
3. Teste antes pelo **Simular** do painel.

## 🧠 Usando API em vez do Ollama (IA e voz)

Não quer instalar o Ollama ou quer vozes melhores? Use API. O passo a passo completo, com onde gerar cada chave e preços, está em **[docs/APIS.md](docs/APIS.md)**. Resumo:

| | Opções |
|---|---|
| **IA** | Ollama (grátis, local) · **Gemini** (plano grátis) · **OpenAI** · compatíveis (Groq, OpenRouter, DeepSeek, LM Studio) |
| **Voz** | Windows (grátis) · **OpenAI** · **Gemini** · **ElevenLabs** (aceita voz clonada) · XTTS/Chatterbox locais ([guia](docs/VOZ-LOCAL.md)) |

Exemplo em 1 minuto (Gemini): aba **IA** → *Google Gemini* → cole a chave de [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Salvar e testar**.

🔒 Suas chaves ficam só no seu PC (`server/private/settings.json`, fora do Git) e o painel nunca as mostra de volta. Mesmo assim, **não compartilhe** essa pasta nem prints com chaves.

## 🗂️ Estrutura do projeto

```
game/      projeto Godot 4 (cenas, scripts, modelos)
server/    Node.js: TikTok, IA, voz, sincronia labial, fila, painel (WebSocket com o jogo)
docs/      documentação (APIs, voz local, como funciona, ajustes)
start.ps1  sobe o servidor e abre o painel
```

Documentação extra:
- 📘 [docs/APIS.md](docs/APIS.md): IA e voz por API
- 🎙️ [docs/VOZ-LOCAL.md](docs/VOZ-LOCAL.md): voz clonada local (XTTS / Chatterbox)
- ⚙️ [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md): arquitetura, fila, boca sincronizada, danças
- 📈 [docs/AJUSTES-E-DESEMPENHO.md](docs/AJUSTES-E-DESEMPENHO.md): medidas de velocidade e ajustes finos

## 🛠️ Refazer o `Live3D.exe`

Com o Godot 4.7 e os modelos de exportação instalados:
```powershell
godot --headless --path game --export-release "Windows Desktop" ..\Live3D.exe
```
O `.exe` **não leva o servidor junto**: mantenha a pasta `server\` ao lado dele.

## ❓ Problemas comuns

| Sintoma | O que fazer |
|---|---|
| O painel diz **"abra o Live3D.exe"** | o jogo não conectou; abra o jogo (ele usa a porta 9393) |
| **IA** em amarelo/vermelho | Ollama fechado, ou falta a chave da API: aba **IA** → *Salvar e testar* mostra o motivo |
| O personagem responde frases prontas ("mensagem recebida...") | a IA falhou; veja o log do painel (linhas laranja/vermelhas) |
| A voz sai com a **voz do Windows** mesmo escolhendo outra | a API/voz local falhou naquela fala; o log diz por quê (chave, créditos, servidor de voz ainda carregando) |
| Comentário não respondido | o log diz o motivo: `ignorado (link)`, `termo bloqueado`, fila, etc. |
| Mudei o código e nada mudou | feche e abra o jogo/servidor de novo (o servidor só recarrega ao reiniciar) |

## 📜 Licença e créditos

Este projeto é **código aberto e gratuito**: você pode baixar, usar, modificar e compartilhar, com **duas condições**:

1. **Dê os créditos ao autor** (**Luis Felipe**) em qualquer uso ou versão derivada, mantendo o aviso de autoria.
2. **Entre na comunidade do Telegram** para ter acesso a mais jogos: 👉 **https://t.me/+dodaVsUWVoQ0Yjhh**

Texto completo em [LICENSE](LICENSE).

> ⚠️ **Conteúdo de terceiros:** modelos 3D, animações (Mixamo), músicas, imagens e a voz de referência têm **licenças próprias** e não são cobertos pela licença do código. Confira se você pode usá-los antes de publicar sua live ou redistribuir. Veja [NOTICE.md](NOTICE.md).

---

<div align="center">

Gostou? Deixe uma ⭐ no repositório e **[entre na comunidade](https://t.me/+dodaVsUWVoQ0Yjhh)** para ver os próximos jogos.

</div>
