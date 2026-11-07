// W5.2 (task 2.3): Node contract test for the browser media capture client
// that ships inside gui/gui-experimental.cjs.
//
// The host serves the bundle's RAW source and evaluates it as CJS with
// Function("require","module","exports", code) against a fixed require map
// (W5.1 report, "API notes for W5.3"). This test replicates that evaluation
// with the same stubs as tests/w51-gui-contract.test.js and exercises the
// NON-DEFAULT exports — the exact production code the window entry will use:
//
//   __audio    byte-exact WAV header; round-trip through the real
//              lib/audio-validate.js; resample length + spot values; downmix;
//              floatToPcm16 clamping.
//   __capture  exhaustive transition table (7 states x 9 events) plus
//              payload carry/drop semantics.
//   __ws       INTEGRATION (load-bearing): a real createVoiceTransport
//              (lib/web-transport.js, in-process, port 0) with STT and
//              normalization stubbed the way test/web-transport.test.js does,
//              driven by createVoiceWsClient with a WAV encoded by the
//              bundle's own __audio — proving the exact client sequence the
//              browser glue emits is accepted by the frozen server. Plus
//              TRANSPORT_CLOSED on a mid-flight server close, auth rejection,
//              server validation error pass-through, and cancel semantics.
//
// The __browser glue section is browser-only (references navigator,
// AudioContext, MediaRecorder inside function bodies). One cancel race is
// Node-driven with fake browser globals (cancel in the decode window); the
// rest is asserted for shape only and proven in the fake-mic e2e.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { parseWav, validateAudioBuffer } from "../lib/audio-validate.js";
import { createVoiceTransport } from "../lib/web-transport.js";

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const BUNDLE_PATH = path.join(REPO_ROOT, "gui", "gui-experimental.cjs");
const TOKEN = "w52-test-token";
const ORIGIN = "http://localhost:4096";

// --- bundle evaluation (the W5.1 pattern) -------------------------------------

// The app's fixed require-map ids whose resolution is NOT asserted here
// (node builtins + electron resolve to inert proxies in the app; anything
// outside the fixed map throws). The bundle must require only:
// @opencode/plugin/gui, solid-js, effect.
const INERT_IDS = new Set(
  "electron assert async_hooks buffer child_process cluster console crypto dgram diagnostics_channel dns domain events fs http http2 https inspector module net os path path/posix path/win32 perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util util/types v8 vm worker_threads zlib".split(
    " ",
  ),
);

function inertModule(id) {
  const label = `[inert module ${id}]`;
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === "toString") return () => label;
      if (prop === Symbol.hasInstance) return () => false;
      if (prop === "then") return undefined;
      return inertModule(id);
    },
    set() {
      return true;
    },
    apply() {
      return inertModule(id);
    },
    construct() {
      return inertModule(id);
    },
  });
}

let exportsPromise;

/**
 * Evaluates the real bundle file the same way the app does and returns the
 * FULL exports object (default plugin definition + __audio/__capture/__ws/
 * __browser sections).
 */
function loadBundleExports() {
  if (!exportsPromise) {
    exportsPromise = (async () => {
      const sdk = await import("@opencode/plugin/gui");
      const effectStub = {
        Schema: {
          Struct: (fields) => ({ kind: "struct", fields }),
          String: { kind: "string" },
          Boolean: { kind: "boolean" },
        },
      };
      const solidStub = { createComponent: (component, props) => component(props) };
      const known = {
        "@opencode/plugin/gui": sdk,
        "solid-js": solidStub,
        effect: effectStub,
      };
      const req = (id) => {
        if (known[id]) return known[id];
        if (id.startsWith("node:") || INERT_IDS.has(id)) return inertModule(id);
        throw new Error(`bundle requires an id outside the app's fixed map: ${id}`);
      };
      const code = fs.readFileSync(BUNDLE_PATH, "utf8");
      const moduleObj = { exports: {} };
      new Function("require", "module", "exports", code)(req, moduleObj, moduleObj.exports);
      return moduleObj.exports;
    })();
  }
  return exportsPromise;
}

