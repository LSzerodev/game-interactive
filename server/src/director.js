// "Diretor" da live: decide a reacao a cada evento do TikTok.
//   comentario -> caixa COMENTARIO + resposta falada (Ollama, boca sincronizada)
//   Tiny Diny  -> dança do Jamal (depois agradece)
//   Donut      -> dança ConfidenceHolic (depois agradece)
//   Rosa       -> so agradece pela rosa
//   entrada    -> acena e fala o nome (agrupa quem chega junto)
//   like/share -> pontuam no TOP 5
// As falas sao geradas em CHUNKS (ver ai.js e speech.js).
const bridge = require('./bridge');
const speech = require('./speech');
const ai = require('./ai');
const scoring = require('./scoring');
const gifts = require('./gifts');
const log = require('./log');

const { PRIORITY } = speech;
const MAX_COMMENT = 150;
const MAX_COMMENTS_WAITING = 20;
const WELCOME_EVERY_MS = 4000;
const WELCOME_MAX_NAMES = 3;
const OTHER_GIFT_COOLDOWN_MS = 8000;

const comments = [];
let busy = false;
let joins = [];
let welcomeTimer = null;
let lastWelcomeAt = 0;
const lastOtherThanks = {};

const userMeta = (u) => ({
  display_name: u.nickname,
  username: u.uniqueId,
  user_id: u.userId || u.uniqueId,
  avatar_url: u.avatarUrl,
});

// ------------------------------------------------------------ comentarios

function onChat({ user, comment }) {
  const text = comment.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT);
  if (!text) return;
  if (/https?:\/\/|www\./i.test(text)) {
    log.count('ignored');
    log.warn('chat', `ignorado (link): ${user.nickname}: ${text.slice(0, 60)}`);
    return;
  }
  if (ai.isBlocked(text)) {
    log.count('ignored');
    log.warn('chat', `ignorado (termo bloqueado): ${user.nickname}`);
    return;
  }
  if (comments.length >= MAX_COMMENTS_WAITING) {
    const dropped = comments.shift();
    log.warn('chat', `fila de comentarios cheia: descartei o mais antigo (${dropped.user.nickname})`);
  }
  comments.push({ user, text, at: Date.now() });
  drain();
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (comments.length) {
      // nao acumula respostas: espera a fila de fala andar
      while (speech.status().pending > 1) await new Promise((r) => setTimeout(r, 400));
      const chosen = scoring.chooseComment(comments);
      comments.splice(comments.indexOf(chosen), 1);
      const meta = userMeta(chosen.user);
      const top = scoring.isTop(chosen.user);
      const key = String(chosen.user.userId || chosen.user.uniqueId || chosen.user.nickname);
      log.info('ia', `vou responder ${chosen.user.nickname}${top ? ' (TOP 5, prioridade)' : ''}; ${comments.length} na fila`);
      // A caixa COMENTARIO e atualizada pelo jogo quando a RESPOSTA comeca
      // (metadata.in_reply_to), senao ela mostraria outro comentario enquanto o
      // personagem ainda responde este. A resposta e gerada em chunks: o 1o ja
      // fala enquanto o resto ainda esta sendo escrito.
      speech.enqueueStream(() => ai.replyStream(key, chosen.user.nickname, chosen.text), {
        priority: top ? PRIORITY.top_comment : PRIORITY.comment,
        metadata: { ...meta, kind: 'comment', in_reply_to: chosen.text },
      });
    }
  } finally {
    busy = false;
  }
}

// ------------------------------------------------------------ presentes

