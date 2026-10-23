# Voz clonada local (opcional)

Para a maioria das pessoas é mais fácil usar **voz por API** (OpenAI, Gemini ou ElevenLabs, veja o [guia de APIs](APIS.md)) ou a **voz do Windows**, que funciona sem instalar nada.
Use a voz local só se quiser clonar uma voz **de graça** e tiver paciência com a velocidade.

| Motor | Licença | Velocidade (CPU i5) | Observação |
|---|---|---|---|
| `xtts` | Coqui Public Model License, **não comercial** | ~2,4x a duração da fala | o mais rápido dos locais |
| `chatterbox` | MIT (permite uso comercial) | ~6 a 8x a duração da fala | mais fiel, muito lento sem placa NVIDIA |

Uma placa NVIDIA com 8 GB ou mais deixa os dois bem mais rápidos (instale o PyTorch com CUDA no ambiente e use `XTTS_DEVICE=cuda`).

## 1. Instalar

Precisa do **Python 3.11** instalado. No PowerShell, dentro da pasta `server\voice`:

```powershell
.\setup_voice.ps1 xtts          # ou: .\setup_voice.ps1 chatterbox
```

O script cria o ambiente `venv-xtts` ou `venv-chatterbox` e instala o PyTorch para CPU. O primeiro uso baixa o modelo (alguns GB).

## 2. Preparar o áudio da voz

Grave (ou use) de **6 a 30 segundos** de uma pessoa só, sem música nem ruído. **Use só uma voz que você tem autorização para usar.**

```powershell
server\voice\venv-xtts\Scripts\python.exe server\voice\prepare_reference.py meu-audio.mp3 server\assets\voice\default.wav
```

(Crie a pasta `server\assets\voice` se ela não existir.)

## 3. Ligar no painel

Aba **Voz** → *Quem fala* = XTTS ou Chatterbox → confira o caminho do áudio de referência → para XTTS, marque o aceite da licença Coqui → **Salvar e testar**.

O servidor de voz sobe sozinho junto com o painel (o modelo leva ~1 minuto para carregar; o painel mostra "carregando"). Se a voz local falhar, aquela fala sai com a voz do Windows para a live não ficar muda.

Mais medições e ajustes de velocidade: [AJUSTES-E-DESEMPENHO.md](AJUSTES-E-DESEMPENHO.md).
