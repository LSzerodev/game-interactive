class_name LiveCharacter
extends Node3D
## Anima o personagem sobre o esqueleto importado: pose base, respiracao,
## piscar, boca (blend shapes) e aceno por codigo; as danças vem das animacoes
## do Mixamo (dance_retarget.gd), com versao por codigo como reserva.
##
## As rotacoes sao descritas no espaco do esqueleto EM POSE DE DESCANSO
## (X = esquerda do personagem, Y = cima, Z = frente) e convertidas para o
## espaco local de cada osso. Assim "baixar o braco" e simplesmente girar o
## UpperArm em torno de Z, independente de como o osso foi modelado.

enum Mode { IDLE, WAVE, DANCE }

const MOUTH_SHAPES: Dictionary = {
	"MouthOpenDown.L": 1.0, "MouthOpenDown.R": 1.0,
	"MouthOpen_Up.L": 0.45, "MouthOpen_Up.R": 0.45,
}
## Extrapola as shape keys de boca: o rig original abre pouco; acima de ~2 o
## labio comeca a serrilhar.
const MOUTH_SHAPE_GAIN: float = 2.0
## Animacoes do Mixamo (sem malha) retargetadas para o esqueleto do personagem.
const DANCE_FILES: Dictionary = {
	"jamal": "res://assets/dances/jamal.fbx",
	"confidenceholic": "res://assets/dances/confidenceholic.fbx",
}
## Palpebras: a animacao "Blink" do .glb guarda a pose fechada desses ossos.
const LID_BONES: Array[String] = ["BrowA_C.001", "BrowA_C.002"]

@export var model_scene: PackedScene = preload("res://assets/models/personagem.glb")
@export var pose_smoothing: float = 12.0

var mode: Mode = Mode.IDLE
var dance_name: String = ""
## Informado pelo BeatTracker enquanto a musica toca.
var beat_count: int = 0
var beat_phase: float = 0.0
var beat_energy: float = 0.0

var _skeleton: Skeleton3D
var _mouth: MeshInstance3D
var _teeth: MeshInstance3D
var _face: MeshInstance3D
var _bone: Dictionary = {}          # nome -> indice
var _rest_local: Dictionary = {}    # indice -> Quaternion
var _rest_global: Dictionary = {}   # indice -> Quaternion
var _current: Dictionary = {}       # indice -> Quaternion (offset suavizado)
var _model: Node3D
var _t: float = 0.0
var _mouth_open: float = 0.0
var _wave_left: float = 0.0
var _blink_left: float = 3.0
var _blink_t: float = -1.0
var _bounce: float = 0.0
var _lids: Array[Dictionary] = []  # {bone, open_rot, open_pos, open_scale, closed_rot, closed_pos, closed_scale}
var _dances: Dictionary = {}  # nome -> DanceRetarget
var _dance_t: float = 0.0
var _hips: int = -1
var _hips_rest_pos: Vector3
var _hips_parent_inv: Basis = Basis.IDENTITY
var _hips_offset: Vector3 = Vector3.ZERO

func _ready() -> void:
	_model = model_scene.instantiate()
	add_child(_model)
	_skeleton = _model.find_child("Skeleton3D", true, false) as Skeleton3D
	_mouth = _model.find_child("Mouth", true, false) as MeshInstance3D
	_teeth = _model.find_child("Teeth", true, false) as MeshInstance3D
	_face = _model.find_child("Plane", true, false) as MeshInstance3D
	for i in _skeleton.get_bone_count():
		_bone[_skeleton.get_bone_name(i)] = i
		_rest_local[i] = _skeleton.get_bone_rest(i).basis.get_rotation_quaternion()
		_rest_global[i] = _skeleton.get_bone_global_rest(i).basis.get_rotation_quaternion()
	_fix_materials(_model)
	_load_blink()
	for dance: String in DANCE_FILES:
		var r := DanceRetarget.load_from(DANCE_FILES[dance], _skeleton)
		if r:
			_dances[dance] = r
		else:
			push_warning("Dança %s sem animacao (%s): usando a versao por codigo" % [dance, DANCE_FILES[dance]])
	_hips = _bone.get("Hips", -1)
	if _hips >= 0:
		_hips_rest_pos = _skeleton.get_bone_rest(_hips).origin
		var parent: int = _skeleton.get_bone_parent(_hips)
		if parent >= 0:
			_hips_parent_inv = _skeleton.get_bone_global_rest(parent).basis.inverse()