// --- helpers -------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, { timeoutMs = 5000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = pred();
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await sleep(10);
  }
}

// 16 kHz mono sine, encoded through the bundle's own audio section.
function encodeSineWav(audio, { freq = 440, sampleRate = 16000, ms = 500, amp = 0.8 } = {}) {
  const n = Math.floor((sampleRate * ms) / 1000);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp;
  const pcm = audio.floatToPcm16(mono);
  return { buffer: Buffer.from(audio.encodePcm16Wav(pcm, sampleRate)), pcm, mono };
}

const envs = [];
after(async () => {
  for (const env of envs) {
    await env.t.close().catch(() => {});
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});

// A real, in-process frozen transport on an ephemeral port with STT and
// normalization stubbed — the same injection pattern test/web-transport.test.js
// uses (opts.transcribe + client). Node's undici WebSocket sends no Origin
// header, so allowNoOrigin lets the client authenticate through the ?token=
// query path alone (browser origin acceptance is pinned by the T1 tests with
// an explicit Origin header; the browser's origin is in the server's default
// allowed list).
async function makeEnv({ transcribe, client = null, limits } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "w52-transport-"));
  const t = createVoiceTransport({
    port: 0,
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    limits,
    kv: { get: () => null, set() {} },
    client,
    logger: null,
    opts: { tmpDir, allowNoOrigin: true, ...(transcribe ? { transcribe } : {}) },
  });
  if (!t.server.listening) await new Promise((r) => t.server.once("listening", r));
  const env = { t, tmpDir, url: t.url() };
  envs.push(env);
  return env;
}

// --- bundle surface --------------------------------------------------------------

test("bundle exports the W5.2 sections and keeps the W5.1 default", async () => {
  const exp = await loadBundleExports();
  for (const fn of ["encodePcm16Wav", "downmixToMono", "resampleLinear", "floatToPcm16"]) {
    assert.equal(typeof exp.__audio[fn], "function", `__audio.${fn}`);
  }
  assert.equal(typeof exp.__capture.nextCaptureState, "function");
  assert.ok(Array.isArray(exp.__capture.CAPTURE_STATES));
  assert.equal(typeof exp.__ws.createVoiceWsClient, "function");
  assert.equal(typeof exp.__browser.startBrowserCapture, "function");
  // mirrored frozen server defaults (lib/web-transport.js DEFAULT_LIMITS)
  assert.deepEqual(exp.__browser.SERVER_DEFAULT_LIMITS, {
    maxClipBytes: 20 * 1024 * 1024,
    minDurationMs: 300,
    maxDurationMs: 120000,
    resultTimeoutMs: 60000,
    inactivityMs: 15 * 60 * 1000,
  });
  // W5.1 scaffold untouched
  assert.equal(typeof exp.default, "object");
  assert.equal(typeof exp.default.setup, "function");
  assert.equal(typeof exp.default.main, "function");
});

// --- __audio: pure math -------------------------------------------------------------

test("__audio.encodePcm16Wav: byte-exact 44-byte header and payload", async () => {
  const { encodePcm16Wav } = await loadBundleExports().then((e) => e.__audio);
  const samples = new Int16Array([0, 32767, -32768, 1234, -1234]);
  const buf = Buffer.from(encodePcm16Wav(samples, 16000));

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + 10, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); // byteRate
  header.writeUInt16LE(2, 32); // blockAlign
  header.writeUInt16LE(16, 34); // bits
  header.write("data", 36, "ascii");
  header.writeUInt32LE(10, 40);
  const payload = Buffer.alloc(10);
  for (let i = 0; i < samples.length; i++) payload.writeInt16LE(samples[i], i * 2);

  assert.equal(buf.length, 54);
  assert.equal(Buffer.compare(buf.subarray(0, 44), header), 0, "header bytes differ");
  assert.equal(Buffer.compare(buf.subarray(44), payload), 0, "payload bytes differ");

  // other rates: header fields follow
  const buf2 = Buffer.from(encodePcm16Wav(samples, 44100));
  assert.equal(buf2.readUInt32LE(24), 44100);
  assert.equal(buf2.readUInt32LE(28), 88200);

  // empty input: 44 bytes, zero-length data chunk
  const buf0 = Buffer.from(encodePcm16Wav(new Int16Array(0), 16000));
  assert.equal(buf0.length, 44);
  assert.equal(buf0.readUInt32LE(4), 36);
  assert.equal(buf0.readUInt32LE(40), 0);
});

