// Tests for the web voice transport sidecar (lib/web-transport.js): auth,
// origin policy, the recording state machine, limits, protocol errors,
// concurrency, result timeouts and temp-file cleanup. Everything runs against
// ephemeral ports on 127.0.0.1; transcribe/normalize are injected fakes, while
// audio validation runs on the real lib/audio-validate.js through the transport.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

import { createVoiceTransport } from "../lib/web-transport.js";

const TOKEN = "test-one-time-token";
const ORIGIN = "http://localhost:4096";
const KV = { get: () => null, set() {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 16 kHz mono PCM16 wav with a 440 hz tone at 80 % amplitude
function makeWav({ sampleRate = 16000, ms = 300 } = {}) {
  const n = Math.floor((sampleRate * ms) / 1000);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.8;
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// 44-byte header-only wav declaring a zero-byte data chunk
function makeHeaderOnlyWav() {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(0, 40);
  return header;
}

// thin promise wrapper over a ws client; buffers unmatched messages
class Conn {
  constructor(url, { token, origin, headers = {} } = {}) {
    const query = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
    const hdrs = { ...headers };
    if (origin !== undefined) hdrs.Origin = origin;
    this.ws = new WebSocket(`${url}${query}`, { headers: hdrs });
    this.messages = [];
    this.waiters = [];
    this.closeInfo = null;
    this.ready = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (err) => reject(err));
    });
    // rejected upgrades (4001/4002) must not surface as unhandled rejections
    this.ready.catch(() => {});
    this.ws.on("message", (data, isBinary) => {
      const msg = isBinary ? data : JSON.parse(data.toString("utf8"));
      this.push(msg);
    });
    this.ws.on("close", (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
    });
    this.ws.on("error", () => {});
  }

  push(msg) {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.pred(msg)) {
        this.waiters.splice(i, 1);
        w.resolve(msg);
        return;
      }
    }
    this.messages.push(msg);
  }

  next(pred = () => true, timeoutMs = 4000) {
    const idx = this.messages.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.messages.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(
          new Error(
            `timeout: no matching message (buffered: ${JSON.stringify(this.messages.map((m) => m && m.type))})`,
          ),
        );
      }, timeoutMs);
      const w = {
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      this.waiters.push(w);
    });
  }

  nextClose(timeoutMs = 4000) {
    if (this.closeInfo) return Promise.resolve(this.closeInfo);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `timeout: connection not closed (closeInfo=${JSON.stringify(this.closeInfo)})`,
            ),
          ),
        timeoutMs,
      );
      this.ws.once("close", (code, reason) => {
        clearTimeout(timer);
        this.closeInfo = { code, reason: reason.toString() };
        resolve(this.closeInfo);
      });
    });
  }

  async send(obj) {
    await this.ready;
    this.ws.send(JSON.stringify(obj));
  }

  async sendBinary(buf) {
    await this.ready;
    this.ws.send(buf);
  }

  async sendRaw(str) {
    await this.ready;
    this.ws.send(str);
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const envs = [];
after(async () => {
  for (const env of envs) {
    await env.t.close().catch(() => {});
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});

async function makeEnv({ limits, opts, client = null, callbacks, allowedOrigins } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-transport-"));
  const t = createVoiceTransport(
    {
      port: 0,
      token: TOKEN,
      allowedOrigins: allowedOrigins ?? [ORIGIN],
      limits,
      kv: KV,
      client,
      logger: null,
      opts: { tmpDir, ...opts },
    },
    callbacks,
  );
  if (!t.server.listening) await new Promise((r) => t.server.once("listening", r));
  const env = { t, tmpDir, url: t.url() };
  envs.push(env);
  return env;
}

// wait until no voice-*.wav temp files remain (best-effort unlink)
async function assertNoVoiceFiles(dir) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const left = fs.readdirSync(dir).filter((f) => f.startsWith("voice-"));
    if (left.length === 0) return;
    if (Date.now() > deadline) throw new Error(`temp files left behind: ${left.join(", ")}`);
    await sleep(20);
  }
}

