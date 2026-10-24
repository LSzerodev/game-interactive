// Diagnostico para o painel: o que ja esta instalado e o que falta para a IA e a voz
// escolhidas funcionarem, com o passo a passo de cada coisa que falta.
// Cada item: { level: ok|warn|error, title, detail?, steps?: [string], link?: [url, texto] }
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const cfg = require('./config');
const voiceService = require('./voice_service');

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, stdout, stderr) => {
    resolve(err ? null : String(stdout || stderr).trim());
  });
});

const item = (level, title, extra = {}) => ({ level, title, ...extra });
const worst = (items) => (items.some((i) => i.level === 'error') ? 'error' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok');

const gb = (bytes) => (bytes / 1e9).toFixed(1).replace('.', ',') + ' GB';
// "gemma4" e "gemma4:latest" sao o mesmo modelo no Ollama
const sameModel = (a, b) => String(a).replace(/:latest$/, '') === String(b).replace(/:latest$/, '');

// ---------- IA

async function ollamaBinary() {
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
  if (local && fs.existsSync(local)) return local;
  return (await run('where', ['ollama'])) ? 'ollama' : null;
}

async function ollama() {
  const items = [];
  let models = null;
  try {
    const res = await fetch(`${cfg.OLLAMA_URL.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) models = ((await res.json()).models || []).map((m) => ({ name: m.name, size: m.size ? gb(m.size) : '' }));
  } catch { /* nao esta rodando */ }

  if (!models) {
    if (await ollamaBinary()) {
      items.push(item('error', 'O Ollama está instalado, mas não está rodando', {
        detail: `Não consegui falar com ${cfg.OLLAMA_URL}.`,
        steps: ['Abra o aplicativo **Ollama** pelo menu Iniciar (ele fica na bandeja, perto do relógio).', 'Ou rode no PowerShell: `ollama serve`', 'Depois clique em **Verificar de novo**.'],
      }));
    } else {
      items.push(item('error', 'O Ollama não está instalado', {
        detail: 'O Ollama roda a IA no seu próprio PC, de graça.',
        steps: ['Baixe e instale em https://ollama.com/download', `Baixe um modelo no PowerShell: \`ollama pull ${cfg.OLLAMA_MODEL}\``, 'Clique em **Verificar de novo**.', 'Não quer instalar nada? Troque "Quem escreve" para **Google Gemini** (tem plano grátis) ou **OpenAI**.'],
        link: ['https://ollama.com/download', 'Baixar o Ollama'],
      }));
    }
    return { running: false, models: [], items, level: worst(items) };
  }

  items.push(item('ok', `Ollama rodando (${models.length} ${models.length === 1 ? 'modelo instalado' : 'modelos instalados'})`));
  if (!models.length) {
    items.push(item('error', 'Nenhum modelo instalado', {
      steps: [`Baixe um no PowerShell: \`ollama pull ${cfg.OLLAMA_MODEL}\``, 'Modelos pequenos e rápidos: `llama3.2` (2 GB), `qwen2.5:3b`, `gemma3:4b`.', 'Clique em **Verificar de novo**.'],
    }));
  } else if (!models.some((m) => sameModel(m.name, cfg.OLLAMA_MODEL))) {
    items.push(item('error', `O modelo "${cfg.OLLAMA_MODEL}" não está instalado`, {
      detail: 'Escolha um dos instalados na lista acima ou baixe este.',
      steps: [`Baixar: \`ollama pull ${cfg.OLLAMA_MODEL}\``, 'Ou selecione um modelo instalado em *Modelo do Ollama* e salve.'],
    }));
  } else items.push(item('ok', `Modelo "${cfg.OLLAMA_MODEL}" instalado`));
  return { running: true, models, items, level: worst(items) };
}

function cloudKey(label, key, where) {
  return key
    ? item('ok', `Chave ${label} salva`)
    : item('error', `Falta a chave ${label}`, { steps: [`Gere a chave em ${where}`, 'Cole no campo *Chave* abaixo e clique em **Salvar e testar**.'], link: [where, 'Gerar a chave'] });
}

