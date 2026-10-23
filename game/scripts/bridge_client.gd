class_name BridgeClient
extends Node
## Cliente WebSocket do servidor (ws://127.0.0.1:9393/ws/godot).
## Reconecta sozinho. Cada mensagem JSON vira o sinal `message(type, data)`.

signal message(type: String, data: Dictionary)
signal connection_changed(connected: bool)

@export var url: String = "ws://127.0.0.1:9393/ws/godot"
@export var heartbeat_seconds: float = 5.0
@export var retry_seconds: float = 2.0

var _peer: WebSocketPeer = WebSocketPeer.new()
var _connected: bool = false
var _retry_left: float = 0.0
var _heartbeat_left: float = 0.0
var _opening: bool = false

func _ready() -> void:
	_open()

func _open() -> void:
	_peer = WebSocketPeer.new()
	var err: int = _peer.connect_to_url(url)
	_opening = err == OK
	if err != OK:
		_retry_left = retry_seconds

func send_message(type: String, payload: Dictionary = {}) -> void:
	if not _connected:
		return
	var out: Dictionary = payload.duplicate()
	out["type"] = type
	_peer.send_text(JSON.stringify(out))

func _process(delta: float) -> void:
	_peer.poll()
	var state: int = _peer.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _connected:
			_connected = true
			_opening = false
			connection_changed.emit(true)
			send_message("hello", {"client": "godot", "protocol": 1})
		while _peer.get_available_packet_count() > 0:
			var text: String = _peer.get_packet().get_string_from_utf8()
			var parsed: Variant = JSON.parse_string(text)
			if parsed is Dictionary:
				var data: Dictionary = parsed
				message.emit(str(data.get("type", "")), data)
		_heartbeat_left -= delta
		if _heartbeat_left <= 0.0:
			_heartbeat_left = heartbeat_seconds
			send_message("heartbeat")
	elif state == WebSocketPeer.STATE_CLOSED:
		if _connected:
			_connected = false
			connection_changed.emit(false)
		_opening = false
		_retry_left -= delta
		if _retry_left <= 0.0:
			_retry_left = retry_seconds
			_open()