test("happy path: start -> ready -> binary -> finish -> started -> final with timings and session id", async () => {
  const transcribeCalls = [];
  const normalizeCalls = [];
  const env = await makeEnv({
    opts: {
      systemPrompt: "SYS-NORMALIZE",
      transcribe: async (kvArg, o) => {
        transcribeCalls.push({ ...o, sawFile: fs.existsSync(o.wavPath) });
        return { text: "Hallo json!" };
      },
    },
    client: async (payload) => {
      normalizeCalls.push(payload);
      return { text: "normalized: Hallo json!" };
    },
    callbacks: { getSessionId: () => "sess-abc" },
  });

  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.start", id: "clip-a", codec: "audio/wav", sampleRate: 16000 });
  const ready = await c.next((m) => m.type === "recording.ready");
  assert.equal(ready.id, "clip-a");
  await c.sendBinary(makeWav());
  await c.send({ type: "recording.finish", id: "clip-a" });

  const started = await c.next((m) => m.type === "transcription.started");
  assert.equal(started.recordingId, "clip-a");
  assert.equal(started.sessionId, "sess-abc");

  const final = await c.next((m) => m.type === "transcription.final");
  assert.equal(final.recordingId, "clip-a");
  assert.equal(final.sessionId, "sess-abc");
  assert.equal(final.rawText, "Hallo json!");
  assert.equal(final.normalizedText, "normalized: Hallo json!");
  assert.equal(final.detectedLanguage, "auto");
  assert.ok(Number.isFinite(final.timings.uploadMs) && final.timings.uploadMs >= 0);
  assert.ok(Number.isFinite(final.timings.transcribeMs) && final.timings.transcribeMs >= 0);
  assert.ok(Number.isFinite(final.timings.normalizeMs) && final.timings.normalizeMs >= 0);

  // real shared transcribe entry point, configured by the transport
  assert.equal(transcribeCalls.length, 1);
  assert.ok(transcribeCalls[0].wavPath.endsWith("clip-a.wav"));
  assert.ok(transcribeCalls[0].wavPath.startsWith(env.tmpDir));
  assert.ok(transcribeCalls[0].sawFile, "temp wav must exist while transcribing");
  assert.equal(transcribeCalls[0].timeoutMs, 60000);
  assert.equal(transcribeCalls[0].language, undefined);

  // LLM normalization receives the raw transcript and the configured prompt
  assert.equal(normalizeCalls.length, 1);
  assert.ok(normalizeCalls[0].prompt.includes("Hallo json!"));
  assert.ok(normalizeCalls[0].system.startsWith("SYS-NORMALIZE"));

  assertNoVoiceFiles(env.tmpDir);
  c.close();
  await env.t.close();
});

test("auth: wrong token closes with 4001 AUTH_TOKEN_INVALID", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, { token: "wrong-token", origin: ORIGIN });
  const info = await c.nextClose();
  assert.equal(info.code, 4001);
  assert.match(info.reason, /AUTH_TOKEN_INVALID/);
  c.close();
  await env.t.close();
});

test("auth: missing token closes with 4001 AUTH_TOKEN_MISSING", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, { origin: ORIGIN });
  const info = await c.nextClose();
  assert.equal(info.code, 4001);
  assert.match(info.reason, /AUTH_TOKEN_MISSING/);
  c.close();
  await env.t.close();
});

test("auth: wrong origin closes with 4002 ORIGIN_DENIED", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, { token: TOKEN, origin: "http://evil.example" });
  const info = await c.nextClose();
  assert.equal(info.code, 4002);
  assert.match(info.reason, /ORIGIN_DENIED/);
  c.close();
  await env.t.close();
});

test("auth: bearer header token + allowed origin connects", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, {
    origin: ORIGIN,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  await c.send({ type: "recording.start", id: "h1", codec: "audio/wav", sampleRate: 16000 });
  const ready = await c.next((m) => m.type === "recording.ready");
  assert.equal(ready.id, "h1");
  await c.send({ type: "recording.cancel", id: "h1" });
  const canceled = await c.next((m) => m.type === "recording.canceled");
  assert.equal(canceled.id, "h1");
  c.close();
  await env.t.close();
});

test("auth: absent origin denied by default, accepted with opts.allowNoOrigin", async () => {
  const envA = await makeEnv({});
  const cA = new Conn(envA.url, { token: TOKEN }); // ws client sends no Origin header
  const infoA = await cA.nextClose();
  assert.equal(infoA.code, 4002);
  assert.match(infoA.reason, /ORIGIN_DENIED/);
  cA.close();
  await envA.t.close();

  const envB = await makeEnv({ opts: { allowNoOrigin: true } });
  const cB = new Conn(envB.url, { token: TOKEN });
  await cB.send({ type: "recording.start", id: "tool", codec: "audio/wav", sampleRate: 16000 });
  const ready = await cB.next((m) => m.type === "recording.ready");
  assert.equal(ready.id, "tool");
  await cB.send({ type: "recording.cancel", id: "tool" });
  cB.close();
  await envB.t.close();
});

test("start validation: missing id, bad codec, bad sample rate, duplicate id", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });

  await c.send({ type: "recording.start" });
  let e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "INVALID_START");
  assert.equal(e.recordingId, undefined);

  await c.send({ type: "recording.start", id: "v1", codec: "audio/opus", sampleRate: 16000 });
  e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "INVALID_START");
  assert.equal(e.recordingId, "v1");

  await c.send({ type: "recording.start", id: "v2", codec: "audio/wav", sampleRate: 44100 });
  e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "RATE_OR_LIMIT");
  assert.equal(e.recordingId, "v2");

  await c.send({ type: "recording.start", id: "v3", codec: "audio/wav", sampleRate: 16000 });
  const ready = await c.next((m) => m.type === "recording.ready");
  assert.equal(ready.id, "v3");

  await c.send({ type: "recording.start", id: "v3", codec: "audio/wav", sampleRate: 16000 });
  e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "INVALID_START");

  c.close();
  await env.t.close();
});

