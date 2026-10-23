class_name LiveHud
extends CanvasLayer
## HUD do prototipo: caixa COMENTARIO no topo, "TOP 5 DA LIVE" a esquerda com
## avatar redondo + pontos, e um aviso de evento (dança/boas-vindas).

const AVATAR_DIR: String = "user://avatars"

var _comment_box: PanelContainer
var _comment_avatar: TextureRect
var _comment_name: Label
var _comment_text: Label
var _thinking_label: Label
var _thinking: bool = false
var _thinking_t: float = 0.0
var _rows: Array[Dictionary] = []
var _banner: Label
var _dot: ColorRect
var _http_busy: Dictionary = {}
var _circle_shader: Shader

func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(AVATAR_DIR)
	_circle_shader = Shader.new()
	_circle_shader.code = """
shader_type canvas_item;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	float d = distance(UV, vec2(0.5));
	c.a *= 1.0 - smoothstep(0.48, 0.5, d);
	COLOR = c;
}
"""
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# --- comentario (topo)
	_comment_box = PanelContainer.new()
	_comment_box.position = Vector2(22, 116)
	_comment_box.custom_minimum_size = Vector2(1036, 168)
	_comment_box.add_theme_stylebox_override("panel", _box(Color(1, 1, 1, 0.94), 18))
	root.add_child(_comment_box)
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 22)
	_comment_box.add_child(hb)
	_comment_avatar = _avatar_rect(Vector2(124, 124))
	_comment_avatar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_comment_avatar.visible = false
	hb.add_child(_comment_avatar)
	var vb := VBoxContainer.new()
	vb.alignment = BoxContainer.ALIGNMENT_CENTER
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hb.add_child(vb)
	_comment_name = _label(32, Color("#1d4ed8"))
	_comment_text = _label(40, Color("#111111"))
	_comment_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_comment_text.max_lines_visible = 2
	_comment_text.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_comment_text.text = "COMENTARIO"
	_comment_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_comment_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vb.add_child(_comment_name)
	vb.add_child(_comment_text)
	# aparece entre o comentario chegar e o Sonic comecar a falar (a voz demora alguns segundos)
	_thinking_label = _label(26, Color("#6b7280"))
	_thinking_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_thinking_label.visible = false
	vb.add_child(_thinking_label)

	# --- top 5 (esquerda)
	var title := _label(44, Color.WHITE)
	title.text = "TOP 5 DA LIVE"
	title.position = Vector2(24, 432)
	_shadow(title)
	root.add_child(title)
	for i in 5:
		var y: float = 520.0 + i * 96.0
		var avatar := _avatar_rect(Vector2(70, 70))
		avatar.position = Vector2(26, y)
		root.add_child(avatar)
		var name_l := _label(46, Color.WHITE)
		name_l.position = Vector2(112, y - 12)
		name_l.text = "User"
		_shadow(name_l)
		root.add_child(name_l)
		var pts := _label(28, Color.WHITE)
		pts.position = Vector2(112, y + 42)
		pts.text = "0 pontos"
		_shadow(pts)
		root.add_child(pts)
		avatar.visible = false  # linhas so aparecem quando alguem ganha pontos
		name_l.visible = false
		pts.visible = false
		_rows.append({"avatar": avatar, "name": name_l, "points": pts, "url": ""})

	# --- aviso de evento
	_banner = _label(48, Color("#fde047"))
	_banner.position = Vector2(0, 330)
	_banner.size = Vector2(1080, 70)
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_banner.modulate.a = 0.0
	_shadow(_banner)
	root.add_child(_banner)

	_dot = ColorRect.new()
	_dot.position = Vector2(1048, 16)
	_dot.size = Vector2(16, 16)
	_dot.color = Color("#f87171")
	root.add_child(_dot)

func _avatar_rect(size: Vector2) -> TextureRect:
	var avatar := TextureRect.new()
	avatar.custom_minimum_size = size
	avatar.size = size
	avatar.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	avatar.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	var mat := ShaderMaterial.new()
	mat.shader = _circle_shader
	avatar.material = mat
	avatar.texture = _placeholder()
	return avatar

func _label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l

func _shadow(l: Label) -> void:
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.75))
	l.add_theme_constant_override("outline_size", 10)

func _box(color: Color, radius: int) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(18)
	return sb