func _load_blink() -> void:
	var player := _model.find_child("AnimationPlayer", true, false) as AnimationPlayer
	if player == null or not player.has_animation("Blink"):
		push_warning("Animacao Blink ausente: o personagem nao vai piscar")
		return
	var anim: Animation = player.get_animation("Blink")
	player.stop()
	for bone_name in LID_BONES:
		if not _bone.has(bone_name):
			continue
		var i: int = _bone[bone_name]
		var rest: Transform3D = _skeleton.get_bone_rest(i)
		var lid := {
			"bone": i,
			"open_rot": rest.basis.get_rotation_quaternion(), "open_pos": rest.origin, "open_scale": rest.basis.get_scale(),
			"closed_rot": rest.basis.get_rotation_quaternion(), "closed_pos": rest.origin, "closed_scale": rest.basis.get_scale(),
		}
		for t in anim.get_track_count():
			if String(anim.track_get_path(t).get_concatenated_subnames()) != bone_name:
				continue
			match anim.track_get_type(t):
				Animation.TYPE_ROTATION_3D:
					lid["closed_rot"] = anim.rotation_track_interpolate(t, 0.0)
				Animation.TYPE_POSITION_3D:
					lid["closed_pos"] = anim.position_track_interpolate(t, 0.0)
				Animation.TYPE_SCALE_3D:
					lid["closed_scale"] = anim.scale_track_interpolate(t, 0.0)
		_lids.append(lid)

func _set_blink(amount: float) -> void:
	for lid in _lids:
		var i: int = lid["bone"]
		_skeleton.set_bone_pose_rotation(i, (lid["open_rot"] as Quaternion).slerp(lid["closed_rot"], amount))
		_skeleton.set_bone_pose_position(i, (lid["open_pos"] as Vector3).lerp(lid["closed_pos"], amount))
		_skeleton.set_bone_pose_scale(i, (lid["open_scale"] as Vector3).lerp(lid["closed_scale"], amount))

## Materiais que o glTF nao conseguiu levar (texturas atras de nos complexos).
func _fix_materials(n: Node) -> void:
	if n is MeshInstance3D:
		var mi := n as MeshInstance3D
		for s in mi.mesh.get_surface_count():
			var src: Material = mi.mesh.surface_get_material(s)
			var mat_name: String = src.resource_name if src else ""
			var m: StandardMaterial3D = null
			match mat_name:
				"new", "Material.004":
					m = StandardMaterial3D.new()
					m.albedo_texture = preload("res://assets/textures/eye.png")
					m.roughness = 0.15
					m.cull_mode = BaseMaterial3D.CULL_DISABLED  # um dos planos de iris vem invertido
				"Material__39":
					m = StandardMaterial3D.new()
					m.albedo_texture = preload("res://assets/textures/shoes.png")
					m.roughness = 0.5
				"gold":
					m = StandardMaterial3D.new()
					m.albedo_color = Color(0.662, 0.514, 0.036).linear_to_srgb()
					m.metallic = 0.8
					m.roughness = 0.3
				"Material":
					m = StandardMaterial3D.new()
					m.albedo_color = Color("#2a0d0d")
			if m:
				mi.set_surface_override_material(s, m)
	for c in n.get_children():
		_fix_materials(c)

# ------------------------------------------------------------------ API

func set_mouth(value: float) -> void:
	_mouth_open = clampf(value, 0.0, 1.0)

func wave(seconds: float = 2.4) -> void:
	if mode != Mode.DANCE:
		mode = Mode.WAVE
		_wave_left = seconds

func start_dance(name: String) -> void:
	mode = Mode.DANCE
	dance_name = name
	beat_count = 0
	_dance_t = 0.0

func stop_dance() -> void:
	if mode == Mode.DANCE:
		mode = Mode.IDLE
		dance_name = ""

# ------------------------------------------------------------------ loop

func _process(delta: float) -> void:
	_t += delta
	if mode == Mode.WAVE:
		_wave_left -= delta
		if _wave_left <= 0.0:
			mode = Mode.IDLE

	var target: Dictionary = {}
	var retarget: DanceRetarget = _dances.get(dance_name) if mode == Mode.DANCE else null
	var hips_goal := Vector3.ZERO
	var smoothing: float = pose_smoothing
	if retarget:
		# dança do Mixamo: a animacao manda no corpo todo
		_dance_t += delta
		retarget.sample(_dance_t, target)
		hips_goal = retarget.hips_offset(_dance_t)
		smoothing = 30.0  # segue a animacao de perto (so suaviza a entrada)
	else:
		_pose_base(target)
		match mode:
			Mode.WAVE:
				_pose_wave(target)
			Mode.DANCE:
				if dance_name == "jamal":
					_pose_jamal(target)
				else:
					_pose_confidenceholic(target)
		_pose_talk(target)
	_apply(target, delta, smoothing)
	_update_face(delta)

	# deslocamento do quadril (danças do Mixamo descem/sobem o corpo)
	_hips_offset = _hips_offset.lerp(hips_goal, 1.0 - exp(-delta * smoothing))
	if _hips >= 0:
		_skeleton.set_bone_pose_position(_hips, _hips_rest_pos + _hips_parent_inv * _hips_offset)

	# quique do corpo inteiro na dança por codigo (rotacao nao tira o pe do chao)
	var bounce_target: float = 0.0
	if mode == Mode.DANCE and retarget == null:
		bounce_target = -0.12 * (0.5 + 0.5 * cos(beat_phase * TAU)) * (0.6 + beat_energy)
	_bounce = lerpf(_bounce, bounce_target, 1.0 - exp(-delta * 18.0))
	_model.position.y = _bounce