test("cancel: drops recording, acks canceled, later finish -> UNKNOWN_ID without transcription", async () => {
  let transcribeCalls = 0;
  const env = await makeEnv({
    opts: {
      transcribe: async () => {
        transcribeCalls++;
        return { text: "must-not-run" };
      },
    },
  });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.start", id: "c1", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(makeWav().subarray(0, 200));
  await c.send({ type: "recording.cancel", id: "c1" });

  const canceled = await c.next((m) => m.type === "recording.canceled");
  assert.equal(canceled.id, "c1");

  await c.send({ type: "recording.finish", id: "c1" });
  const e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "UNKNOWN_ID");
  assert.equal(e.recordingId, "c1");

  await sleep(100);
  assert.equal(transcribeCalls, 0, "transcription must not start for a canceled id");
  const types = c.messages.map((m) => m.type);
  assert.ok(!types.includes("transcription.started"), `unexpected messages: ${types}`);
  assert.ok(!types.includes("transcription.final"), `unexpected messages: ${types}`);

  // connection still usable after a cancel
  await c.send({ type: "recording.start", id: "c2", codec: "audio/wav", sampleRate: 16000 });
  const ready = await c.next((m) => m.type === "recording.ready");
  assert.equal(ready.id, "c2");
  await c.send({ type: "recording.cancel", id: "c2" });
  await c.next((m) => m.type === "recording.canceled");

  assertNoVoiceFiles(env.tmpDir);
  c.close();
  await env.t.close();
});

test("cancel: unknown id -> UNKNOWN_ID", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.cancel", id: "never-started" });
  const e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "UNKNOWN_ID");
  assert.equal(e.recordingId, "never-started");
  c.close();
  await env.t.close();
});

test("limits: preflight oversize via sizeBytes -> TOO_LARGE without ready", async () => {
  const env = await makeEnv({ limits: { maxClipBytes: 2048 } });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({
    type: "recording.start",
    id: "pf",
    codec: "audio/wav",
    sampleRate: 16000,
    sizeBytes: 5000,
  });
  const e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "TOO_LARGE");
  assert.equal(e.recordingId, "pf");
  assert.ok(typeof e.safeMessage === "string" && e.safeMessage.length > 0);

  // a conforming start on the same connection still works
  await c.send({ type: "recording.start", id: "pf-ok", codec: "audio/wav", sampleRate: 16000 });
  const ready = await c.next((m) => m.type === "recording.ready");
  assert.equal(ready.id, "pf-ok");
  c.close();
  await env.t.close();
});

test("limits: mid-stream oversize -> TOO_LARGE error and close 4003", async () => {
  const env = await makeEnv({ limits: { maxClipBytes: 1000 } });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.start", id: "big", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(Buffer.alloc(600));
  await c.sendBinary(Buffer.alloc(500)); // 600 + 500 > 1000

  const e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "TOO_LARGE");
  assert.equal(e.recordingId, "big");
  const info = await c.nextClose();
  assert.equal(info.code, 4003);
  c.close();
  await env.t.close();
});

test("limits: header-only 44-byte clip -> structural error with safe message, no crash", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.start", id: "h1", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(makeHeaderOnlyWav());
  await c.send({ type: "recording.finish", id: "h1" });

  const e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "EMPTY_DATA");
  assert.ok(typeof e.safeMessage === "string" && e.safeMessage.length > 0);
  assert.equal(e.recordingId, "h1");

  // connection not crashed: a following recording still works
  await c.send({ type: "recording.start", id: "h2", codec: "audio/wav", sampleRate: 16000 });
  const ready = await c.next((m) => m.type === "recording.ready");
  assert.equal(ready.id, "h2");
  await c.send({ type: "recording.cancel", id: "h2" });
  await c.next((m) => m.type === "recording.canceled");

  assertNoVoiceFiles(env.tmpDir);
  c.close();
  await env.t.close();
});

test("protocol: malformed json, unknown type, binary before start -> PROTOCOL", async () => {
  const env = await makeEnv({});
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });

  await c.sendRaw("{not-json");
  let e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "PROTOCOL");
  assert.ok(typeof e.safeMessage === "string" && e.safeMessage.length > 0);
  assert.equal(e.recordingId, undefined);

  await c.send({ type: "bogus.type", id: "z" });
  e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "PROTOCOL");
  assert.equal(e.recordingId, "z");

  await c.sendBinary(Buffer.alloc(8));
  e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "PROTOCOL");
  assert.equal(e.recordingId, undefined);

  c.close();
  await env.t.close();
});