func _placeholder() -> Texture2D:
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	img.fill(Color("#d9d9d9"))
	return ImageTexture.create_from_image(img)

# ------------------------------------------------------------------ API

func set_connected(on: bool) -> void:
	_dot.color = Color("#4ade80") if on else Color("#f87171")

func show_comment(user: String, text: String, avatar_url: String = "") -> void:
	_comment_name.text = user
	_comment_text.text = text
	_comment_avatar.visible = true
	_comment_avatar.texture = _placeholder()
	if avatar_url != "":
		_load_avatar(avatar_url, _comment_avatar)

## Liga/desliga o "Sonic esta pensando..." (animado) embaixo do comentario.
func set_thinking(on: bool) -> void:
	_thinking = on
	_thinking_t = 0.0
	_thinking_label.visible = on
	if on:
		_thinking_label.text = "Sonic está pensando"

func _process(delta: float) -> void:
	if not _thinking:
		return
	_thinking_t += delta
	_thinking_label.text = "Sonic está pensando" + ".".repeat(1 + int(_thinking_t * 2.5) % 3)

func show_banner(text: String, seconds: float = 3.0) -> void:
	_banner.text = text
	var tw := create_tween()
	tw.tween_property(_banner, "modulate:a", 1.0, 0.2)
	tw.tween_interval(seconds)
	tw.tween_property(_banner, "modulate:a", 0.0, 0.4)

func set_top(entries: Array) -> void:
	for i in _rows.size():
		var row: Dictionary = _rows[i]
		var name_l: Label = row["name"]
		var pts: Label = row["points"]
		var show: bool = i < entries.size() and entries[i] is Dictionary
		# so aparece quem ja tem pontos: as linhas vazias ficam escondidas
		(row["avatar"] as TextureRect).visible = show
		name_l.visible = show
		pts.visible = show
		if show:
			var e: Dictionary = entries[i]
			name_l.text = str(e.get("displayName", "User")).left(14)
			pts.text = "%d pontos" % int(e.get("points", 0))
			var url: String = str(e.get("avatarUrl", ""))
			if url != row["url"]:
				row["url"] = url
				(row["avatar"] as TextureRect).texture = _placeholder()
				if url != "":
					_load_avatar(url, row["avatar"])
		else:
			row["url"] = ""

# avatar do TikTok com cache em disco
func _load_avatar(url: String, target: TextureRect) -> void:
	# o download anterior pode terminar depois: so aplica se ainda for o atual
	target.set_meta("avatar_url", url)
	var file: String = "%s/%s.img" % [AVATAR_DIR, url.md5_text()]
	if FileAccess.file_exists(file):
		var tex := _texture_from_bytes(FileAccess.get_file_as_bytes(file))
		if tex:
			target.texture = tex
			return
	# mesma URL ja baixando (ex.: avatar no comentario e no TOP 5): so espera
	if _http_busy.has(url):
		(_http_busy[url] as Array).append(target)
		return
	_http_busy[url] = [target]
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
		var waiting: Array = _http_busy.get(url, [])
		_http_busy.erase(url)
		http.queue_free()
		if result != HTTPRequest.RESULT_SUCCESS or code != 200:
			return
		var tex := _texture_from_bytes(body)
		if tex == null:
			return
		var f := FileAccess.open(file, FileAccess.WRITE)
		if f:
			f.store_buffer(body)
		for t: TextureRect in waiting:
			if is_instance_valid(t) and t.get_meta("avatar_url", "") == url:
				t.texture = tex
	)
	http.request(url)

## Detecta o formato pelos primeiros bytes (tentar um por um faz o Godot
## imprimir erro a cada tentativa que falha).
func _texture_from_bytes(bytes: PackedByteArray) -> Texture2D:
	if bytes.size() < 12:
		return null
	var img := Image.new()
	var err: int = ERR_FILE_UNRECOGNIZED
	if bytes[0] == 0x89 and bytes[1] == 0x50:  # PNG
		err = img.load_png_from_buffer(bytes)
	elif bytes[0] == 0xFF and bytes[1] == 0xD8:  # JPEG
		err = img.load_jpg_from_buffer(bytes)
	elif bytes.slice(0, 4).get_string_from_ascii() == "RIFF" and bytes.slice(8, 12).get_string_from_ascii() == "WEBP":
		err = img.load_webp_from_buffer(bytes)
	if err != OK:
		return null
	return ImageTexture.create_from_image(img)
