extends SceneTree
## Mede a altura do chao da ilha embaixo dos pes e diz qual island_offset usar.
## Uso: godot --headless --path game --script res://tools/measure_ground.gd
## (opcional: ISLAND_Z=-4.47 para testar outra posicao em z)

func _init() -> void:
	await process_frame
	var main: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	var stage: Node = main.find_child("Stage", true, false)
	var island: Node3D = stage.get_node("Island")
	var z: float = float(OS.get_environment("ISLAND_Z")) if OS.get_environment("ISLAND_Z") != "" else stage.island_offset.z
	island.position = Vector3(0.0, 0.0, z)
	await process_frame
	var land := main.find_child("Landscape*", true, false) as MeshInstance3D
	var each: Array[String] = []
	var highest: float = NAN
	for p in stage.foot_points:
		var h: float = stage._ground_height(land, PackedVector2Array([p]))
		each.append("%s=%.3f" % [p, h])
		if not is_nan(h) and (is_nan(highest) or h > highest):
			highest = h
	print("alturas do chao por ponto: ", ", ".join(each))
	if is_nan(highest):
		print("nenhum ponto sobre a ilha: ajuste ISLAND_Z")
	else:
		print("use island_offset = Vector3(0, %.3f, %.3f)" % [-highest, z])
	quit()
