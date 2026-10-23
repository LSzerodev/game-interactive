// Pontuacao dos espectadores durante a live.
//   curtida  = 20 pontos cada
//   share    = 40 pontos cada
//   presente = moedas * 100 pontos (minimo 100)
// O Top 5 aparece no HUD do jogo. A cada 3 comentarios "normais" respondidos,
// um comentario de alguem do Top ganha prioridade (sem repetir a mesma pessoa
// duas vezes seguidas).
const fs = require('fs');
const path = require('path');
const { RUNS_DIR } = require('./config');

const JOIN_POINTS = 5; // ao entrar na live (so na 1a vez da pessoa)
const LIKE_POINTS = 20;
const SHARE_POINTS = 40;
const POINTS_PER_COIN = 100;
const MIN_GIFT_POINTS = 100;
const TOP_LIMIT = 5;
const NORMAL_BEFORE_TOP = 3;
const FILE = path.join(RUNS_DIR, 'top_supporters.json');

let state = { users: {}, normalSinceTop: 0, lastTopKey: '' };
let dirty = true;

function load() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    // versoes antigas gravavam todo mundo sem id na chave "0": descarta essa entrada
    delete state.users['0'];
  } catch {
    /* primeira execucao */
  }
}
function save() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}
function reset() {
  state = { users: {}, normalSinceTop: 0, lastTopKey: '' };
  dirty = true;
  save();
}

function userKey(u) {
  return String((u && (u.userId || u.uniqueId || u.nickname)) || '').trim().toLowerCase();
}

function add(u, points, field) {
  const key = userKey(u);
  if (!key) return null;
  const cur = state.users[key] || { key, points: 0, likes: 0, shares: 0, giftCoins: 0 };
  cur.displayName = u.nickname || u.uniqueId || cur.displayName || 'visitante';
  cur.username = u.uniqueId || cur.username || '';
  cur.avatarUrl = u.avatarUrl || cur.avatarUrl || '';
  cur.points += points;
  cur.last = Date.now();
  cur[field.name] = (cur[field.name] || 0) + field.n;
  state.users[key] = cur;
  dirty = true;
  save();
  return cur;
}

const recordLike = (u, count = 1) =>
  add(u, Math.max(1, count) * LIKE_POINTS, { name: 'likes', n: Math.max(1, count) });
// Entrar na live vale 5 pontos, uma unica vez por pessoa na sessao (sair e voltar nao soma de novo).
function recordJoin(u) {
  const key = userKey(u);
  if (!key || (state.users[key] && state.users[key].joined)) return null;
  const cur = add(u, JOIN_POINTS, { name: 'joins', n: 1 });
  if (cur) {
    cur.joined = true;
    save();
  }
  return cur;
}
const recordShare = (u, count = 1) =>
  add(u, Math.max(1, count) * SHARE_POINTS, { name: 'shares', n: Math.max(1, count) });
function recordGift(u, totalCoins) {
  const coins = Math.max(0, totalCoins | 0);
  return add(u, Math.max(MIN_GIFT_POINTS, coins * POINTS_PER_COIN), { name: 'giftCoins', n: coins });
}

function top() {
  return Object.values(state.users)
    .filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points || b.last - a.last)
    .slice(0, TOP_LIMIT);
}

function isTop(u) {
  const k = userKey(u);
  return top().some((x) => x.key === k);
}

// Escolhe qual comentario da lista responder primeiro.
function chooseComment(comments) {
  if (!comments.length) return null;
  const ranks = new Map(top().map((x, i) => [x.key, i]));
  if (state.normalSinceTop >= NORMAL_BEFORE_TOP) {
    const cand = comments
      .filter((c) => ranks.has(userKey(c.user)) && userKey(c.user) !== state.lastTopKey)
      .sort((a, b) => ranks.get(userKey(a.user)) - ranks.get(userKey(b.user)));
    if (cand.length) {
      state.normalSinceTop = 0;
      state.lastTopKey = userKey(cand[0].user);
      save();
      return cand[0];
    }
  }
  const chosen = comments[0];
  if (!ranks.has(userKey(chosen.user))) state.normalSinceTop += 1;
  save();
  return chosen;
}

function takeUpdate(force = false) {
  if (!force && !dirty) return null;
  dirty = false;
  return { type: 'top_supporters_update', payload: { entries: top() } };
}

load();
module.exports = {
  recordJoin, JOIN_POINTS, recordLike, recordShare, recordGift, top, isTop, chooseComment, takeUpdate, reset,
  LIKE_POINTS, SHARE_POINTS, POINTS_PER_COIN, MIN_GIFT_POINTS,
};