test("__audio: encode round-trips through lib/audio-validate.js", async () => {
  const audio = (await loadBundleExports()).__audio;
  const { buffer: wav } = encodeSineWav(audio); // 500 ms 440 Hz @ 16 kHz

  const parsed = parseWav(wav);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.pcm.sampleRate, 16000);
  assert.equal(parsed.pcm.channels, 1);
  assert.equal(parsed.pcm.bitsPerSample, 16);
  assert.ok(Math.abs(parsed.pcm.durationMs - 500) < 1);
  const validated = validateAudioBuffer(wav);
  assert.ok(validated.ok, JSON.stringify(validated));

  // empty clip rejected
  const empty = Buffer.from(audio.encodePcm16Wav(new Int16Array(0), 16000));
  const pe = parseWav(empty);
  assert.ok(!pe.ok);
  assert.equal(pe.reason, "EMPTY_DATA");
  assert.ok(!validateAudioBuffer(empty).ok);

  // header-truncated clips rejected at every cut point
  for (const cut of [12, 30, 40, 44]) {
    const p = parseWav(wav.subarray(0, cut));
    assert.ok(!p.ok, `slice(0, ${cut}) must not parse: ${JSON.stringify(p)}`);
  }
  assert.ok(!validateAudioBuffer(wav.subarray(0, 44)).ok);
});

test("__audio.resampleLinear: length, exact spots, same-rate copy, empty edge", async () => {
  const { resampleLinear } = (await loadBundleExports()).__audio;

  // integer ratio 48k -> 16k: out[i] === in[3i] exactly
  const n = 4800; // 100 ms
  const sine48 = new Float32Array(n);
  for (let i = 0; i < n; i++) sine48[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.8;
  const out = resampleLinear(sine48, 48000, 16000);
  assert.equal(out.length, 1600);
  for (const i of [0, 1, 500, 1599]) assert.equal(out[i], sine48[i * 3]);

  // fractional ratio 44.1k -> 16k on a linear ramp: interpolation is exact
  const ramp = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) ramp[i] = i;
  const out2 = resampleLinear(ramp, 44100, 16000);
  assert.equal(out2.length, Math.floor((1000 * 16000) / 44100)); // 362
  assert.equal(out2[0], 0);
  assert.equal(out2[100], 275.625); // pos = 100 * 44100 / 16000 exactly
  // pos = 361 * 44100 / 16000 = 995.00625; tolerance is float32 (out is a
  // Float32Array: 2^-23 relative ~ 1.2e-4 at this magnitude)
  assert.ok(Math.abs(out2[361] - 995.00625) < 1e-4);

  // same rate: exact copy
  const out3 = resampleLinear(sine48, 48000, 48000);
  assert.deepEqual(out3, sine48);

  // documented safe edge: empty input -> single zero sample
  const out4 = resampleLinear(new Float32Array(0), 48000, 16000);
  assert.equal(out4.length, 1);
  assert.equal(out4[0], 0);
});

