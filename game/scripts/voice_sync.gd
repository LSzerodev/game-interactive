class_name VoiceSync
extends Node
## Toca o audio da fala (ou da musica) e transforma o ENVELOPE enviado pelo
## servidor em abertura de boca, lendo a posicao REAL de reproducao a cada
## frame. Assim a boca acompanha o audio mesmo se o jogo travar um instante.

signal mouth_changed(value: float)
signal clip_started(job_id: String, kind: String)
signal clip_finished(job_id: String, kind: String)

@export var smoothing: float = 28.0  # maior = boca mais "rapida"

var _main_player: AudioStreamPlayer
var _vocal_player: AudioStreamPlayer  # so em musicas separadas (vocal + instrumental)
var _envelope: PackedFloat32Array = PackedFloat32Array()
var _hop: float = 0.03
var _job_id: String = ""
var _kind: String = ""
var _active: bool = false
var _mouth: float = 0.0
var _gain: float = 1.0

func _ready() -> void:
	_main_player = AudioStreamPlayer.new()
	_vocal_player = AudioStreamPlayer.new()
	add_child(_main_player)
	add_child(_vocal_player)
	_main_player.finished.connect(_on_finished)

func is_active() -> bool:
	return _active

## kind: "speech" ou "song". `vocal_path` opcional (musica separada).
func play_clip(job_id: String, audio_path: String, envelope: Array, hop: float, kind: String = "speech", vocal_path: String = "", volume_db: float = 0.0) -> bool:
	stop_clip(false)
	var stream: AudioStreamWAV = WavLoader.load_wav(audio_path)
	if stream == null:
		return false
	_envelope = PackedFloat32Array()
	for v: Variant in envelope:
		_envelope.append(float(v))
	_hop = maxf(0.005, hop)
	_job_id = job_id
	_kind = kind
	_main_player.stream = stream
	_main_player.volume_db = volume_db
	_main_player.play()
	if vocal_path != "":
		var vocal: AudioStreamWAV = WavLoader.load_wav(vocal_path)
		if vocal != null:
			_vocal_player.stream = vocal
			_vocal_player.volume_db = volume_db
			_vocal_player.play()
	_active = true
	clip_started.emit(job_id, kind)
	return true

func stop_clip(emit_finished: bool = true) -> void:
	var was_active: bool = _active
	_main_player.stop()
	_vocal_player.stop()
	_active = false
	_envelope = PackedFloat32Array()
	if was_active and emit_finished:
		clip_finished.emit(_job_id, _kind)
	_mouth = 0.0
	mouth_changed.emit(0.0)

func _on_finished() -> void:
	if not _active:
		return
	_active = false
	_vocal_player.stop()
	clip_finished.emit(_job_id, _kind)

func _process(delta: float) -> void:
	var target: float = 0.0
	if _active and _main_player.playing:
		# posicao real do audio, compensando a latencia de saida
		var t: float = _main_player.get_playback_position() + AudioServer.get_time_since_last_mix() - AudioServer.get_output_latency()
		var index: int = int(maxf(0.0, t) / _hop)
		if index < _envelope.size():
			target = _envelope[index]
	_mouth = lerpf(_mouth, target, 1.0 - exp(-delta * smoothing))
	mouth_changed.emit(_mouth)