async function ia(provider) {
  const p = ['ollama', 'openai', 'gemini'].includes(provider) ? provider : cfg.AI_PROVIDER;
  if (p === 'ollama') return { provider: p, ...(await ollama()) };
  const items = [p === 'gemini'
    ? cloudKey('do Gemini', cfg.GEMINI_API_KEY, 'https://aistudio.google.com/apikey')
    : cloudKey('da OpenAI', cfg.OPENAI_API_KEY, 'https://platform.openai.com/api-keys')];
  return { provider: p, items, level: worst(items) };
}

// ---------- voz

async function python311() {
  for (const [cmd, args] of [['py', ['-3.11', '--version']], ['python', ['--version']]]) {
    const out = await run(cmd, args);
    if (out && /Python 3\.11/.test(out)) return out;
  }
  return null;
}

const venvPython = (engine) => path.join(cfg.VOICE_DIR, `venv-${engine}`, 'Scripts', 'python.exe');

// O pacote do motor (XTTS = "TTS", Chatterbox = "chatterbox") esta mesmo instalado no ambiente?
// Guarda so o "sim" por 1 min (o painel confere a cada 5 s); o "nao" e sempre conferido de novo.
const moduleOk = new Map();
async function hasModule(engine) {
  if (Date.now() - (moduleOk.get(engine) || 0) < 60000) return true;
  const mod = engine === 'xtts' ? 'TTS' : 'chatterbox';
  const out = await run(venvPython(engine), ['-c', `import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('${mod}') else 1)`]);
  if (out === null) return false;
  moduleOk.set(engine, Date.now());
  return true;
}

// Ultimas linhas do log do servidor de voz (o erro real de quando ele nao sobe)
function logTail(engine, lines = 8) {
  try {
    const text = fs.readFileSync(path.join(cfg.VOICE_DIR, `${engine}.log`), 'utf8').trimEnd().split(/\r?\n/);
    return text.slice(-lines).join('\n').slice(-1200);
  } catch {
    return '';
  }
}