test("__audio.downmixToMono: element-wise mean over channels", async () => {
  const { downmixToMono } = (await loadBundleExports()).__audio;
  assert.deepEqual(
    downmixToMono([new Float32Array([1, 2, 3]), new Float32Array([3, 4, 5])], 3),
    new Float32Array([2, 3, 4]),
  );
  assert.deepEqual(
    downmixToMono([new Float32Array([0.5, -0.5])], 2),
    new Float32Array([0.5, -0.5]),
  );
  assert.deepEqual(
    downmixToMono([new Float32Array([1]), new Float32Array([2]), new Float32Array([3])], 1),
    new Float32Array([2]),
  );
  // documented assumption: channels are equal-length (AudioBuffer); a shorter
  // channel contributes 0 for its missing tail
  assert.deepEqual(
    downmixToMono([new Float32Array([1, 2, 3]), new Float32Array([3, 4])], 3),
    new Float32Array([2, 3, 1.5]),
  );
});

test("__audio.floatToPcm16: clamps before scaling (clip, NaN, +-Inf)", async () => {
  const { floatToPcm16 } = (await loadBundleExports()).__audio;
  const inF = new Float32Array([3.0, -3.0, NaN, Infinity, -Infinity, 1, -1, 0.25, -0.25, 0]);
  const out = floatToPcm16(inF);
  assert.deepEqual(
    Array.from(out),
    [32767, -32768, 0, 32767, -32768, 32767, -32768, 8192, -8192, 0],
  );
});

// --- __capture: state machine ------------------------------------------------------

const CAPTURE_STATES = [
  "idle",
  "permission",
  "recording",
  "transcribing",
  "ready",
  "denied",
  "error",
];
const CAPTURE_EVENTS = [
  "PERMISSION_GRANTED",
  "PERMISSION_DENIED",
  "RECORDING_STARTED",
  "RECORDING_STOPPED",
  "UPLOAD_STARTED",
  "FINAL",
  "ERROR",
  "CANCELED",
  "RESET",
];

// The contract table, authored independently of the implementation.
const EXPECTED_TRANSITIONS = {
  idle: {
    PERMISSION_GRANTED: "permission",
    PERMISSION_DENIED: "denied",
    RECORDING_STARTED: "idle",
    RECORDING_STOPPED: "idle",
    UPLOAD_STARTED: "idle",
    FINAL: "idle",
    ERROR: "idle",
    CANCELED: "idle",
    RESET: "idle",
  },
  permission: {
    PERMISSION_GRANTED: "permission",
    PERMISSION_DENIED: "denied",
    RECORDING_STARTED: "recording",
    RECORDING_STOPPED: "permission",
    UPLOAD_STARTED: "permission",
    FINAL: "permission",
    ERROR: "error",
    CANCELED: "idle",
    RESET: "idle",
  },
  recording: {
    PERMISSION_GRANTED: "recording",
    PERMISSION_DENIED: "recording",
    RECORDING_STARTED: "recording",
    RECORDING_STOPPED: "transcribing",
    UPLOAD_STARTED: "transcribing",
    FINAL: "recording",
    ERROR: "error",
    CANCELED: "idle",
    RESET: "idle",
  },
  transcribing: {
    PERMISSION_GRANTED: "transcribing",
    PERMISSION_DENIED: "transcribing",
    RECORDING_STARTED: "transcribing",
    RECORDING_STOPPED: "transcribing",
    UPLOAD_STARTED: "transcribing",
    FINAL: "ready",
    ERROR: "error",
    CANCELED: "idle",
    RESET: "idle",
  },
  ready: {
    PERMISSION_GRANTED: "permission",
    PERMISSION_DENIED: "denied",
    RECORDING_STARTED: "ready",
    RECORDING_STOPPED: "ready",
    UPLOAD_STARTED: "ready",
    FINAL: "ready",
    ERROR: "ready",
    CANCELED: "idle",
    RESET: "idle",
  },
  denied: {
    PERMISSION_GRANTED: "permission",
    PERMISSION_DENIED: "denied",
    RECORDING_STARTED: "denied",
    RECORDING_STOPPED: "denied",
    UPLOAD_STARTED: "denied",
    FINAL: "denied",
    ERROR: "denied",
    CANCELED: "idle",
    RESET: "idle",
  },
  error: {
    PERMISSION_GRANTED: "permission",
    PERMISSION_DENIED: "error",
    RECORDING_STARTED: "error",
    RECORDING_STOPPED: "error",
    UPLOAD_STARTED: "error",
    FINAL: "error",
    ERROR: "error",
    CANCELED: "idle",
    RESET: "idle",
  },
};

