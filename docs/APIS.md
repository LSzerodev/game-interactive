# Usando IA e voz por API (sem Ollama)

Você escolhe **quem escreve as respostas** e **quem fala** separadamente, tudo pelo painel (`http://127.0.0.1:9393`).
Misture à vontade: por exemplo, Gemini para o texto e ElevenLabs para a voz.

> As chaves ficam **só no seu computador**, em `server/private/settings.json` (fora do Git). O painel nunca mostra a chave de volta: depois de salvar aparece só "salva", e você pode substituir ou remover.
> **Nunca** poste sua chave em prints, vídeos ou no GitHub. APIs são cobradas por uso (exceto planos grátis): confira os preços e coloque um limite de gastos na conta do provedor.

## IA (aba **IA** do painel)

| Provedor | Custo | Como conseguir a chave | Modelo sugerido |
|---|---|---|---|
| **Ollama** (local) | grátis, usa seu PC | instale em [ollama.com](https://ollama.com) e rode `ollama pull gemma4:e4b` (ou outro modelo) | `gemma4:e4b`, `llama3.2`, `qwen2.5` |
| **Google Gemini** | tem plano grátis (com limites) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `gemini-2.5-flash` |
| **OpenAI** | pago por uso | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `gpt-4o-mini` |
| **Compatível com OpenAI** (Groq, OpenRouter, DeepSeek, LM Studio...) | varia | a do serviço escolhido | o que o serviço oferecer |

**Passo a passo (exemplo Gemini):**
1. Aba **IA** → *Quem escreve as respostas* = **Google Gemini**.
2. Cole a chave em *Chave do Gemini*.
3. Clique **Salvar e testar**. Deve aparecer uma frase respondida pelo modelo. Se aparecer erro, a mensagem diz o motivo (chave inválida, sem créditos, modelo inexistente...).

**API compatível com a OpenAI:** escolha *OpenAI / compatível*, troque o *Endereço da API* (ex.: `https://api.groq.com/openai/v1`, `https://openrouter.ai/api/v1`, `http://127.0.0.1:1234/v1` para o LM Studio), cole a chave e o nome do modelo.

Outras opções da aba: *Criatividade* (0 a 2) e *Tamanho da resposta* (curta é mais rápida e barata).

## Voz (aba **Voz** do painel)

| Voz | Custo | Chave / config | Observação |
|---|---|---|---|
| **Windows (SAPI)** | grátis | nada | funciona offline, não clona |
| **OpenAI** | pago por uso | a mesma chave da OpenAI | modelos `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd`; vozes `nova`, `alloy`, `coral`... |
| **Gemini** | plano grátis com limites (confira) | a mesma chave do Gemini | vozes `Kore`, `Puck`, `Charon`, `Zephyr`... |
| **ElevenLabs** | plano grátis limitado, depois pago | chave em *Settings → API Keys* + o **ID da voz** | dá para usar uma **voz clonada sua** (o ID aparece na sua biblioteca de vozes) |
| **XTTS / Chatterbox** | grátis, local | [VOZ-LOCAL.md](VOZ-LOCAL.md) | clonam sua voz, mas são lentos sem placa NVIDIA |

Clique **Salvar e testar** e o navegador toca uma frase de teste.

**Dica de velocidade:** com voz por API o áudio sai quase na hora. Na aba Voz, coloque *Maior pausa entre frases* em `999` para tocar cada frase assim que ficar pronta.

**Se a API falhar** durante a live (sem créditos, internet caiu), aquela fala sai com a voz do Windows e o log do painel mostra o motivo.

## Prompt do personagem e presentes

Aba **Personagem**: edite a personalidade (o prompt) e o mapa de presentes → reações sem mexer em arquivos. Use **Restaurar padrão** para voltar ao original.

## Trocar tudo sem painel

Prefere arquivos? Copie `server/.env.example` para `server/.env` e edite. O que for salvo pelo painel (`server/private/settings.json`) vale mais do que o `.env`.
