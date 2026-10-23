"""Exporta o personagem (.blend com rig, modificadores e shape keys) para .glb.

Uso:  blender -b "personagem principal.blend" --python export_character.py -- <saida.glb>

Problema que este script resolve: o exportador glTF descarta shape keys quando
"aplica modificadores", e quase todas as malhas do personagem usam Subsurf,
Mirror, Solidify, Lattice ou Mesh Deform. Aqui cada malha e "assada" em pose de
descanso (modificadores aplicados, exceto Armature) e cada shape key e
recalculada ja com os modificadores, entao a boca continua animavel no Godot.
"""
import bpy
import os
import sys

out = sys.argv[sys.argv.index("--") + 1]
MAIN_ARM = "Reference.001"
HEAD_BONE = "Head"
KEEP = {
    "botten", "botten.001", "Circle", "Cube", "inside", "Mouth", "MouthL.001",
    "Plane", "Plane.001", "Plane.004", "Plane.006", "Sphere", "Sphere.001",
    "Sphere.002", "Teeth", "Sonic.000", "Sonic.001", "Sonic.002", "Sonic.003",
    "Sonic.004",
}

# --- texturas: o usuario renomeou "sonic" -> "personagem principal" em Image/
blend_dir = os.path.dirname(bpy.data.filepath)
img_dir = os.path.join(blend_dir, "Image")
available = {f.lower(): f for f in os.listdir(img_dir)} if os.path.isdir(img_dir) else {}
for img in bpy.data.images:
    if img.source != 'FILE' or not img.filepath:
        continue
    base = os.path.basename(img.filepath.replace("\\", "/"))
    for cand in (base, base.replace("sonic", "personagem principal")):
        hit = available.get(cand.lower())
        if hit:
            img.filepath = os.path.join(img_dir, hit)
            img.reload()
            print("textura ok:", base, "->", hit)
            break
    else:
        print("textura AUSENTE:", base)

# --- materiais: o modelo usa "Diffuse BSDF" (ignorado pelo glTF, sai branco).
# Converte para Principled mantendo cor e textura ligada.
for mat in bpy.data.materials:
    if not mat.use_nodes:
        mat.use_nodes = True
        nt = mat.node_tree
        p = nt.nodes.get("Principled BSDF") or nt.nodes.new("ShaderNodeBsdfPrincipled")
        p.inputs["Base Color"].default_value = mat.diffuse_color
        out_node = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(p.outputs["BSDF"], out_node.inputs["Surface"])
        continue
    nt = mat.node_tree
    if any(n.type == 'BSDF_PRINCIPLED' and n.outputs[0].is_linked for n in nt.nodes):
        continue
    diffuse = next((n for n in nt.nodes if n.type == 'BSDF_DIFFUSE'), None)
    out_node = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if diffuse is None or out_node is None:
        continue
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Roughness"].default_value = 0.55
    color_in = diffuse.inputs["Color"]
    if color_in.is_linked:
        nt.links.new(color_in.links[0].from_socket, p.inputs["Base Color"])
    else:
        p.inputs["Base Color"].default_value = color_in.default_value
    nt.links.new(p.outputs["BSDF"], out_node.inputs["Surface"])
    print("material convertido:", mat.name)

# --- pose: o corpo vai em descanso (T-pose), mas o ROSTO mantem a pose do
# arquivo. Em descanso as palpebras (esferas presas a BrowA_C.*) cobrem os
# olhos; a pose original e que os deixa abertos.
FACE_BONES = {"BrowA_C.001", "BrowA_C.002", "Main Eye", "Main Eye.001", "mad", "top l", "top r"}
LID_BONES = ["BrowA_C.001", "BrowA_C.002"]

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name in KEEP]
main_arm = bpy.data.objects[MAIN_ARM]
for a in bpy.data.objects:
    if a.type == 'ARMATURE' and a != main_arm:
        a.data.pose_position = 'REST'
main_arm.data.pose_position = 'POSE'
for b in main_arm.pose.bones:
    for c in list(b.constraints):
        b.constraints.remove(c)
    if b.name not in FACE_BONES:
        b.location = (0, 0, 0)
        b.rotation_quaternion = (1, 0, 0, 0)
        b.rotation_euler = (0, 0, 0)
        b.scale = (1, 1, 1)
# guarda o descanso antigo das palpebras (= olhos fechados) para a piscada
closed_lids = {n: main_arm.data.bones[n].matrix_local.copy() for n in LID_BONES}

