extends Node
## Liga o servidor da live ao personagem:
##   speech_ready  -> toca a voz, boca sincronizada (+ aceno se gesture="wave";
##                    resposta de comentario atualiza a caixa COMENTARIO)
##   dance_start   -> musica + dança na batida; ao fim envia dance_finished
##   top_supporters_update -> TOP 5

const DANCE_MUSIC: Dictionary = {
	"jamal": "res://assets/music/jamal.mp3",
	"confidenceholic": "res://assets/music/confidenceholic.mp3",
}

@onready var character: LiveCharacter = $Stage/Character
var voice: VoiceSync
var beat: BeatTracker
var hud: LiveHud
var bridge: BridgeClient
var _dance_job: String = ""
var _speech_queue: Array[Dictionary] = []
var _more_coming: bool = false  # a resposta atual ainda tem mais frases a caminho

func _ready() -> void:
	add_child(ServerLauncher.new())  # abre o servidor da live junto com o jogo

	voice = VoiceSync.new()
	add_child(voice)
	voice.mouth_changed.connect(character.set_mouth)
	voice.clip_finished.connect(_on_clip_finished)

	beat = BeatTracker.new()
	add_child(beat)
	beat.finished.connect(_on_dance_finished)

	hud = LiveHud.new()
	add_child(hud)

	bridge = BridgeClient.new()
	var url: String = OS.get_environment("LIVE_WS_URL")
	if url != "":
		bridge.url = url
	add_child(bridge)
	bridge.message.connect(_on_message)
	bridge.connection_changed.connect(hud.set_connected)

func _process(_delta: float) -> void:
	if beat.is_playing():
		character.beat_count = beat.beat_count
		character.beat_phase = beat.beat_phase
		character.beat_energy = beat.energy

func _on_message(type: String, data: Dictionary) -> void:
	var p: Dictionary = data.get("payload", {}) if data.get("payload") is Dictionary else {}
	match type:
		"speech_ready":
			_on_speech(p)
		"comment_show":
			# o comentario aparece NA HORA, sem esperar a voz ficar pronta
			hud.show_comment(str(p.get("display_name", "")), str(p.get("text", "")), str(p.get("avatar_url", "")))
			hud.set_thinking(true)
		"thinking_end":
			hud.set_thinking(false)
		"dance_start":
			_on_dance(p)
		"top_supporters_update":
			hud.set_top(p.get("entries", []) if p.get("entries") is Array else [])

## A resposta chega em chunks (frases). Cada chunk entra numa fila e toca assim
## que o anterior termina, sem esperar nenhuma ida e volta com o servidor.
func _on_speech(p: Dictionary) -> void:
	if voice.is_active():
		_speech_queue.append(p)
	else:
		_play_speech(p)

func _play_speech(p: Dictionary) -> void:
	var job: String = str(p.get("job_id", ""))
	var meta: Dictionary = p.get("metadata", {}) if p.get("metadata") is Dictionary else {}
	var ok: bool = voice.play_clip(job, str(p.get("audio_path", "")), p.get("envelope", []), float(p.get("hop", 0.03)))
	if not ok:
		bridge.send_message("speech_finished", {"job_id": job, "error": "audio_load_failed"})
		_next_speech()
		return
	hud.set_thinking(false)  # falando (ou voltou a falar depois de uma pausa)
	_more_coming = bool(meta.get("more", false))
	if int(meta.get("chunk_index", 0)) != 0:
		return  # caixa e aceno so no primeiro chunk da resposta
	if str(meta.get("kind", "")) == "comment":
		hud.show_comment(str(meta.get("display_name", "")), str(meta.get("in_reply_to", "")), str(meta.get("avatar_url", "")))
	if str(meta.get("gesture", "")) == "wave":
		character.wave(clampf(float(p.get("timeline_end", 2.0)), 1.6, 3.5))
		hud.show_banner("Bem-vindo, %s!" % str(meta.get("display_name", "")), 2.5)

func _next_speech() -> void:
	if not _speech_queue.is_empty() and not voice.is_active():
		_play_speech(_speech_queue.pop_front())

func _on_clip_finished(job_id: String, _kind: String) -> void:
	bridge.send_message("speech_finished", {"job_id": job_id})
	_next_speech()
	# acabou a frase e a proxima ainda esta sendo gerada: mostra "pensando..." na pausa
	if _more_coming and not voice.is_active() and _speech_queue.is_empty():
		hud.set_thinking(true)

func _on_dance(p: Dictionary) -> void:
	var dance: String = str(p.get("dance", "jamal"))
	var path: String = DANCE_MUSIC.get(dance, "")
	_dance_job = str(p.get("job_id", ""))
	if path == "" or not ResourceLoader.exists(path):
		_on_dance_finished()
		return
	_speech_queue.clear()
	if voice.is_active():
		voice.stop_clip()
	beat.max_seconds = clampf(float(p.get("max_seconds", 20.0)), 5.0, 60.0)
	beat.play(load(path) as AudioStream)
	character.start_dance(dance)
	var who: String = str(p.get("display_name", ""))
	var gift: String = str(p.get("gift_name", ""))
	hud.show_banner("%s mandou %s!" % [who, gift] if who != "" else "Dança!", 3.0)

func _on_dance_finished() -> void:
	character.stop_dance()
	if _dance_job != "":
		bridge.send_message("dance_finished", {"job_id": _dance_job})
		_dance_job = ""
