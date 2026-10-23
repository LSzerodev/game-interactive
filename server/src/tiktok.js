// Leitura em tempo real da live do TikTok com tiktok-live-connector (2.5).
// Normaliza chat / gift / like / share / join para um formato unico e entrega ao
// "director" via eventos. Reconecta sozinho com backoff. Tudo que chega (e o que
// e descartado, com o motivo) vai para o log do painel.
//
// Os eventos chegam no formato "cru" do TikTok (protobuf):
//   chat : { user: { id, nickname, displayId, avatarThumb: { urlList } }, content }
//   gift : { user, giftId, repeatCount, repeatEnd (0/1), gift: { name, diamondCount, type } }
//   like : { user, count, total }          member: { user } (userId do topo vem "0"!)
// e tambem aceitamos o formato antigo (comment, userId, uniqueId...).
const EventEmitter = require('events');
const cfg = require('./config');
const log = require('./log');

// ---------------------------------------------------------------- normalizacao

// "0" e vazio nao sao ids validos (a mensagem de entrada traz userId "0")
const goodId = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s && s !== '0' ? s : '';
};

function normUser(d) {
  const u = (d && d.user) || {};
  const uniqueId = String(u.displayId || u.uniqueId || (d && d.uniqueId) || '').trim();
  const userId = goodId(u.id) || goodId(u.idStr) || goodId(u.userId) || goodId(d && d.userId);
  const avatar =
    (u.avatarThumb && u.avatarThumb.urlList && u.avatarThumb.urlList[0]) ||
    (u.profilePicture && u.profilePicture.urls && u.profilePicture.urls[0]) ||
    u.profilePictureUrl ||
    (d && d.profilePictureUrl) ||
    '';
  return {
    userId,
    uniqueId,
    nickname: String(u.nickname || (d && d.nickname) || uniqueId || 'visitante').trim() || 'visitante',
    avatarUrl: String(avatar),
  };
}

const normChat = (d) => ({ user: normUser(d), comment: String((d && (d.content ?? d.comment)) || '').replace(/\s+/g, ' ').trim() });

function normGift(d) {
  const g = (d && (d.gift || d.giftDetails)) || {};
  const count = Math.max(1, Number(d.repeatCount ?? d.repeat_count ?? d.comboCount) || 1);
  const coin = Math.max(0, Number(g.diamondCount ?? d.diamondCount) || 0);
  return {
    user: normUser(d),
    giftName: String(g.name || g.giftName || d.giftName || '').trim(),
    giftId: d.giftId ?? g.id,
    count,
    coinValue: coin,
    totalCoins: coin * count,
    // combos: presentes de tipo 1 chegam varias vezes enquanto a pessoa clica;
    // so vale o evento final (repeatEnd)
    streakable: Number(g.type ?? g.giftType ?? d.giftType) === 1,
    repeatEnd: Boolean(Number(d.repeatEnd ?? d.repeat_end ?? 0)),
    msgId: String((d.common && d.common.msgId) || d.msgId || ''),
  };
}

const normLike = (d) => ({ user: normUser(d), count: Math.max(1, Number(d.count ?? d.likeCount) || 1) });

// ---------------------------------------------------------------- monitor

class TikTokMonitor extends EventEmitter {
  constructor() {
    super();
    this.conn = null;
    this.state = { listening: false, error: '' };
    this.retry = 0;
    this.stopped = false;
    this.seen = new Set();
    this.warned = {};
  }

  // avisa uma vez por tipo (e a cada 25 ocorrencias) que um evento chegou em formato inesperado
  warnShape(kind, d) {
    this.warned[kind] = (this.warned[kind] || 0) + 1;
    if (this.warned[kind] % 25 === 1) {
      log.warn('tiktok', `evento "${kind}" em formato inesperado (campos: ${Object.keys(d || {}).slice(0, 12).join(', ')})`);
    }
  }

