export const NARRATION_SAMPLE_RATE = 24000;

export function parseWave(wave: Buffer) {
  if (
    wave.length < 44 ||
    wave.toString("ascii", 0, 4) !== "RIFF" ||
    wave.toString("ascii", 8, 12) !== "WAVE" ||
    wave.readUInt32LE(4) + 8 !== wave.length
  )
    throw new Error("Invalid narration WAV.");
  let format = false;
  let pcm: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wave.length;) {
    const kind = wave.toString("ascii", offset, offset + 4);
    const size = wave.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wave.length) throw new Error("Truncated narration WAV.");
    if (kind === "fmt ") {
      if (
        size < 16 ||
        wave.readUInt16LE(start) !== 1 ||
        wave.readUInt16LE(start + 2) !== 1 ||
        wave.readUInt32LE(start + 4) !== NARRATION_SAMPLE_RATE ||
        wave.readUInt32LE(start + 8) !== NARRATION_SAMPLE_RATE * 2 ||
        wave.readUInt16LE(start + 12) !== 2 ||
        wave.readUInt16LE(start + 14) !== 16
      )
        throw new Error("Narration must be mono 24 kHz 16-bit PCM.");
      format = true;
    }
    if (kind === "data") {
      if (pcm) throw new Error("Duplicate WAV data.");
      pcm = wave.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2)
    throw new Error("Missing or invalid narration samples.");
  return { pcm, duration: pcm.length / (NARRATION_SAMPLE_RATE * 2) };
}

export function encodeWave(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(NARRATION_SAMPLE_RATE, 24);
  header.writeUInt32LE(NARRATION_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function narrationStem(
  duration: number,
  cues: { start: number; audio: Buffer }[],
): Buffer {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1200)
    throw new Error("Invalid stem duration.");
  const pcm = Buffer.alloc(Math.ceil(duration * NARRATION_SAMPLE_RATE) * 2);
  let previousEnd = 0;
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(cue.start) || cue.start < 0)
      throw new Error("Invalid narration start.");
    const rendered = parseWave(cue.audio);
    const offset = Math.round(cue.start * NARRATION_SAMPLE_RATE) * 2;
    if (offset < previousEnd || offset + rendered.pcm.length > pcm.length)
      throw new Error("Narration overlaps another cue or exceeds the film.");
    rendered.pcm.copy(pcm, offset);
    previousEnd = offset + rendered.pcm.length;
  }
  return encodeWave(pcm);
}
