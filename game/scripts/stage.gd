extends Node3D
## Cenario fixo da live (layout de ref-game-3d/prototipo-final-de-como-deve-ficar.png):
## ceu (foto sky-background ao fundo), palmeira a direita, duas rochas nos cantos, ilha embaixo com
## grama onde o personagem pisa. Os modelos vieram sem as texturas originais,
## entao as cores sao definidas aqui.

@export var island_scale: float = 0.55
## Posicao da ilha (depois de centralizada e escalada). Recalcule com
## tools/measure_ground.gd se mudar a escala ou o modelo.
@export var island_offset: Vector3 = Vector3(0.0, 0.40, -4.47)  # chao vai de -0.46 (calcanhar) a -0.36 (ponta): media
## Pontos (x, z) embaixo dos pes/calcanhares do personagem, em metros do mundo.
@export var foot_points: PackedVector2Array = PackedVector2Array([
	Vector2(-0.83, -0.2), Vector2(0.83, -0.2), Vector2(-0.83, 1.1), Vector2(0.83, 1.1), Vector2(0.0, 0.4)])
@export var grass_count: int = 60
@export var grass_radius: Vector2 = Vector2(5.5, 1.6)

## Foto do ceu (sky-background). Nao e panoramica: vai num plano preso a
## camera, no fundo, cobrindo a tela (cortando as laterais).
@export var sky_photo: Texture2D
@export var sky_distance: float = 600.0

@onready var island_root: Node3D = $Island
@onready var grass: MultiMeshInstance3D = $Grass

func _ready() -> void:
	_setup_sky()
	_setup_island()
	_tint_rocks($RockLeft, "A_Set")
	_tint_rocks($RockRight, "A_Set_004")
	_setup_grass()

func _material(color: Color, roughness: float = 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	return m

func _setup_sky() -> void:
	if sky_photo == null:
		return
	var cam: Camera3D = $Camera
	var view: Vector2 = Vector2(
		ProjectSettings.get_setting("display/window/size/viewport_width"),
		ProjectSettings.get_setting("display/window/size/viewport_height"))
	var screen_aspect: float = view.x / view.y
	var height: float = 2.0 * sky_distance * tan(deg_to_rad(cam.fov) * 0.5) * 1.02  # 2% de folga nas bordas
	var quad := QuadMesh.new()
	quad.size = Vector2(height * screen_aspect, height)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_texture = sky_photo
	mat.disable_receive_shadows = true
	mat.disable_fog = true
	# "cover": usa so a faixa central da foto com a proporcao da tela
	var crop: float = screen_aspect / (float(sky_photo.get_width()) / sky_photo.get_height())
	mat.uv1_scale = Vector3(crop, 1.0, 1.0)
	mat.uv1_offset = Vector3((1.0 - crop) * 0.5, 0.0, 0.0)
	var sky := MeshInstance3D.new()
	sky.name = "SkyPhoto"
	sky.mesh = quad
	sky.material_override = mat
	sky.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sky.position = Vector3(0.0, 0.0, -sky_distance)
	cam.add_child(sky)

func _setup_island() -> void:
	var inst: Node3D = island_root.get_child(0) as Node3D
	var land: MeshInstance3D = null
	for c in inst.get_children():
		if c is Camera3D or c is Light3D or String(c.name).begins_with("mesh_Tree"):
			c.queue_free()  # camera/sol/arvores que vieram junto no FBX
		elif String(c.name).begins_with("Landscape"):
			land = c as MeshInstance3D
	if land == null:
		return
	land.set_surface_override_material(0, _material(Color("#6b5a4a")))
	if land.mesh.get_surface_count() > 1:
		land.set_surface_override_material(1, _material(Color("#4f7a34")))
	# centraliza a ilha embaixo do personagem e alinha o topo em y=0
	var box: AABB = land.transform * land.mesh.get_aabb()
	var center := box.get_center()
	inst.position = Vector3(-center.x, -box.end.y, -center.z)
	island_root.scale = Vector3.ONE * island_scale
	# borda da frente logo a frente dos pes: a camera ve a "parede" da ilha
	# embaixo do personagem, como no prototipo
	# o topo e um disco irregular: island_offset poe o trecho plano embaixo
	# dos pes e o chao exatamente em y = 0 (medido com tools/measure_ground.gd,
	# a malha tem ~800 mil triangulos e medir a cada execucao seria lento)
	island_root.position = island_offset

## Maior altura do terreno (mundo) entre os pontos XZ dados, pelos triangulos
## da malha. NAN se nenhum ponto cair sobre a ilha. Usado pela ferramenta de
## medicao; nao roda durante a live.
func _ground_height(land: MeshInstance3D, points: PackedVector2Array) -> float:
	var xf: Transform3D = land.global_transform
	var best: float = NAN
	for s in land.mesh.get_surface_count():
		var arrays: Array = land.mesh.surface_get_arrays(s)
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		var count: int = idx.size() if not idx.is_empty() else verts.size()
		for t in range(0, count, 3):
			var a: Vector3 = xf * verts[idx[t] if not idx.is_empty() else t]
			var b: Vector3 = xf * verts[idx[t + 1] if not idx.is_empty() else t + 1]
			var c: Vector3 = xf * verts[idx[t + 2] if not idx.is_empty() else t + 2]
			for p in points:
				var h: float = _height_in_triangle(p, a, b, c)
				if not is_nan(h) and (is_nan(best) or h > best):
					best = h
	return best

func _height_in_triangle(p: Vector2, a: Vector3, b: Vector3, c: Vector3) -> float:
	var d: float = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
	if absf(d) < 1e-9:
		return NAN
	var w1: float = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.y - c.z)) / d
	var w2: float = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.y - c.z)) / d
	var w3: float = 1.0 - w1 - w2
	if w1 < 0.0 or w2 < 0.0 or w3 < 0.0:
		return NAN
	return w1 * a.y + w2 * b.y + w3 * c.y

func _tint_rocks(root: Node3D, keep: String) -> void:
	var inst: Node3D = root.get_child(0) as Node3D
	var mat := _material(Color("#57524c"))
	for c in inst.get_children():
		if c.name != keep:
			c.queue_free()
			continue
		var mi := c as MeshInstance3D
		mi.material_override = mat
		var box: AABB = mi.transform * mi.mesh.get_aabb()
		mi.position -= Vector3(box.get_center().x, box.position.y, box.get_center().z)

func _setup_grass() -> void:
	var src: Node = (load("res://assets/models/grass.glb") as PackedScene).instantiate()
	var patch: MeshInstance3D = src.get_child(0) as MeshInstance3D
	var mesh: Mesh = patch.mesh.duplicate()
	src.free()
	var green := _material(Color("#5fae3d"), 0.8)
	green.cull_mode = BaseMaterial3D.CULL_DISABLED
	for s in mesh.get_surface_count():
		mesh.surface_set_material(s, green)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = grass_count
	var rng := RandomNumberGenerator.new()
	rng.seed = 7  # mesma distribuicao em toda execucao
	for i in grass_count:
		var a: float = rng.randf() * TAU
		var r: float = sqrt(rng.randf())
		var p := Vector3(cos(a) * grass_radius.x * r, 0.0, -absf(sin(a)) * grass_radius.y * r - 0.3)
		var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(1.0, 0.75, 1.0) * rng.randf_range(0.45, 0.8))
		mm.set_instance_transform(i, Transform3D(basis, p))
	grass.multimesh = mm