  async start(username) {
    this.stopped = false;
    this.username = username;
    const lib = require('tiktok-live-connector');
    const Conn = lib.TikTokLiveConnection || lib.WebcastPushConnection;
    const { WebcastEvent, ControlEvent } = lib;
    const ev = (a, b) => (WebcastEvent && WebcastEvent[a]) || b;

    const opts = {};
    if (cfg.TIKTOK_PROXY) {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      const agent = new SocksProxyAgent(cfg.TIKTOK_PROXY);
      opts.webClientOptions = { agent: { http: agent, https: agent } };
      opts.wsClientOptions = { agent };
    }
    this.conn = new Conn(username, opts);
    const c = this.conn;
    const safe = (name, fn) => (d) => {
      try {
        fn(d);
      } catch (e) {
        log.error('erro', `falha ao tratar ${name}: ${e.message}`);
      }
    };

    c.on(ev('CHAT', 'chat'), safe('chat', (d) => {
      log.count('chat');
      const { user, comment } = normChat(d);
      if (!comment) {
        log.count('ignored');
        this.warnShape('chat sem texto', d);
        return;
      }
      log.info('chat', `${user.nickname}: ${comment}`);
      this.emit('chat', { user, comment });
    }));

    c.on(ev('GIFT', 'gift'), safe('gift', (d) => {
      const g = normGift(d);
      if (!g.giftName) {
        log.count('ignored');
        this.warnShape('presente sem nome', d);
        return;
      }
      if (g.streakable && !g.repeatEnd) return; // combo em andamento
      if (g.msgId) {
        if (this.seen.has(g.msgId)) return;
        this.seen.add(g.msgId);
        if (this.seen.size > 2000) this.seen.clear();
      }
      log.count('gift');
      log.info('gift', `${g.user.nickname} mandou ${g.giftName} x${g.count} (${g.totalCoins} moedas)`);
      this.emit('gift', g);
    }));

    c.on(ev('LIKE', 'like'), safe('like', (d) => {
      log.count('like');
      const l = normLike(d);
      log.info('like', `${l.user.nickname} curtiu x${l.count}`);
      this.emit('like', l);
    }));
    c.on(ev('SHARE', 'share'), safe('share', (d) => {
      log.count('share');
      const user = normUser(d);
      log.info('like', `${user.nickname} compartilhou a live`);
      this.emit('share', { user, count: 1 });
    }));
    c.on(ev('FOLLOW', 'follow'), safe('follow', (d) => {
      log.count('follow');
      this.emit('follow', { user: normUser(d) });
    }));
    // alguem entrou na live
    c.on(ev('MEMBER', 'member'), safe('member', (d) => {
      log.count('join');
      const user = normUser(d);
      log.info('join', `${user.nickname} entrou na live`);
      this.emit('join', { user });
    }));

    const disc = (ControlEvent && ControlEvent.DISCONNECTED) || 'disconnected';
    c.on(disc, () => {
      this.state.listening = false;
      log.warn('tiktok', 'desconectou da live; tentando reconectar...');
      this.emit('status', this.state);
      this.reconnect();
    });
    c.on((ControlEvent && ControlEvent.ERROR) || 'error', (e) => {
      this.state.error = String((e && (e.info || e.message)) || e);
      log.error('tiktok', `erro do TikTok: ${this.state.error}`);
    });
    const streamEnd = (WebcastEvent && WebcastEvent.STREAM_END) || 'streamEnd';
    c.on(streamEnd, () => log.warn('tiktok', 'a live terminou'));

    log.info('tiktok', `conectando em @${username}...`);
    await this.connect();
  }

  async connect() {
    try {
      const st = await this.conn.connect();
      this.state = { listening: true, error: '', roomId: st && st.roomId, username: this.username };
      this.retry = 0;
      log.ok('tiktok', `ouvindo @${this.username} (sala ${this.state.roomId})`);
    } catch (e) {
      this.state = { listening: false, error: String(e.message || e), username: this.username };
      log.error('tiktok', `falha ao conectar em @${this.username}: ${this.state.error}`);
      this.reconnect();
    }
    this.emit('status', this.state);
  }

  reconnect() {
    if (this.stopped) return;
    const delay = Math.min(60000, 3000 * 2 ** Math.min(this.retry++, 5));
    log.info('tiktok', `nova tentativa em ${Math.round(delay / 1000)} s`);
    setTimeout(() => !this.stopped && this.connect(), delay);
  }

  stop() {
    this.stopped = true;
    try {
      if (this.conn) {
        this.conn.removeAllListeners(); // o "disconnected" da conexao velha nao pode reconectar
        this.conn.disconnect();
      }
    } catch {
      /* ignora */
    }
  }
}

module.exports = { TikTokMonitor, normGift, normUser, normChat, normLike };
