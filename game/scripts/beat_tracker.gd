class_name BeatTracker
extends Node
## Toca a musica da dança num bus proprio com analisador de espectro e detecta
## as batidas em tempo real pela energia dos graves (40-160 Hz). O personagem
## usa beat_count/beat_phase para trocar de passo exatamente na batida.

signal finished

const BUS_NAME: String = "Music"
const MIN_BEAT_GAP: float = 0.24
const FALLBACK_BPM: float = 130.0

@export var max_seconds: float = 20.0
@export var fade_seconds: float = 1.2

var beat_count: int = 0
var beat_phase: float = 0.0
var energy: float = 0.0  # 0..1 normalizada

var _player: AudioStreamPlayer
var _analyzer: AudioEffectSpectrumAnalyzerInstance
var _avg: float = 0.0
var _peak: float = 0.0001
var _last_beat: float = -10.0
var _interval: float = 60.0 / FALLBACK_BPM
var _time: float = 0.0
var _playing: bool = false

func _ready() -> void:
	var bus: int = AudioServer.get_bus_index(BUS_NAME)
	if bus < 0:
		AudioServer.add_bus()
		bus = AudioServer.bus_count - 1
		AudioServer.set_bus_name(bus, BUS_NAME)
		AudioServer.add_bus_effect(bus, AudioEffectSpectrumAnalyzer.new())
	_analyzer = AudioServer.get_bus_effect_instance(bus, 0) as AudioEffectSpectrumAnalyzerInstance
	_player = AudioStreamPlayer.new()
	_player.bus = BUS_NAME
	add_child(_player)
	_player.finished.connect(stop)

func is_playing() -> bool:
	return _playing

func play(stream: AudioStream, volume_db: float = -3.0) -> void:
	_player.stream = stream
	_player.volume_db = volume_db
	_player.play()
	_playing = true
	_time = 0.0
	beat_count = 0
	_last_beat = -10.0
	_avg = 0.0
	_peak = 0.0001

func stop() -> void:
	if not _playing:
		return
	_playing = false
	_player.stop()
	energy = 0.0
	finished.emit()

func _process(delta: float) -> void:
	if not _playing:
		return
	_time += delta
	# fade-out e corte no limite de duracao
	var left: float = max_seconds - _time
	if left <= 0.0:
		stop()
		return
	if left < fade_seconds:
		_player.volume_db = lerpf(-40.0, -3.0, left / fade_seconds)

	var mag: Vector2 = _analyzer.get_magnitude_for_frequency_range(40.0, 160.0) if _analyzer else Vector2.ZERO
	var e: float = mag.length()
	_peak = maxf(_peak * 0.995, e)
	energy = clampf(e / _peak, 0.0, 1.0)
	_avg = lerpf(_avg, e, 1.0 - exp(-delta * 3.0))

	var since: float = _time - _last_beat
	var onset: bool = e > _avg * 1.35 and e > _peak * 0.35 and since > MIN_BEAT_GAP
	# sem batida detectada por muito tempo: segue o andamento estimado
	if not onset and since > _interval * 1.5:
		onset = true
	if onset:
		if since < 1.2 and since > MIN_BEAT_GAP:
			_interval = lerpf(_interval, since, 0.25)
		_last_beat = _time
		beat_count += 1
	beat_phase = clampf((_time - _last_beat) / _interval, 0.0, 1.0)
