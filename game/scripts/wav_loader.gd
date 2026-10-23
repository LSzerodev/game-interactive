class_name WavLoader
extends RefCounted
## Carrega um .wav do disco (gerado pelo servidor) em um AudioStreamWAV.
## Funciona em qualquer 4.x e sem importar o arquivo no editor (o wav nasce em
## tempo de execucao). Suporta PCM 8/16 bits, mono ou estereo.

static func load_wav(path: String) -> AudioStreamWAV:
	var bytes: PackedByteArray = FileAccess.get_file_as_bytes(path)
	if bytes.size() < 44 or bytes.slice(0, 4).get_string_from_ascii() != "RIFF":
		push_warning("WavLoader: arquivo invalido: %s" % path)
		return null

	var pos: int = 12
	var channels: int = 1
	var rate: int = 22050
	var bits: int = 16
	var data: PackedByteArray = PackedByteArray()
	while pos + 8 <= bytes.size():
		var id: String = bytes.slice(pos, pos + 4).get_string_from_ascii()
		var size: int = bytes.decode_u32(pos + 4)
		var start: int = pos + 8
		if start + size > bytes.size():
			size = bytes.size() - start
		if id == "fmt ":
			channels = bytes.decode_u16(start + 2)
			rate = bytes.decode_u32(start + 4)
			bits = bytes.decode_u16(start + 14)
		elif id == "data":
			data = bytes.slice(start, start + size)
			break
		pos = start + size + (size % 2)

	if data.is_empty():
		push_warning("WavLoader: wav sem dados: %s" % path)
		return null

	var stream := AudioStreamWAV.new()
	stream.mix_rate = rate
	stream.stereo = channels >= 2
	stream.format = AudioStreamWAV.FORMAT_8_BITS if bits == 8 else AudioStreamWAV.FORMAT_16_BITS
	if bits == 8:
		# WAV de 8 bits e unsigned; o Godot espera signed.
		for i in data.size():
			data[i] = (data[i] + 128) & 0xFF
	stream.data = data
	return stream