# ------------------------------------------------------------------ poses

func _rot(axis: Vector3, degrees: float) -> Quaternion:
	return Quaternion(axis, deg_to_rad(degrees))

func _add(target: Dictionary, bone_name: String, q: Quaternion) -> void:
	if not _bone.has(bone_name):
		return
	var i: int = _bone[bone_name]
	target[i] = (target.get(i, Quaternion.IDENTITY) as Quaternion) * q

## Gira DEPOIS do que ja foi aplicado (eixo do mundo, nao da T-pose): usado
## para balançar o braço inteiro ja abaixado em torno da vertical.
func _add_world(target: Dictionary, bone_name: String, q: Quaternion) -> void:
	if not _bone.has(bone_name):
		return
	var i: int = _bone[bone_name]
	target[i] = q * (target.get(i, Quaternion.IDENTITY) as Quaternion)

func _pose_base(t: Dictionary) -> void:
	var breathe: float = sin(_t * 1.7)
	# bracos para baixo e levemente a frente (o modelo esta em T-pose)
	_add(t, "UpperArm_L", _rot(Vector3.BACK, -70.0) * _rot(Vector3.UP, -12.0))
	_add(t, "UpperArm_R", _rot(Vector3.BACK, 70.0) * _rot(Vector3.UP, 12.0))
	_add(t, "ForeArm_L", _rot(Vector3.UP, -18.0))
	_add(t, "ForeArm_R", _rot(Vector3.UP, 18.0))
	_add(t, "Spine1", _rot(Vector3.RIGHT, 1.5 * breathe))
	_add(t, "Hips", _rot(Vector3.UP, 2.5 * sin(_t * 0.6)))
	_add(t, "Head", _rot(Vector3.UP, 6.0 * sin(_t * 0.45)) * _rot(Vector3.RIGHT, 2.0 * sin(_t * 0.9)))

func _pose_talk(t: Dictionary) -> void:
	if _mouth_open <= 0.01 or mode == Mode.DANCE:
		return
	# acompanha a fala com a cabeça (sem exagero)
	_add(t, "Head", _rot(Vector3.RIGHT, -5.0 * _mouth_open) * _rot(Vector3.BACK, 2.5 * sin(_t * 5.0) * _mouth_open))
	_add(t, "ForeArm_L", _rot(Vector3.BACK, 10.0 * _mouth_open * (0.5 + 0.5 * sin(_t * 3.3))))

func _pose_wave(t: Dictionary) -> void:
	# braço direito: levanta ao lado, cotovelo para cima e mao balançando
	var swing: float = sin(_t * 10.0)
	_add(t, "UpperArm_R", _rot(Vector3.BACK, -70.0 - 15.0) * _rot(Vector3.UP, -15.0))
	_add(t, "ForeArm_R", _rot(Vector3.UP, -18.0) * _rot(Vector3.BACK, -75.0 + 22.0 * swing))
	_add(t, "Hand_R", _rot(Vector3.BACK, 12.0 * swing))
	_add(t, "Head", _rot(Vector3.BACK, -5.0) * _rot(Vector3.UP, -8.0))

func _side() -> float:
	# alterna o lado a cada batida, com transicao suave dentro da batida
	var dir: float = 1.0 if beat_count % 2 == 0 else -1.0
	return dir * sin(clampf(beat_phase, 0.0, 1.0) * PI)

