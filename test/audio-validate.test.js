// unit tests for the server-side wav audio gate
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWav, validateAudioBuffer } from "../lib/audio-validate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "..", "tests", "e2e", "fixtures", "german-tone-fixture.wav");

// build a minimal 44-byte-header wav buffer
function buildWav({ sampleRate = 16000, channels = 1, bits = 16, data = Buffer.alloc(0) } = {}) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // pcm
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  header.writeUInt16LE(channels * (bits / 8), 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// audible pcm: 100 ms of 440 hz full-ish amplitude sine
function tonePcm(sampleRate = 16000, ms = 100) {
  const n = Math.floor((sampleRate * ms) / 1000);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.8;
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return data;
}

test("valid fixture parses with 16k mono 16-bit", async () => {
  const buf = await readFile(fixturePath);
  const parsed = parseWav(buf);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pcm.sampleRate, 16000);
  assert.equal(parsed.pcm.channels, 1);
  assert.equal(parsed.pcm.bitsPerSample, 16);
  assert.ok(parsed.pcm.dataLength > 0);
  const v = validateAudioBuffer(buf);
  assert.equal(v.ok, true);
  assert.equal(v.parsed.pcm.sampleRate, 16000);
});

test("truncated 30-byte header fails with a stable reason, not a crash", () => {
  const buf = buildWav({ data: tonePcm(16000, 300) }).subarray(0, 30);
  const r = parseWav(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "TOO_SHORT");
  assert.ok(r.detail.length > 0);
});

test("wrong riff magic -> NOT_RIFF", () => {
  const buf = buildWav({ data: tonePcm(16000, 300) });
  buf.write("ROFF", 0);
  const r = parseWav(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NOT_RIFF");
});

test("wrong wave magic -> NOT_WAVE", () => {
  const buf = buildWav({ data: tonePcm(16000, 300) });
  buf.write("WVVE", 8);
  const r = parseWav(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NOT_WAVE");
});

test("non-pcm audio format -> NOT_PCM", () => {
  const buf = buildWav({ data: tonePcm(16000, 300) });
  buf.writeUInt16LE(6, 20); // alaw
  const r = parseWav(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NOT_PCM");
});

test("8-bit -> NOT_S16", () => {
  const buf = buildWav({ data: Buffer.alloc(100).fill(0x40), bits: 8 });
  const r = parseWav(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NOT_S16");
});

test("unallowed sample rate 48000 -> UNSUPPORTED_SAMPLE_RATE", async () => {
  const buf = buildWav({ sampleRate: 48000, data: tonePcm(48000) });
  const r = validateAudioBuffer(buf, { allowedSampleRates: [16000] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "UNSUPPORTED_SAMPLE_RATE");
});

test("stereo build of fixture tones -> NOT_MONO", () => {
  const mono = tonePcm(16000, 300);
  const frames = mono.length / 2;
  const stereo = Buffer.alloc(frames * 4);
  mono.copy(stereo, 0);
  mono.copy(stereo, frames * 2);
  const buf = buildWav({ channels: 2, data: stereo });
  const r = validateAudioBuffer(buf, { allowedChannels: [1] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NOT_MONO");
});

test("zero-length data chunk -> EMPTY_DATA", () => {
  const buf = buildWav({});
  const r = parseWav(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "EMPTY_DATA");
});

test("all-zero pcm window -> SILENT", () => {
  const buf = buildWav({ data: Buffer.alloc(9600) });
  const r = validateAudioBuffer(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "SILENT");
});

test("oversize: maxBytes 64 with valid fixture -> TOO_LARGE", async () => {
  const buf = await readFile(fixturePath);
  const r = validateAudioBuffer(buf, { maxBytes: 64 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "TOO_LARGE");
});

test("header claiming 1 hour -> TOO_LONG", () => {
  const buf = buildWav({ data: tonePcm(16000, 300) });
  // lie: new riff size consistent with 1 h of frames without resizing data
  const framesPerHour = 16000 * 3600;
  buf.writeUInt32LE(36 + framesPerHour * 2, 4);
  buf.writeUInt32LE(framesPerHour * 2, 40);
  const r = validateAudioBuffer(buf, {
    allowedSampleRates: [16000],
    maxBytes: 20 * 1024 * 1024,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "TOO_LONG");
});

test("header claiming 100 ms -> TOO_SHORT", () => {
  const buf = buildWav({ data: tonePcm(16000, 100) });
  const r = parseWav(buf);
  assert.equal(r.ok, true);
  assert.ok(r.pcm.durationMs >= 99 && r.pcm.durationMs <= 101);
  const v = validateAudioBuffer(buf, { minDurationMs: 300, maxBytes: 20 * 1024 * 1024 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "TOO_SHORT");
});

test("inconsistent fmt block alignment -> LENGTH_MISMATCH", () => {
  // data consistent with 2-byte mono frames, but fmt claims block alignment 4
  const buf = buildWav({ data: tonePcm(16000, 300) });
  buf.writeUInt16LE(4, 32);
  const r = validateAudioBuffer(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "LENGTH_MISMATCH");
});

test("odd declared data size within 1-byte padding tolerance -> ok", () => {
  // 3201-byte data chunk (odd), pad byte at even alignment: accepted
  const buf = buildWav({ data: Buffer.concat([tonePcm(16000, 300), Buffer.alloc(1)]) });
  const r = parseWav(buf);
  assert.equal(r.ok, true);
  assert.ok(r.pcm.durationMs >= 299 && r.pcm.durationMs <= 320);
});

test("malformed chunk size bails with a reason, never crashes", () => {
  const buf = Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from("WAVE", "latin1"),
  ]);
  const r = parseWav(buf);
  assert.equal(r.ok, false);
  assert.ok(typeof r.reason === "string" && r.reason.length > 0);
});

test("validateAudioBuffer never throws on empty / tiny buffers", () => {
  for (const buf of [Buffer.alloc(0), Buffer.alloc(10)]) {
    const r = validateAudioBuffer(buf);
    assert.equal(r.ok, false);
    assert.ok(typeof r.reason === "string");
  }
});