test("concurrency: interleaved recordings finalize independently with per-session ids", async () => {
  let lastSeen = null;
  const recIdFromPath = (p) =>
    path
      .basename(p)
      .replace(/\.wav$/, "")
      .split("-")
      .pop();
  const env = await makeEnv({
    opts: {
      transcribe: async (kvArg, o) => {
        const recId = recIdFromPath(o.wavPath);
        if (recId === "slow") await sleep(120);
        lastSeen = recId;
        return { text: `text-for-${recId}` };
      },
    },
    client: async () => ({ text: "n" }),
    callbacks: { getSessionId: () => `sess-${lastSeen ?? "pre"}` },
  });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  const wav = makeWav();

  await c.send({ type: "recording.start", id: "slow", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(wav);
  await c.send({ type: "recording.finish", id: "slow" });
  const s1 = await c.next((m) => m.type === "transcription.started");
  assert.equal(s1.recordingId, "slow");

  // second recording starts while the first is still transcribing
  await c.send({ type: "recording.start", id: "fast", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(wav);
  await c.send({ type: "recording.finish", id: "fast" });

  const [fFast, fSlow] = await Promise.all([
    c.next((m) => m.type === "transcription.final" && m.recordingId === "fast"),
    c.next((m) => m.type === "transcription.final" && m.recordingId === "slow"),
  ]);
  assert.equal(fFast.rawText, "text-for-fast");
  assert.equal(fSlow.rawText, "text-for-slow");
  // getSessionId() is evaluated per final: each recording reports its session
  assert.equal(fFast.sessionId, "sess-fast");
  assert.equal(fSlow.sessionId, "sess-slow");
  assert.notEqual(fFast.sessionId, fSlow.sessionId);

  c.close();
  await env.t.close();
});

test("timeout: transcribe that never resolves -> RESULT_TIMEOUT after the injected limit", async () => {
  const env = await makeEnv({
    limits: { resultTimeoutMs: 150 },
    opts: { transcribe: async () => new Promise(() => {}) },
  });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.start", id: "t1", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(makeWav());
  await c.send({ type: "recording.finish", id: "t1" });

  const started = await c.next((m) => m.type === "transcription.started");
  assert.equal(started.recordingId, "t1");

  const e = await c.next((m) => m.type === "transcription.error");
  assert.equal(e.code, "RESULT_TIMEOUT");
  assert.equal(e.recordingId, "t1");
  assert.match(e.safeMessage, /150ms/);

  const types = c.messages.map((m) => m.type);
  assert.ok(!types.includes("transcription.final"), `unexpected messages: ${types}`);

  assertNoVoiceFiles(env.tmpDir);
  c.close();
  await env.t.close();
});

test("language: opts.language flows into detectedLanguage and the transcribe call", async () => {
  let got;
  const env = await makeEnv({
    opts: {
      language: "de",
      transcribe: async (kvArg, o) => {
        got = o;
        return { text: "hallo" };
      },
    },
    client: async () => ({ text: "Hallo." }),
  });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.start", id: "d1", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(makeWav());
  await c.send({ type: "recording.finish", id: "d1" });
  const final = await c.next((m) => m.type === "transcription.final");
  assert.equal(final.detectedLanguage, "de");
  assert.equal(final.rawText, "hallo");
  assert.equal(final.normalizedText, "Hallo.");
  assert.equal(got.language, "de");
  c.close();
  await env.t.close();
});

test("normalization failure: final still carries rawText with normalizedText null", async () => {
  const env = await makeEnv({
    opts: { transcribe: async () => ({ text: "raw only" }) },
    client: async () => ({ text: null, error: "LLM down" }),
  });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  await c.send({ type: "recording.start", id: "n1", codec: "audio/wav", sampleRate: 16000 });
  await c.next((m) => m.type === "recording.ready");
  await c.sendBinary(makeWav());
  await c.send({ type: "recording.finish", id: "n1" });
  const final = await c.next((m) => m.type === "transcription.final");
  assert.equal(final.rawText, "raw only");
  assert.equal(final.normalizedText, null);
  assert.ok(Number.isFinite(final.timings.normalizeMs));
  c.close();
  await env.t.close();
});

test("inactivity: silent connection is closed with 4004", async () => {
  const env = await makeEnv({ limits: { inactivityMs: 80 } });
  const c = new Conn(env.url, { token: TOKEN, origin: ORIGIN });
  const info = await c.nextClose(3000);
  assert.equal(info.code, 4004);
  assert.match(info.reason, /INACTIVITY/);
  c.close();
  await env.t.close();
});