test("__capture: exhaustive transition table (7 states x 9 events)", async () => {
  const { CAPTURE_STATES: exported, nextCaptureState } = (await loadBundleExports()).__capture;
  assert.deepEqual(exported, CAPTURE_STATES);
  for (const state of CAPTURE_STATES) {
    for (const event of CAPTURE_EVENTS) {
      const r = nextCaptureState(state, event);
      assert.deepEqual(r, { state: EXPECTED_TRANSITIONS[state][event] }, `${state} + ${event}`);
    }
  }
});

test("__capture: payload carried on landing, dropped on no-ops", async () => {
  const { nextCaptureState } = (await loadBundleExports()).__capture;
  const result = {
    rawText: "r",
    normalizedText: "n",
    detectedLanguage: "auto",
    timings: { uploadMs: 1, transcribeMs: 2, normalizeMs: 3 },
  };
  const err = { code: "STT_ERROR", safeMessage: "x" };

  assert.deepEqual(nextCaptureState("transcribing", "FINAL", result), {
    state: "ready",
    payload: result,
  });
  assert.deepEqual(nextCaptureState("permission", "ERROR", err), { state: "error", payload: err });
  assert.deepEqual(nextCaptureState("recording", "ERROR", err), { state: "error", payload: err });

  // FINAL after CANCELED = no-op: stay idle, result dropped (no payload key)
  const late = nextCaptureState("idle", "FINAL", result);
  assert.deepEqual(late, { state: "idle" });
  assert.ok(!Object.hasOwn(late, "payload"), "dropped final must not carry the result");

  // late error after a settled capture (ready/idle) is dropped
  const lateErr = nextCaptureState("ready", "ERROR", err);
  assert.deepEqual(lateErr, { state: "ready" });
  assert.ok(!Object.hasOwn(lateErr, "payload"));
  assert.deepEqual(nextCaptureState("idle", "ERROR", err), { state: "idle" });

  // robustness: unknown states/events never throw
  assert.deepEqual(nextCaptureState("bogus", "RESET"), { state: "bogus" });
  assert.deepEqual(nextCaptureState("idle", "BOGUS"), { state: "idle" });
});

// --- __ws: integration against the real frozen transport -------------------------

