import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import type { TimedInterval } from "./timing";
const exec = promisify(execFile);

async function mediaCommand(command: string, args: string[]) {
  try {
    return await exec(command, args, {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      "Media processing failed. Check that ffmpeg and ffprobe are installed and the uploaded video is valid.",
    );
  }
}
const inputFlags = ["-protocol_whitelist", "file,pipe", "-threads", "2"];
export async function inspectMedia(path: string) {
  const { stdout } = await mediaCommand("ffprobe", [
    "-v",
    "error",
    ...inputFlags,
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    path,
  ]);
  const data = JSON.parse(stdout);
  const duration = Number(data.format?.duration);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 1200 ||
    !data.streams?.some((s: { codec_type: string }) => s.codec_type === "video")
  )
    throw new Error("Upload a valid video no longer than 20 minutes.");
  return {
    duration,
    hasAudio: data.streams.some(
      (s: { codec_type: string }) => s.codec_type === "audio",
    ),
  };
}
export async function extractPcm(source: string, destination: string) {
  await mediaCommand("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-y",
    ...inputFlags,
    "-i",
    source,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-t",
    "1200",
    "-f",
    "s16le",
    destination,
  ]);
  return readFile(destination);
}
export async function videoClip(
  source: string,
  destination: string,
  start: number,
  duration: number,
) {
  await mediaCommand("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-y",
    ...inputFlags,
    "-ss",
    String(start),
    "-i",
    source,
    "-t",
    String(duration),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale=640:-2",
    "-r",
    "8",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-ac",
    "1",
    "-movflags",
    "+faststart",
    destination,
  ]);
  return readFile(destination);
}
export async function evidenceFrame(
  source: string,
  destination: string,
  timestamp: number,
) {
  await mediaCommand("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-y",
    ...inputFlags,
    "-ss",
    String(timestamp),
    "-i",
    source,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-2",
    destination,
  ]);
  return readFile(destination);
}

// Conservatively protect audible material as well as recognized words. ASR can
// miss quiet dialogue, so a missing transcript alone must never create a gap.
export function audibleIntervals(pcm: Buffer): TimedInterval[] {
  const intervals: TimedInterval[] = [];
  const block = 1600; // 50 ms of mono 16 kHz PCM
  for (let offset = 0; offset < pcm.length; offset += block) {
    const end = Math.min(offset + block, pcm.length);
    let peak = 0;
    for (let index = offset; index + 1 < end; index += 2)
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(index)));
    if (peak > 184) intervals.push({ start: offset / 32000, end: end / 32000 }); // approximately -45 dBFS
  }
  return intervals;
}
