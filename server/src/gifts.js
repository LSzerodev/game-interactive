// Presentes do TikTok -> reacao do personagem (config/gift_actions.json).
//   dance  : toca a musica e dança (Tiny Diny -> Jamal, Donut -> ConfidenceHolic)
//   thanks : so agradece falando (Rosa)
// Presentes fora do mapa: so pontuam e recebem um agradecimento curto.
const fs = require('fs');
const path = require('path');
const { ROOT, PRIVATE_DIR } = require('./config');

function giftKey(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

let cache = null;
let cacheAt = 0;
function loadActions() {
  if (cache && Date.now() - cacheAt < 5000) return cache; // permite editar sem reiniciar
  const files = [path.join(PRIVATE_DIR, 'gift_actions.json'), path.join(ROOT, 'config', 'gift_actions.json')];
  cache = {};
  for (const f of files) {
    try {
      cache = JSON.parse(fs.readFileSync(f, 'utf8')).gifts || {};
      break;
    } catch {
      /* tenta o proximo */
    }
  }
  cacheAt = Date.now();
  return cache;
}

function actionFor(giftName) {
  const key = giftKey(giftName);
  const actions = loadActions();
  if (actions[key]) return { key, ...actions[key] };
  // aceita variacoes: "Tiny Diny" chega as vezes como "tinydiny"
  const compact = key.replace(/-/g, '');
  for (const [k, v] of Object.entries(actions)) {
    if (k.replace(/-/g, '') === compact) return { key: k, ...v };
  }
  return { key, action: 'other' };
}

module.exports = { giftKey, actionFor };