function onGift(g) {
  const meta = userMeta(g.user);
  scoring.recordGift(g.user, g.totalCoins);
  pushTop();
  const action = gifts.actionFor(g.giftName);
  log.ok('placar', `${g.user.nickname}: +${Math.max(100, g.totalCoins * 100)} pontos pelo presente`);
  const what = action.action === 'dance' ? `dança ${action.dance}` : action.action === 'thanks_rose' ? 'só agradece a rosa' : 'agradecimento simples';
  log.ok('gift', `"${g.giftName}" -> ${what}`);
  if (action.action === 'dance') {
    speech.enqueueDance(action.dance, { ...meta, gift_name: g.giftName, gift_count: g.count });
    speech.enqueueStream(() => ai.thanksGiftStream(g.user.nickname, g.giftName, g.count), {
      priority: PRIORITY.thanks - 1, // logo depois da dança
      metadata: { ...meta, kind: 'thanks' },
    });
  } else if (action.action === 'thanks_rose') {
    speech.enqueueStream(() => ai.thanksRoseStream(g.user.nickname), {
      priority: PRIORITY.thanks,
      metadata: { ...meta, kind: 'thanks' },
    });
  } else {
    const now = Date.now();
    if (now - (lastOtherThanks[action.key] || 0) < OTHER_GIFT_COOLDOWN_MS && g.totalCoins < 30) return;
    lastOtherThanks[action.key] = now;
    speech.enqueueStream(() => ai.thanksGiftStream(g.user.nickname, g.giftName, g.count), {
      priority: PRIORITY.thanks,
      metadata: { ...meta, kind: 'thanks' },
    });
  }
}

// ------------------------------------------------------------ entrada na live

function onJoin({ user }) {
  if (!user || !user.nickname) return;
  if (scoring.recordJoin(user)) {
    pushTop(); // +5 pontos e ja aparece no TOP 5
    log.ok('placar', `${user.nickname}: +${scoring.JOIN_POINTS} pontos por entrar`);
  }
  if (joins.some((j) => j.nickname === user.nickname)) return;
  joins.push(user);
  scheduleWelcome();
}

function scheduleWelcome() {
  if (welcomeTimer) return;
  const wait = Math.max(0, WELCOME_EVERY_MS - (Date.now() - lastWelcomeAt));
  welcomeTimer = setTimeout(() => {
    welcomeTimer = null;
    if (!joins.length) return;
    // em live cheia nao da para saudar todo mundo: pega os mais recentes
    const group = joins.slice(-WELCOME_MAX_NAMES);
    joins = [];
    lastWelcomeAt = Date.now();
    // se ja ha muita coisa na fila, a saudacao perde a vez
    // boas-vindas so quando o Sonic esta livre: com a voz clonada lenta elas atrasariam
    // a resposta de quem esta comentando
    if (speech.status().busy || speech.status().pending > 0) {
      log.info('fala', `boas-vindas puladas (o Sonic está ocupado): ${group.map((u) => u.nickname).join(', ')}`);
      return;
    }
    log.info('join', `vou dar boas-vindas a: ${group.map((u) => u.nickname).join(', ')}`);
    speech.enqueueStream(() => ai.welcomeStream(group.map((u) => u.nickname)), {
      priority: PRIORITY.welcome,
      metadata: { ...userMeta(group[group.length - 1]), kind: 'welcome', gesture: 'wave' },
    });
  }, wait);
}

// ------------------------------------------------------------ pontuacao

function pushTop(force = false) {
  const msg = scoring.takeUpdate(force);
  if (msg) bridge.send(msg);
}

function wire(monitor) {
  monitor.on('chat', onChat);
  monitor.on('gift', (g) => {
    try {
      onGift(g);
    } catch (e) {
      console.warn('[presente]', e.message);
    }
  });
  monitor.on('join', onJoin);
  monitor.on('like', ({ user, count }) => {
    scoring.recordLike(user, count);
    pushTop();
  });
  monitor.on('share', ({ user, count }) => {
    scoring.recordShare(user, count);
    pushTop();
    log.ok('placar', `${user.nickname}: +${scoring.SHARE_POINTS * count} pontos por compartilhar`);
  });
}

bridge.on('connected', () => {
  pushTop(true);
  log.ok('jogo', 'jogo conectado ao servidor');
});
bridge.on('disconnected', () => log.warn('jogo', 'jogo desconectou do servidor'));

module.exports = { wire, onChat, onGift, onJoin, pushTop };