test("integration: bundle client -> real transport: start -> ready -> frame -> finish -> final", async () => {
  assert.equal(typeof globalThis.WebSocket, "function", "Node >= 22 global WebSocket required");
  const { encodePcm16Wav, floatToPcm16, createVoiceWsClient } = await loadBundleExports().then(
    (e) => ({ ...e.__audio, ...e.__ws }),
  );
  const transcribeCalls = [];
  const env = await makeEnv({
    transcribe: async (_kv, o) => {
      transcribeCalls.push({ ...o, sawFile: fs.existsSync(o.wavPath) });
      return { text: "stub raw" };
    },
    client: async () => ({ text: "stub normalized" }),
  });

  // a synthetic sine: 16 kHz, >= min duration (300 ms), non-silent
  const n = 16000; // 1 s
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.8;
  const wav = encodePcm16Wav(floatToPcm16(mono), 16000);
  assert.ok(validateAudioBuffer(Buffer.from(wav)).ok, "fixture wav must be audio-validate-safe");

  const states = [];
  const results = [];
  const errors = [];
  createVoiceWsClient({
    WebSocket: globalThis.WebSocket,
    url: env.url,
    token: TOKEN,
    recordingId: "w52-clip-1",
    wav,
    onStateChange: (s) => states.push(s),
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });

  const result = await waitFor(() => results[0], { label: "transcription.final" });
  assert.equal(result.rawText, "stub raw");
  assert.equal(result.normalizedText, "stub normalized");
  assert.equal(result.detectedLanguage, "auto");
  // verbatim payload fields only
  assert.deepEqual(Object.keys(result).sort(), [
    "detectedLanguage",
    "normalizedText",
    "rawText",
    "timings",
  ]);
  for (const k of ["uploadMs", "transcribeMs", "normalizeMs"]) {
    assert.ok(
      Number.isFinite(result.timings[k]) && result.timings[k] >= 0,
      `timings.${k} must be a finite number >= 0`,
    );
  }
  // one upload-phase state change, no teardown state after final
  assert.deepEqual(states, ["transcribing"]);
  assert.equal(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
  // the stubbed transcriber ran on the file the server wrote for our id
  assert.equal(transcribeCalls.length, 1);
  assert.ok(transcribeCalls[0].wavPath.endsWith("w52-clip-1.wav"));
  assert.ok(transcribeCalls[0].wavPath.startsWith(env.tmpDir));
  assert.ok(transcribeCalls[0].sawFile, "temp wav must exist while transcribing");
  await env.t.close();
});

test("integration: server closed mid-flight -> onError TRANSPORT_CLOSED", async () => {
  const { createVoiceWsClient } = (await loadBundleExports()).__ws;
  const audio = (await loadBundleExports()).__audio;
  let transcribeCalled = false;
  const env = await makeEnv({
    transcribe: async () => {
      transcribeCalled = true;
      return new Promise(() => {}); // never resolves
    },
  });
  const wav = encodeSineWav(audio).buffer; // Buffer works: send() accepts ArrayBufferView
  const states = [];
  const results = [];
  const errors = [];
  createVoiceWsClient({
    WebSocket: globalThis.WebSocket,
    url: env.url,
    token: TOKEN,
    recordingId: "w52-mid",
    wav,
    onStateChange: (s) => states.push(s),
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });
  await waitFor(() => transcribeCalled, { label: "pipeline running (finish received)" });
  await env.t.close(); // terminates the client: abrupt close, no close frame
  const err = await waitFor(() => errors[0], { label: "TRANSPORT_CLOSED" });
  assert.equal(err.code, "TRANSPORT_CLOSED");
  assert.ok(typeof err.safeMessage === "string" && err.safeMessage.length > 0);
  assert.equal(results.length, 0);
  assert.deepEqual(states, ["transcribing"]);
});

test("integration: wrong token -> rejected upgrade surfaces as TRANSPORT_CLOSED", async () => {
  const { createVoiceWsClient } = (await loadBundleExports()).__ws;
  const audio = (await loadBundleExports()).__audio;
  const env = await makeEnv({});
  const wav = encodeSineWav(audio).buffer;
  const results = [];
  const errors = [];
  createVoiceWsClient({
    WebSocket: globalThis.WebSocket,
    url: env.url,
    token: "wrong-token",
    recordingId: "w52-auth",
    wav,
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });
  const err = await waitFor(() => errors[0], { label: "auth rejection" });
  assert.equal(err.code, "TRANSPORT_CLOSED");
  assert.equal(results.length, 0);
  await env.t.close();
});

test("integration: server validation error passes through verbatim (SILENT)", async () => {
  const { createVoiceWsClient } = (await loadBundleExports()).__ws;
  const { encodePcm16Wav } = (await loadBundleExports()).__audio;
  const env = await makeEnv({});
  // 500 ms of digital silence @ 16 kHz
  const wav = encodePcm16Wav(new Int16Array(8000), 16000);
  const results = [];
  const errors = [];
  createVoiceWsClient({
    WebSocket: globalThis.WebSocket,
    url: env.url,
    token: TOKEN,
    recordingId: "w52-silent",
    wav,
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });
  const err = await waitFor(() => errors[0], { label: "transcription.error" });
  assert.equal(err.code, "SILENT");
  assert.ok(typeof err.safeMessage === "string" && err.safeMessage.length > 0);
  assert.equal(results.length, 0);
  await env.t.close();
});

test("integration: cancel() mid-upload -> state idle, late result dropped, no error", async () => {
  const { createVoiceWsClient } = (await loadBundleExports()).__ws;
  const audio = (await loadBundleExports()).__audio;
  // The pipeline may already be running when the cancel frame lands (the
  // server releases a processing rec only when the pipeline notices the
  // canceled flag); it resolves late with a result that must never be
  // delivered.
  const env = await makeEnv({
    transcribe: async () => {
      await sleep(50);
      return { text: "late result" };
    },
  });
  const wav = encodeSineWav(audio).buffer;
  const states = [];
  const results = [];
  const errors = [];
  const handle = createVoiceWsClient({
    WebSocket: globalThis.WebSocket,
    url: env.url,
    token: TOKEN,
    recordingId: "w52-cancel",
    wav,
    onStateChange: (s) => states.push(s),
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });
  await waitFor(() => states.includes("transcribing"), { label: "upload phase" });
  handle.cancel();
  await sleep(200); // let the late pipeline complete; nothing may arrive
  assert.deepEqual(states, ["transcribing", "idle"]);
  assert.equal(results.length, 0, "cancel must drop any late result");
  assert.equal(errors.length, 0, "cancel must not surface a transport error");
  await env.t.close();
});

test("ws client: cancel before the socket opens tears down quietly", async () => {
  const { createVoiceWsClient } = (await loadBundleExports()).__ws;
  const audio = (await loadBundleExports()).__audio;
  const env = await makeEnv({});
  const wav = encodeSineWav(audio).buffer;
  const states = [];
  const results = [];
  const errors = [];
  const handle = createVoiceWsClient({
    WebSocket: globalThis.WebSocket,
    url: env.url,
    token: TOKEN,
    recordingId: "w52-cancel-early",
    wav,
    onStateChange: (s) => states.push(s),
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });
  handle.cancel();
  await sleep(80);
  assert.deepEqual(states, ["idle"]);
  assert.equal(results.length, 0);
  assert.equal(errors.length, 0);
  await env.t.close();
});

// --- __browser glue: cancel in the decode window (fix round 1) --------------------
//
// processRecording awaits blob.arrayBuffer() and decodeAudioData() before it
// may call createVoiceWsClient; the glue's own WebSocket dep is injectable,
// so the injected class is the connection attempt itself:
// createVoiceWsClient constructs it synchronously the moment the glue
// reaches the upload. Recording (and throwing) on construction proves
// "no connection attempt" — the transport therefore never sees a
// recording.start either.

function installFakeBrowser({ decodePromise }) {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const fakeStream = { getTracks: () => [track] };
  const blob = {
    size: 16000,
    arrayBufferCalled: false,
    arrayBuffer: async () => {
      blob.arrayBufferCalled = true;
      return new ArrayBuffer(16);
    },
  };
  let ctxClosed = false;
  let decodeCalled = false;
  class FakeAudioContext {
    close() {
      ctxClosed = true;
    }
    decodeAudioData() {
      decodeCalled = true;
      return decodePromise;
    }
  }
  class FakeMediaRecorder {
    static isTypeSupported() {
      return false;
    }
    constructor() {
      this.state = "inactive";
    }
    start() {
      this.state = "recording";
      if (this.ondataavailable) this.ondataavailable({ data: blob });
    }
    stop() {
      this.state = "inactive";
      if (this.onstop) this.onstop();
    }
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    enumerable: true,
    value: { mediaDevices: { getUserMedia: async () => fakeStream } },
  });
  globalThis.AudioContext = FakeAudioContext;
  globalThis.MediaRecorder = FakeMediaRecorder;
  return {
    flags: {
      get arrayBufferCalled() {
        return blob.arrayBufferCalled;
      },
      get decodeCalled() {
        return decodeCalled;
      },
      get trackStopped() {
        return track.stopped;
      },
      get ctxClosed() {
        return ctxClosed;
      },
    },
    uninstall() {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
      delete globalThis.AudioContext;
      delete globalThis.MediaRecorder;
    },
  };
}