async function localVoice(engine) {
  const name = engine === 'xtts' ? 'XTTS' : 'Chatterbox';
  const items = [];

  if (fs.existsSync(venvPython(engine))) {
    if (await hasModule(engine)) items.push(item('ok', `${name} instalado (ambiente venv-${engine})`));
    else {
      // a pasta do ambiente existe, mas o pacote de voz nao esta dentro dela: a instalacao falhou ou foi interrompida
      items.push(item('error', `O ${name} não está instalado direito`, {
        detail: `O ambiente venv-${engine} existe, mas o pacote de voz não está dentro dele. A instalação foi interrompida ou deu erro (comum com Python diferente do 3.11, internet caindo ou pouco espaço em disco).`,
        steps: [
          'Confira que o **Python 3.11** está instalado (não serve o 3.12 ou mais novo): https://www.python.org/downloads/release/python-3119/',
          'Apague a pasta do ambiente: ' + `\`rmdir /s /q server\\voice\\venv-${engine}\``,
          'Instale de novo e **espere até aparecer "Pronto"**:',
          `\`cd server\\voice\``,
          `\`powershell -ExecutionPolicy Bypass -File .\\setup_voice.ps1 ${engine}\``,
          'Se der erro, o texto completo fica em `server\\voice\\install.log`. Mande na comunidade para pedir ajuda.',
        ],
      }));
    }
  } else {
    const py = await python311();
    const steps = [];
    if (!py) steps.push('Instale o **Python 3.11** em https://www.python.org/downloads/release/python-3119/ (marque *Add python.exe to PATH* no instalador).');
    steps.push('Abra o PowerShell na pasta do jogo e rode:', `\`cd server\\voice\`\n\`powershell -ExecutionPolicy Bypass -File .\\setup_voice.ps1 ${engine}\``, 'Leva alguns minutos e baixa alguns GB. Depois clique em **Verificar de novo**.');
    items.push(item('error', `${name} não está instalado`, {
      detail: py ? `Python encontrado (${py}). Falta criar o ambiente da voz.` : 'O Python 3.11 também não foi encontrado.',
      steps,
      link: py ? undefined : ['https://www.python.org/downloads/release/python-3119/', 'Baixar o Python 3.11'],
    }));
  }

  if (fs.existsSync(cfg.VOICE_REFERENCE_WAV)) {
    items.push(item('ok', 'Áudio de referência encontrado'));
  } else {
    items.push(item('error', 'Falta o áudio de referência da voz', {
      detail: `Não existe o arquivo ${cfg.VOICE_REFERENCE_WAV}`,
      steps: ['Grave ou use de 6 a 30 s de uma pessoa só, sem música nem ruído (**só uma voz que você tem autorização para usar**).', `Salve como WAV em \`${cfg.VOICE_REFERENCE_WAV}\`, ou informe outro caminho em *Áudio de referência da voz* abaixo.`, 'Para converter um MP3/áudio: `server\\voice\\venv-' + engine + '\\Scripts\\python.exe server\\voice\\prepare_reference.py meu-audio.mp3 server\\assets\\voice\\default.wav`'],
    }));
  }

  if (engine === 'xtts') {
    items.push(cfg.COQUI_TOS_AGREED
      ? item('ok', 'Licença do XTTS aceita')
      : item('error', 'Falta aceitar a licença do XTTS', {
        detail: 'O XTTS v2 usa a Coqui Public Model License (só uso não comercial).',
        steps: ['Marque a caixa *Aceito a Coqui Public Model License* abaixo e salve.'],
        link: ['https://coqui.ai/cpml', 'Ler a licença'],
      }));
  }

  const st = voiceService.status();
  if (st.ready) items.push(item('ok', `Servidor de voz ${name} pronto`));
  else if (items.every((i) => i.level === 'ok')) {
    items.push(st.running
      ? item('warn', `${name} está carregando o modelo`, { detail: 'Na primeira vez baixa alguns GB e leva alguns minutos. Depois leva cerca de 1 minuto.', steps: ['Aguarde e clique em **Verificar de novo**.'] })
      : item('warn', `O servidor de voz ${name} não está rodando`, {
        detail: 'Ele sobe sozinho ao salvar. O motivo costuma estar nas últimas linhas do log:',
        log: logTail(engine) || undefined,
        steps: [`Log completo: \`server\\voice\\${engine}.log\``, 'Clique em **Salvar e testar** para tentar subir de novo.'],
      }));
  }
  return { items, level: worst(items) };
}

async function voz(provider) {
  const p = ['sapi', 'openai', 'gemini', 'elevenlabs', 'xtts', 'chatterbox'].includes(provider) ? provider : cfg.TTS_PROVIDER;
  let r;
  if (p === 'xtts' || p === 'chatterbox') r = await localVoice(p);
  else {
    const items = [];
    if (p === 'sapi') items.push(item('ok', 'Voz do Windows pronta', { detail: 'Funciona offline e sem instalar nada. Não clona voz.' }));
    else if (p === 'openai') items.push(cloudKey('da OpenAI', cfg.OPENAI_API_KEY, 'https://platform.openai.com/api-keys'));
    else if (p === 'gemini') items.push(cloudKey('do Gemini', cfg.GEMINI_API_KEY, 'https://aistudio.google.com/apikey'));
    else if (p === 'elevenlabs') {
      items.push(cloudKey('da ElevenLabs', cfg.ELEVENLABS_API_KEY, 'https://elevenlabs.io/app/settings/api-keys'));
      if (!cfg.ELEVENLABS_VOICE_ID) items.push(item('error', 'Falta o ID da voz', { steps: ['Copie o ID na sua biblioteca de vozes da ElevenLabs e cole em *ID da voz*.'] }));
    }
    r = { items, level: worst(items) };
  }
  return { provider: p, ...r };
}

async function all(iaProvider, vozProvider) {
  const [i, v] = await Promise.all([ia(iaProvider), voz(vozProvider)]);
  return { ia: i, voz: v };
}

module.exports = { all, ia, voz };
