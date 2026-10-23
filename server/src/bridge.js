// Ponte WebSocket servidor <-> Godot (ws://127.0.0.1:PORT/ws/godot).
// Servidor -> Godot: server_hello, speech_ready, dance_start, top_supporters_update
// Godot -> servidor: hello, heartbeat, speech_finished, dance_finished
const { WebSocketServer } = require('ws');
const EventEmitter = require('events');

class Bridge extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.lastByType = {};
  }

  attach(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws/godot' });
    wss.on('connection', (ws) => {
      // um unico renderizador oficial por vez
      if (this.socket && this.socket.readyState === 1) this.socket.close();
      this.socket = ws;
      this.send({ type: 'server_hello', protocol: 1 });
      this.emit('connected');
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        this.lastByType[msg.type] = { ...msg, _at: Date.now() };
        if (msg.type === 'hello') this.send({ type: 'hello_ack', time: Date.now() / 1000 });
        if (msg.type === 'heartbeat') this.send({ type: 'heartbeat_ack', time: Date.now() / 1000 });
        this.emit(msg.type, msg);
      });
      ws.on('close', () => {
        if (this.socket === ws) this.socket = null;
        this.emit('disconnected');
      });
    });
  }

  get connected() {
    return !!this.socket && this.socket.readyState === 1;
  }

  send(msg) {
    if (!this.connected) return false;
    this.socket.send(JSON.stringify({ time: Date.now() / 1000, ...msg }));
    return true;
  }
}

module.exports = new Bridge();