test("glue: cancel in the decode window -> late decode never opens a socket", async () => {
  const { startBrowserCapture } = (await loadBundleExports()).__browser;

  // Controllable decode promise = the decode window: cancel() lands while
  // decodeAudioData is pending, and the promise only resolves afterwards,
  // so the continuation must notice `canceled` before it may upload.
  let resolveDecode;
  const decodePromise = new Promise((r) => {
    resolveDecode = r;
  });
  // Late, fully valid decode result: 500 ms 440 Hz mono @ 16 kHz — within
  // every preflight limit, so without the guard the continuation would
  // encode, preflight-pass and create the client.
  const n = 8000;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.8;
  const fakeAudioBuffer = {
    numberOfChannels: 1,
    length: n,
    sampleRate: 16000,
    getChannelData: () => mono,
  };

  const wsConstructions = [];
  class RecordingWebSocket {
    constructor(href) {
      wsConstructions.push(href);
      throw new Error("connection attempt after cancel");
    }
  }

  const fake = installFakeBrowser({ decodePromise });
  try {
    const states = [];
    const results = [];
    const errors = [];
    const handle = startBrowserCapture({
      WebSocket: RecordingWebSocket,
      url: "ws://127.0.0.1:4096",
      token: TOKEN,
      onStateChange: (s) => states.push(s),
      onResult: (r) => results.push(r),
      onError: (e) => errors.push(e),
    });

    await waitFor(() => handle.getState() === "recording", { label: "recording" });
    handle.stop();
    await waitFor(() => fake.flags.decodeCalled, { label: "decode window open" });
    assert.equal(
      fake.flags.arrayBufferCalled,
      true,
      "cancel must land AFTER the arrayBuffer await, in the decode window",
    );
    handle.cancel();

    assert.equal(wsConstructions.length, 0, "no connection while decode is pending");
    assert.equal(handle.getState(), "idle");

    // The late decode result now arrives; the continuation runs but must
    // stop at the guard — no socket, no upload, no callback.
    resolveDecode(fakeAudioBuffer);
    await sleep(80);

    assert.equal(wsConstructions.length, 0, "late decode must not open a socket");
    assert.equal(handle.getState(), "idle", "final state stays idle");
    assert.deepEqual(states, ["permission", "recording", "transcribing", "idle"]);
    assert.equal(results.length, 0, "no result for a canceled capture");
    assert.equal(errors.length, 0, "no error surfaced by a canceled capture");
    assert.equal(fake.flags.trackStopped, true, "mic track released on cancel");
    assert.equal(fake.flags.ctxClosed, true, "AudioContext closed on cancel");
  } finally {
    fake.uninstall();
  }
});

test("ws client: programming deps throw; unparseable wav reports INVALID_WAV", async () => {
  const { createVoiceWsClient } = (await loadBundleExports()).__ws;
  assert.throws(() => createVoiceWsClient({}), /WebSocket required/);
  assert.throws(() => createVoiceWsClient({ WebSocket: globalThis.WebSocket }), /url required/);
  assert.throws(
    () =>
      createVoiceWsClient({
        WebSocket: globalThis.WebSocket,
        url: "ws://127.0.0.1:1",
      }),
    /token required/,
  );
  const errors = [];
  createVoiceWsClient({
    WebSocket: globalThis.WebSocket,
    url: "ws://127.0.0.1:1",
    token: "t",
    recordingId: "r",
    wav: new ArrayBuffer(8),
    onError: (e) => errors.push(e),
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "INVALID_WAV");
});
