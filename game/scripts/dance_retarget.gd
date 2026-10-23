class_name DanceRetarget
extends RefCounted
## Toca uma animacao do Mixamo (FBX sem malha) no esqueleto do personagem.
##
## Para cada osso mapeado calcula a rotacao GLOBAL que a animacao aplica em
## relacao a T-pose do Mixamo (delta = global_animado * global_descanso^-1).
## Como os dois esqueletos estao em T-pose, olham para +Z e tem Y para cima,
## esse delta vale igual no personagem, sem depender dos eixos de cada osso.
## O resultado sai no mesmo formato de LiveCharacter._apply (rotacao relativa
## ao ancestral mapeado), entao entra direto no sistema de poses.

const MAP: Dictionary = {
	"mixamorig_Hips": "Hips",
	"mixamorig_Spine": "Spine",
	"mixamorig_Spine2": "Spine1",
	"mixamorig_Neck": "Neck",
	"mixamorig_Head": "Head",
	"mixamorig_LeftShoulder": "Shoulder_L",
	"mixamorig_LeftArm": "UpperArm_L",
	"mixamorig_LeftForeArm": "ForeArm_L",
	"mixamorig_LeftHand": "Hand_L",
	"mixamorig_RightShoulder": "Shoulder_R",
	"mixamorig_RightArm": "UpperArm_R",
	"mixamorig_RightForeArm": "ForeArm_R",
	"mixamorig_RightHand": "Hand_R",
	"mixamorig_LeftUpLeg": "Thigh_L",
	"mixamorig_LeftLeg": "Calf_L",
	"mixamorig_LeftFoot": "Foot_L",
	"mixamorig_LeftToeBase": "Toe_L",
	"mixamorig_RightUpLeg": "Thigh_R",
	"mixamorig_RightLeg": "Calf_R",
	"mixamorig_RightFoot": "Foot_R",
	"mixamorig_RightToeBase": "Toe_R",
}

var length: float = 0.0
var _anim: Animation
var _src_parent: PackedInt32Array = PackedInt32Array()
var _src_rest_local: Array[Quaternion] = []
var _src_rest_global: Array[Quaternion] = []
var _src_rot_track: PackedInt32Array = PackedInt32Array()
var _src_names: PackedStringArray = PackedStringArray()
var _hips_src: int = -1
var _hips_pos_track: int = -1
var _hips_rest_pos: Vector3
var _drift: Vector3 = Vector3.ZERO
var _scale: float = 1.0
## osso do personagem -> [indice na origem, indice do ancestral mapeado na origem]
var _targets: Array[Dictionary] = []

static func load_from(path: String, skeleton: Skeleton3D) -> DanceRetarget:
	if not ResourceLoader.exists(path):
		return null
	var scene: Node = (load(path) as PackedScene).instantiate()
	var sk: Skeleton3D = null
	for n in scene.find_children("*", "Skeleton3D", true, false):
		sk = n
	var players := scene.find_children("*", "AnimationPlayer", true, false)
	if sk == null or players.is_empty():
		scene.free()
		return null
	var player := players[0] as AnimationPlayer
	var r := DanceRetarget.new()
	r._anim = player.get_animation(player.get_animation_list()[0])
	r.length = r._anim.length
	r._setup(sk, skeleton)
	scene.free()
	return r

func _setup(src: Skeleton3D, dst: Skeleton3D) -> void:
	var n: int = src.get_bone_count()
	for i in n:
		_src_names.append(src.get_bone_name(i))
		_src_parent.append(src.get_bone_parent(i))
		_src_rest_local.append(src.get_bone_rest(i).basis.get_rotation_quaternion())
		_src_rest_global.append(src.get_bone_global_rest(i).basis.get_rotation_quaternion())
		_src_rot_track.append(-1)
	for t in _anim.get_track_count():
		var bone_name: String = String(_anim.track_get_path(t).get_concatenated_subnames())
		var i: int = src.find_bone(bone_name)
		if i < 0:
			continue
		if _anim.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			_src_rot_track[i] = t
		elif _anim.track_get_type(t) == Animation.TYPE_POSITION_3D and bone_name == "mixamorig_Hips":
			_hips_pos_track = t
	_hips_src = src.find_bone("mixamorig_Hips")
	_hips_rest_pos = src.get_bone_global_rest(_hips_src).origin
	# tamanho: altura do quadril do personagem / do Mixamo
	var dst_hips: int = dst.find_bone("Hips")
	_scale = dst.get_bone_global_rest(dst_hips).origin.y / maxf(0.001, _hips_rest_pos.y)
	# deslocamento horizontal acumulado no loop (tirado para nao "pular" ao reiniciar)
	if _hips_pos_track >= 0:
		var a: Vector3 = _anim.position_track_interpolate(_hips_pos_track, 0.0)
		var b: Vector3 = _anim.position_track_interpolate(_hips_pos_track, length)
		_drift = Vector3(b.x - a.x, 0.0, b.z - a.z)
	for src_name: String in MAP:
		var si: int = src.find_bone(src_name)
		var di: int = dst.find_bone(MAP[src_name])
		if si < 0 or di < 0:
			continue
		# ancestral mapeado mais proximo NO PERSONAGEM, convertido para a origem
		var parent_src: int = -1
		var p: int = dst.get_bone_parent(di)
		while p >= 0 and parent_src < 0:
			var pname: String = dst.get_bone_name(p)
			for k: String in MAP:
				if MAP[k] == pname:
					parent_src = src.find_bone(k)
					break
			p = dst.get_bone_parent(p)
		_targets.append({"dst": di, "src": si, "parent_src": parent_src})

## Rotacao global da origem no tempo t (cadeia de pais, ossos sem trilha em descanso).
func _globals(t: float) -> Array[Quaternion]:
	var out: Array[Quaternion] = []
	out.resize(_src_names.size())
	for i in _src_names.size():
		var local: Quaternion = _src_rest_local[i]
		if _src_rot_track[i] >= 0:
			local = _anim.rotation_track_interpolate(_src_rot_track[i], t)
		var p: int = _src_parent[i]
		out[i] = (out[p] * local) if p >= 0 else local
	return out

## Preenche target (indice do osso do personagem -> Quaternion) no tempo t.
func sample(t: float, target: Dictionary) -> void:
	var tt: float = fposmod(t, length)
	var g := _globals(tt)
	var delta: Dictionary = {}
	for e in _targets:
		var si: int = e["src"]
		delta[si] = g[si] * _src_rest_global[si].inverse()
	for e in _targets:
		var r: Quaternion = delta[e["src"]]
		var ps: int = e["parent_src"]
		if ps >= 0 and delta.has(ps):
			r = (delta[ps] as Quaternion).inverse() * r
		target[e["dst"]] = r.normalized()

## Deslocamento do quadril no espaco do esqueleto do personagem.
func hips_offset(t: float) -> Vector3:
	if _hips_pos_track < 0:
		return Vector3.ZERO
	var tt: float = fposmod(t, length)
	var p: Vector3 = _anim.position_track_interpolate(_hips_pos_track, tt)
	var start: Vector3 = _anim.position_track_interpolate(_hips_pos_track, 0.0)
	var d: Vector3 = p - _hips_rest_pos - _drift * (tt / length)
	d.x -= start.x - _hips_rest_pos.x  # comeca centralizado
	d.z -= start.z - _hips_rest_pos.z
	return d * _scale
