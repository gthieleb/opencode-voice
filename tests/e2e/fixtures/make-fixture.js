#!/usr/bin/env node
// Deterministic test fixture: mono 16 kHz 16-bit PCM WAV, ~2 s alternating
// tones (440 Hz + 620 Hz) with short silence gaps. No model needed.
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const sampleRate = 16000
const seconds = 2
const n = sampleRate * seconds
const data = Buffer.alloc(n * 2)
for (let i = 0; i < n; i++) {
  const t = i / sampleRate
  const gap = t % 0.5 < 0.05 ? 0 : 1 // 50 ms silence every 500 ms
  const freq = Math.floor(t / 0.5) % 2 === 0 ? 440 : 620
  const s = gap * Math.sin(2 * Math.PI * freq * t) * 0.6
  data.writeInt16LE(Math.round(s * 32767 * 0.9), i * 2)
}

const header = Buffer.alloc(44)
header.write("RIFF", 0)
header.writeUInt32LE(36 + data.length, 4)
header.write("WAVE", 8)
header.write("fmt ", 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(1, 22) // mono
header.writeUInt32LE(sampleRate, 24)
header.writeUInt32LE(sampleRate * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write("data", 36)
header.writeUInt32LE(data.length, 40)

await writeFile(path.join(here, "german-tone-fixture.wav"), Buffer.concat([header, data]))
console.log("fixture written", data.length + 44, "bytes, mono 16kHz 16bit")