# Alguns vertices das luvas tem peso nos alvos de IK (Hand_X.001), que no
# Godot ficam parados na posicao da T-pose e esticam a luva em "espinhos".
# Passa esses pesos para os ossos que realmente se movem.
MERGE_GROUPS = {
    "Hand_L.001": "Hand_L", "Hand_R.001": "Hand_R",
    "back l": "Shoulder_L", "back r": "Shoulder_R",
}
for obj in meshes:
    for src_name, dst_name in MERGE_GROUPS.items():
        src = obj.vertex_groups.get(src_name)
        if src is None:
            continue
        dst = obj.vertex_groups.get(dst_name) or obj.vertex_groups.new(name=dst_name)
        moved = 0
        for v in obj.data.vertices:
            for g in v.groups:
                if g.group == src.index and g.weight > 0.0:
                    dst.add([v.index], g.weight, 'ADD')
                    moved += 1
        obj.vertex_groups.remove(src)
        print(f"pesos {src_name} -> {dst_name} em {obj.name}: {moved}")


def strip_drivers(obj):
    sk = obj.data.shape_keys
    if sk and sk.animation_data:
        for d in list(sk.animation_data.drivers):
            sk.animation_data.drivers.remove(d)


def evaluated_coords(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    m = ev.to_mesh()
    co = [v.co.copy() for v in m.vertices]
    ev.to_mesh_clear()
    return co


for obj in meshes:
    strip_drivers(obj)
    # o Armature continua ligado: so os ossos do rosto estao posados, entao
    # o que entra na malha e apenas a expressao do rosto
    arm_mods = [m for m in obj.modifiers if m.type == 'ARMATURE']
    keys = obj.data.shape_keys.key_blocks if obj.data.shape_keys else []
    baked_keys = {}
    if keys:
        for k in keys:
            k.value = 0.0
        for k in keys[1:]:
            k.value = 1.0
            obj.data.update()
            bpy.context.view_layer.update()  # sem isto o depsgraph nao reavalia e a key sai igual a base
            baked_keys[k.name] = evaluated_coords(obj)
            k.value = 0.0
        obj.data.update()
        bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)
    if baked_keys:
        n = len(new_mesh.vertices)
        obj.shape_key_add(name="Basis", from_mix=False)
        for name, co in baked_keys.items():
            if len(co) != n:
                print("shape key ignorada (topologia mudou):", obj.name, name)
                continue
            kb = obj.shape_key_add(name=name, from_mix=False)
            delta = 0.0
            for i, c in enumerate(co):
                delta = max(delta, (c - new_mesh.vertices[i].co).length)
                kb.data[i].co = c
            print(f"   shape {obj.name}/{name}: deslocamento max {delta:.4f}")
    if obj.vertex_groups and (arm_mods or obj.parent == main_arm):
        mod = obj.modifiers.new("Armature", 'ARMATURE')
        mod.object = main_arm
    print(f"assado: {obj.name} verts={len(new_mesh.vertices)} keys={list(baked_keys)}")

# --- boca/dentes: do rig secundario para o osso Head do esqueleto principal
for name in ("Mouth", "Teeth"):
    obj = bpy.data.objects[name]
    mw = obj.matrix_world.copy()
    obj.parent = main_arm
    obj.parent_type = 'BONE'
    obj.parent_bone = HEAD_BONE
    obj.matrix_world = mw
    obj.modifiers.clear()  # malha rigida presa ao osso, sem skin

# --- remove o resto (rig secundario, lattice, widgets, camera, props ocultos)
keep_objs = set(o.name for o in meshes) | {MAIN_ARM}
for o in list(bpy.data.objects):
    if o.name not in keep_objs:
        bpy.data.objects.remove(o, do_unlink=True)

# --- a pose do rosto vira a pose de descanso (as malhas ja foram assadas nela)
world = {o.name: o.matrix_world.copy() for o in bpy.data.objects if o.parent == main_arm}
for o in bpy.data.objects:
    if o.type == 'MESH':
        for m in o.modifiers:
            if m.type == 'ARMATURE':
                m.show_viewport = False  # evita deformar de novo durante o apply
bpy.context.view_layer.objects.active = main_arm
main_arm.select_set(True)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
for name, mw in world.items():
    bpy.data.objects[name].matrix_world = mw
for o in bpy.data.objects:
    for m in o.modifiers:
        m.show_viewport = True

# --- animacao "Blink": palpebras na posicao antiga (fechadas)
main_arm.animation_data_create()
action = bpy.data.actions.new("Blink")
main_arm.animation_data.action = action
for n in LID_BONES:
    pb = main_arm.pose.bones[n]
    pb.rotation_mode = 'QUATERNION'
    pb.matrix = closed_lids[n]
    bpy.context.view_layer.update()
    for frame in (1, 2):
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("scale", frame=frame)
for pb in main_arm.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.scale = (1, 1, 1)
main_arm.animation_data.action = None
action.use_fake_user = True

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_apply=False,
    export_skins=True,
    export_morph=True,
    export_morph_normal=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_def_bones=False,
    export_yup=True,
)
print("EXPORTADO:", out)