func _pose_jamal(t: Dictionary) -> void:
	# passinho: cotovelos dobrados a frente, maos indo de um lado ao outro,
	# quadril balançando e joelhos alternando a cada batida
	var s: float = _side()
	var e: float = 0.6 + beat_energy
	# antebraços apontando para frente (a base ja dobra 18 graus)
	_add(t, "ForeArm_L", _rot(Vector3.UP, -42.0))
	_add(t, "ForeArm_R", _rot(Vector3.UP, 42.0))
	# os dois braços varrem juntos de um lado para o outro
	_add_world(t, "UpperArm_L", _rot(Vector3.UP, 28.0 * s))
	_add_world(t, "UpperArm_R", _rot(Vector3.UP, 28.0 * s))
	_add(t, "Spine1", _rot(Vector3.UP, 14.0 * s * e))
	_add(t, "Hips", _rot(Vector3.BACK, 7.0 * s * e) * _rot(Vector3.UP, -8.0 * s))
	var kick_l: float = maxf(0.0, s)
	var kick_r: float = maxf(0.0, -s)
	_add(t, "Thigh_L", _rot(Vector3.RIGHT, -22.0 * kick_l * e))
	_add(t, "Calf_L", _rot(Vector3.RIGHT, 30.0 * kick_l * e))
	_add(t, "Thigh_R", _rot(Vector3.RIGHT, -22.0 * kick_r * e))
	_add(t, "Calf_R", _rot(Vector3.RIGHT, 30.0 * kick_r * e))
	_add(t, "Head", _rot(Vector3.BACK, -6.0 * s) * _rot(Vector3.RIGHT, 5.0 * (1.0 - beat_phase)))

func _pose_confidenceholic(t: Dictionary) -> void:
	# braço alterna apontando para cima, cabeça marcando a batida,
	# quadril fazendo "oito" e ombro quicando
	var s: float = _side()
	var e: float = 0.6 + beat_energy
	var up_l: float = maxf(0.0, s)
	var up_r: float = maxf(0.0, -s)
	# da posicao abaixada (-70) ate apontar para cima (+75): 145 graus
	_add_world(t, "UpperArm_L", _rot(Vector3.BACK, 145.0 * up_l))
	_add_world(t, "UpperArm_R", _rot(Vector3.BACK, -145.0 * up_r))
	_add(t, "ForeArm_L", _rot(Vector3.UP, -30.0 * (1.0 - up_l)))
	_add(t, "ForeArm_R", _rot(Vector3.UP, 30.0 * (1.0 - up_r)))
	_add(t, "Hips", _rot(Vector3.BACK, 9.0 * sin(_t * 4.0) * e) * _rot(Vector3.UP, 12.0 * s))
	_add(t, "Spine1", _rot(Vector3.BACK, -6.0 * s) * _rot(Vector3.RIGHT, 4.0 * (1.0 - beat_phase)))
	_add(t, "Head", _rot(Vector3.RIGHT, 9.0 * (1.0 - beat_phase) * e) * _rot(Vector3.BACK, 8.0 * s))
	_add(t, "Thigh_L", _rot(Vector3.RIGHT, -10.0 * up_r))
	_add(t, "Thigh_R", _rot(Vector3.RIGHT, -10.0 * up_l))

# ------------------------------------------------------------------ aplicar

func _apply(target: Dictionary, delta: float, smoothing: float) -> void:
	var k: float = 1.0 - exp(-delta * smoothing)
	var touched: Dictionary = {}
	for i: int in target:
		touched[i] = true
	for i: int in _current:
		touched[i] = true
	for i: int in touched:
		var goal: Quaternion = target.get(i, Quaternion.IDENTITY)
		var cur: Quaternion = (_current.get(i, Quaternion.IDENTITY) as Quaternion).slerp(goal, k)
		_current[i] = cur
		var g: Quaternion = _rest_global[i]
		var local: Quaternion = (_rest_local[i] as Quaternion) * (g.inverse() * cur * g)
		_skeleton.set_bone_pose_rotation(i, local.normalized())

func _set_shape(mi: MeshInstance3D, shape: String, value: float) -> void:
	if mi == null:
		return
	var idx: int = mi.find_blend_shape_by_name(shape)
	if idx >= 0:
		mi.set_blend_shape_value(idx, value)

func _update_face(delta: float) -> void:
	var mouth: float = _mouth_open
	if mode == Mode.DANCE:
		mouth = 0.25 * beat_energy  # sorriso aberto no ritmo, sem "falar"
	for shape: String in MOUTH_SHAPES:
		_set_shape(_mouth, shape, mouth * float(MOUTH_SHAPES[shape]) * MOUTH_SHAPE_GAIN)
	_set_shape(_teeth, "Open", mouth)
	_set_shape(_mouth, "Smile.L", 0.35 if mode != Mode.IDLE else 0.15)
	_set_shape(_mouth, "Smile.R", 0.35 if mode != Mode.IDLE else 0.15)

	# piscar a cada 2-5 s
	_blink_left -= delta
	if _blink_left <= 0.0 and _blink_t < 0.0:
		_blink_t = 0.0
		_blink_left = randf_range(2.0, 5.0)
	var blink: float = 0.0
	if _blink_t >= 0.0:
		_blink_t += delta
		blink = sin(clampf(_blink_t / 0.16, 0.0, 1.0) * PI)
		if _blink_t >= 0.16:
			_blink_t = -1.0
	_set_blink(blink)
