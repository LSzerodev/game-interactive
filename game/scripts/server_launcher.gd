class_name ServerLauncher
extends Node
## Ao abrir o jogo, inicia o servidor da live (Node: TikTok, IA, voz) se ele ainda
## nao estiver rodando, e o encerra (com a voz clonada) quando o jogo fecha.
## Assim o Live3D.exe e tudo que precisa para a live: um duplo clique.
##
## O servidor fica na pasta `server/` ao lado do .exe (ou do projeto, no editor).
## LIVE_NO_SERVER=1 desliga isso (para rodar o servidor a mao).

const PORT: int = 9393

var _pid: int = -1

func _ready() -> void:
	if OS.get_environment("LIVE_NO_SERVER") != "":
		return
	if _port_open():
		print("[servidor] ja estava rodando na porta %d, nao inicio outro" % PORT)
		return
	var script: String = _find_start_script()
	if script == "":
		push_warning("[servidor] pasta server/ nao encontrada ao lado do jogo: inicie o servidor a mao")
		return
	_pid = OS.create_process("cmd.exe", ["/c", script], false)
	if _pid <= 0:
		push_warning("[servidor] nao consegui iniciar %s" % script)
		_pid = -1
		return
	print("[servidor] iniciado (pid %d): %s" % [_pid, script])

func _find_start_script() -> String:
	var exe_dir: String = OS.get_executable_path().get_base_dir()
	var project_dir: String = ProjectSettings.globalize_path("res://").trim_suffix("/")
	for base: String in [exe_dir, exe_dir.get_base_dir(), project_dir.get_base_dir()]:
		var candidate: String = base.path_join("server").path_join("start_server.cmd")
		if FileAccess.file_exists(candidate):
			return candidate.replace("/", "\\")
	return ""

func _port_open() -> bool:
	var tcp := StreamPeerTCP.new()
	if tcp.connect_to_host("127.0.0.1", PORT) != OK:
		return false
	var start: int = Time.get_ticks_msec()
	while Time.get_ticks_msec() - start < 500:
		tcp.poll()
		match tcp.get_status():
			StreamPeerTCP.STATUS_CONNECTED:
				tcp.disconnect_from_host()
				return true
			StreamPeerTCP.STATUS_ERROR, StreamPeerTCP.STATUS_NONE:
				return false
		OS.delay_msec(10)
	return false

func _stop_server() -> void:
	if _pid <= 0:
		return
	# /T mata a arvore inteira: cmd -> node -> servidor de voz (python)
	OS.execute("taskkill", ["/PID", str(_pid), "/T", "/F"], [], true, false)
	print("[servidor] encerrado")
	_pid = -1

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE:
		_stop_server()

func _exit_tree() -> void:
	_stop_server()
