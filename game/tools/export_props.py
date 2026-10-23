"""Exporta objetos de cenario de um .blend para .glb (modificadores aplicados).

Uso:  blender -b arquivo.blend --python export_props.py -- <saida.glb> [Objeto1,Objeto2,...]
Sem lista de objetos, exporta todas as malhas visiveis com geometria.
"""
import bpy
import os
import sys

args = sys.argv[sys.argv.index("--") + 1:]
out = args[0]
only = set(args[1].split(",")) if len(args) > 1 else None

for o in list(bpy.data.objects):
    keep = o.type == 'MESH' and (o.name in only if only else len(o.data.vertices) > 0)
    if not keep:
        bpy.data.objects.remove(o, do_unlink=True)

def _missing(img):
    if img.packed_file or img.source not in {'FILE', 'TILED'}:
        return False
    path = bpy.path.abspath(img.filepath).replace("<UDIM>", "1001")
    return not os.path.exists(path)


# O exportador glTF falha em textura inexistente: remove esses nos e o
# material fica so com a cor base.
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    for node in list(mat.node_tree.nodes):
        if node.type == 'TEX_IMAGE' and node.image and _missing(node.image):
            print("textura sem arquivo removida:", mat.name, node.image.name)
            mat.node_tree.nodes.remove(node)

print("exportando:", [o.name for o in bpy.data.objects])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)
print("EXPORTADO:", out)
