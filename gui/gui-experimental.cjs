// W5.1 spike: OpenCode GUI plugin scaffold for web voice input.
//
// This file is the plugin's `./gui-experimental` entry. OpenCode v2.2.5 reads
// the resolved file, serves its source to the app window (GET
// /api/plugin/gui?id=<plugin id>) and evaluates it as CommonJS with
// Function("require","module","exports", code). `require` is mapped to the
// app's shared module graph — the only resolvable ids are:
//
//   effect, @opencode/plugin/gui, @opencode/plugin/gui/main,
//   @opencode/plugin/gui/file, @opencode/plugin/gui/review,
//   @opencode/plugin/gui/browser, @opencode/plugin/rpc,
//   @opencode/schema/rpc, @opencode/client, @opencode/client/effect,
//   @opencode/client/solid, solid-js, solid-js/web, solid-js/store
//
// (Node builtins resolve to inert stubs; anything else throws.) There is no
// `h` JSX factory in the shared solid-js/web namespace, so UI is composed
// imperatively with document.createElement plus `createComponent` for the
// app's own components (ctx.ui.*). See .superpowers/sdd/plan/task-w51-report.md
// for the evidence and for what W5.3 must keep or change.
//
// W5.3 TODO: replace the stub Ipc values (main entry) with the sonic sidecar
// wiring from lib/web-transport.js, and replace the spike popover with the
// record/stop/cancel surface.
//
// W5.2 appends the browser media capture client as four sections at the
// bottom of this file, exported non-default as __audio / __capture / __ws /
// __browser (pure audio math, capture state machine, WS protocol client,
// thin browser glue). Node contract tests exercise these exact exports.

"use strict";

const { Plugin, Ipc, ComposerPill } = require("@opencode/plugin/gui");
const { createComponent } = require("solid-js");
const { Schema } = require("effect");

// The host assigns this plugin the id of the package that ships it
// (no server entry, so the id is the package name).
const PLUGIN_ID = "@renjfk/opencode-voice";

// Ipc between this plugin's main entry and its windows. The id must be the
// plugin id or live under it (<id>.<name>). W5.1 returns a static stub; the
// real { url, token } of the sonic transport is W5.3.
const VoiceIpc = Ipc.define({
  id: `${PLUGIN_ID}.voice`,
  methods: {
    config: {
      output: Schema.Struct({ url: Schema.String, token: Schema.String }),
    },
    ping: { output: Schema.Boolean },
  },
});

const SPIKE_DRAFT_TEXT = "voice spike draft";

// Popover content for the "Voice" pill. Rendered by the host each time the
// popover opens, under the plugin's Solid owner; the host calls `menu` with
// { session, screen, close } (ignored here — the spike reads ctx directly).
function voicePopover(ctx) {
  const root = document.createElement("div");
  root.className = "opencode-voice-popover";
  root.setAttribute("data-testid", "voice-popover");

  // Requirement 4 (W5.1): the window entry reads the main-entry Ipc through
  // ctx.main(token). Per the SDK (gui/context.d.ts): on the web an IpcClient
  // call waits indefinitely while the plugin's main entry is off — and on the
  // served web app (v2.2.5) it never runs, `main` executes only in the
  // desktop app's main process. Firing the call on web would therefore hang
  // the status on "loading" forever, so the web branch proves the client
  // interface is present instead; on desktop the same code renders the stub
  // { url, token }.
  const status = document.createElement("p");
  status.className = "opencode-voice-ipc-status";
  status.setAttribute("data-testid", "voice-ipc-status");
  root.appendChild(status);

  if (ctx.app.platform === "desktop") {
    status.textContent = ctx.t("ipcLoading");
    const voice = ctx.main(VoiceIpc);
    void voice.config().then(
      (config) => {
        status.textContent = ctx.t("ipcOk", {
          url: config.url,
          token: config.token,
        });
      },
      (cause) => {
        status.textContent = ctx.t("ipcUnavailable", {
          error: String(cause),
        });
      },
    );
  } else {
    const voice = ctx.main(VoiceIpc);
    status.textContent = ctx.t("ipcWeb", {
      hasConfig: typeof voice.config === "function" ? "yes" : "no",
      hasPing: typeof voice.ping === "function" ? "yes" : "no",
    });
  }

  // Requirement 3 (W5.1): composer write access (PR #59469 surface).
  // `ctx.screen.current()` is the mounted session screen; `input.screen` is
  // the equivalent route-following reference the pill receives.
  const writeDraft = createComponent(ctx.ui.Button, {
    icon: "waveform",
    variant: "neutral",
    size: "small",
    class: "opencode-voice-write-draft",
    "data-testid": "voice-write-draft",
    children: ctx.t("writeDraft"),
    onClick: () => {
      ctx.screen.current()?.composer.setText(SPIKE_DRAFT_TEXT);
    },
  });
  root.appendChild(writeDraft);

  return root;
}

module.exports.default = Plugin.define({
  i18n: {
    en: {
      pill: "Voice",
      title: "Voice input (W5.1 spike)",
      ipcLoading: "voice ipc: loading",
      ipcOk: "voice ipc: {{url}} (token: {{token}})",
      ipcUnavailable: "voice ipc unavailable: {{error}}",
      ipcWeb:
        "web platform: main entry is desktop-only; Ipc client present (config: {{hasConfig}}, ping: {{hasPing}})",
      writeDraft: "Write spike draft",
    },
  },
  // Window entry: register the "Voice" ComposerPill in the lane above the
  // session composer. `show` is re-run by the host when what it reads
  // changes (W5.3 makes the icon/label follow the recording state here).
  setup(ctx) {
    ctx.add(ComposerPill, {
      id: "voice",
      show: () => ({
        label: ctx.t("pill"),
        icon: "waveform",
        title: ctx.t("title"),
      }),
      menu: () => voicePopover(ctx),
    });
  },
  // Main entry: provide the Ipc stub. Runs in the desktop app's main
  // process; on the served web app v2.2.5 it is not started (finding F2 in
  // the W5.1 report), which the window entry surfaces in the popover.
  main(ctx) {
    ctx.provide(VoiceIpc, {
      config: () => ({ url: "ws://localhost:0", token: "stub" }),
      ping: () => true,
    });
  },
});

// ============================================================================
// W5.2 — browser media capture client (task 2.3).
//
// Everything the window entry needs must live inside this file: the host
// serves this source and evaluates it with Function("require","module",
// "exports", code) against a fixed require map — it cannot import lib/ or a
// sibling gui file (W5.1 report, "API notes for W5.3"). The pure sections
// are exported non-default on module.exports so the Node contract test
// (tests/w52-capture-contract.test.js) exercises the EXACT production code
// the window entry uses — no copies, no duplication.
//
//   __audio    pure audio math (Node-runnable, no browser APIs)
//   __capture  capture state machine (pure)
//   __ws       WS protocol client for lib/web-transport.js (Node-runnable)
//   __browser  thin browser glue (executes only in a real browser; W5.3
//              wires it into the pill UI)

// --- W5.2 section 1: pure audio math -----------------------------------------

// DataView has no string writer; write a 4-char ASCII tag.
function writeWavTag(dv, off, tag) {
  for (let i = 0; i < 4; i++) dv.setUint8(off + i, tag.charCodeAt(i));
}

// Mono PCM16 little-endian RIFF/WAVE with a byte-exact 44-byte header:
// RIFF size = 36 + dataLen; fmt chunk 16 bytes; audioFormat 1 (PCM);
// channels 1; byteRate = rate * 2; blockAlign 2; bitsPerSample 16.
function encodePcm16Wav(samples, sampleRate) {
  const dataLen = samples.length * 2;
  const out = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(out);
  writeWavTag(dv, 0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  writeWavTag(dv, 8, "WAVE");
  writeWavTag(dv, 12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeWavTag(dv, 36, "data");
  dv.setUint32(40, dataLen, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true);
  return out;
}

// Element-wise mean of N channels.
// Documented assumption: callers pass channels of EQUAL length (that is what
// AudioBuffer.getChannelData returns). A shorter channel contributes 0 for
// its missing tail and the divisor stays channels.length, so the output
// length is max(length, channel lengths) and unbalanced input biases low
// instead of crashing.
function downmixToMono(channels, length) {
  let n = typeof length === "number" && length > 0 ? Math.floor(length) : 0;
  for (const ch of channels) if (ch.length > n) n = ch.length;
  const out = new Float32Array(n);
  for (const ch of channels) {
    for (let i = 0; i < ch.length && i < n; i++) out[i] += ch[i];
  }
  if (channels.length > 0) {
    const inv = 1 / channels.length;
    for (let i = 0; i < n; i++) out[i] *= inv;
  }
  return out;
}

// Linear-interpolation resample.
//   outLen = max(1, floor(input.length * outputRate / inputRate))
//   out[i] = input interpolated at pos = i * inputRate / outputRate
// Documented safe edge: empty input would yield NaN under the formula, so it
// returns a single zero sample (outLen 1) instead.
function resampleLinear(input, inputRate, outputRate) {
  if (input.length === 0) return new Float32Array(1);
  const outLen = Math.max(1, Math.floor((input.length * outputRate) / inputRate));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = (i * inputRate) / outputRate;
    const i0 = Math.floor(pos);
    const s0 = input[i0];
    const s1 = i0 + 1 < input.length ? input[i0 + 1] : s0;
    out[i] = s0 + (s1 - s0) * (pos - i0);
  }
  return out;
}

// Float (typically [-1, 1]) -> PCM16. Clamps BEFORE scaling:
// NaN -> 0, v >= 1 (incl. +Inf) -> 32767, v <= -1 (incl. -Inf) -> -32768,
// otherwise round(v * 32767).
function floatToPcm16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (Number.isNaN(v)) out[i] = 0;
    else if (v >= 1) out[i] = 32767;
    else if (v <= -1) out[i] = -32768;
    else out[i] = Math.round(v * 32767);
  }
  return out;
}

module.exports.__audio = { encodePcm16Wav, downmixToMono, resampleLinear, floatToPcm16 };

// --- W5.2 section 2: capture state machine (pure) -----------------------------

const CAPTURE_STATES = [
  "idle",
  "permission",
  "recording",
  "transcribing",
  "ready",
  "denied",
  "error",
];

// Exhaustive transition table (every state x every event). A value equal to
// the row key is a no-op (stay). Named justifications for the non-obvious:
//   - PERMISSION_GRANTED re-arms a capture from idle/denied/error/ready: a
//     new attempt always starts with a fresh permission grant; denied/error/
//     ready are terminal for the previous attempt.
//   - PERMISSION_DENIED from ready -> denied: the new attempt supersedes the
//     previous (delivered) result.
//   - ERROR from idle/ready/denied/error is dropped: a late error after the
//     capture settled (socket close after final or after cancel) must not
//     resurrect an error state.
//   - FINAL from anywhere but transcribing is dropped — CANCELED/RESET reach
//     idle first, so a late final stays idle with the result discarded.
//   - RECORDING_STOPPED and UPLOAD_STARTED both mean "mic done, result
//     pending": recording -> transcribing; from transcribing they are no-ops.
//   - CANCELED and RESET are total: every state -> idle.
const CAPTURE_TRANSITIONS = {
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

// Pure: (current, event, payload?) -> { state } or { state, payload }.
// The payload (the final result / the error object) is carried only when the
// event lands in its active source state (FINAL from transcribing, ERROR
// from permission/recording/transcribing); dropped no-ops carry none, so a
// late final after CANCELED is a plain { state: "idle" }. Unknown states or
// events are no-ops (defensive, never throws).
function nextCaptureState(current, event, payload) {
  const row = CAPTURE_TRANSITIONS[current];
  const state = row && row[event] !== undefined ? row[event] : current;
  const lands =
    (event === "FINAL" && current === "transcribing") ||
    (event === "ERROR" &&
      (current === "permission" || current === "recording" || current === "transcribing"));
  if (lands && payload !== undefined) return { state, payload };
  return { state };
}

module.exports.__capture = { CAPTURE_STATES, nextCaptureState };

// --- W5.2 section 3: WS protocol client (Node-runnable) ------------------------
//
// Speaks the frozen lib/web-transport.js sidecar protocol. Server contract,
// read from that file (never modified here):
//   - auth: checkUpgrade reads the token from the `?token=` query parameter
//     first (URL searchParams), falling back to an Authorization: Bearer
//     header. Browsers cannot set WS upgrade headers, so this client always
//     appends the token as a query parameter — the server's query path
//     accepts exactly that (web-transport.js checkUpgrade, lines ~189-213).
//   - recording.start must carry codec === "audio/wav" (the server rejects
//     anything else with INVALID_START) and a sampleRate from its allowed
//     list (default [16000]); the client derives sampleRate from the WAV
//     header so start and payload can never disagree.
//   - optional sizeBytes in recording.start = preflight oversize reject.
//   - transcription.final carries { rawText, normalizedText,
//     detectedLanguage, timings } — forwarded verbatim to onResult.
//   - transcription.error carries { code, safeMessage } — forwarded to
//     onError.
//   - a close before any terminal message -> client-side-only stable
//     onError({ code: "TRANSPORT_CLOSED" }) (covers rejected upgrades
//     4001/4002, network failure, server shutdown).
//
// Runs on any spec-compliant WebSocket: the browser's window.WebSocket or
// Node >=22's global (undici) — which is how the contract test drives it
// against a real in-process createVoiceTransport.
//
// onStateChange contract (capture-state vocabulary): "transcribing" once,
// when the socket is open and the upload phase begins; "idle" once, when
// cancel() tears down. No state callback after a terminal final/error —
// onResult/onError carry the outcome and the machine reaches ready/error
// there.

const WS_READY_OPEN = 1; // WebSocket spec readyState (0 connecting … 3 closed)

// Normalize the wav bytes to a plain ArrayBuffer (the browser type the
// client sends and parses). Node tests may hand in an ArrayBufferView such
// as a Buffer; newer V8 rejects ArrayBufferView in the DataView constructor,
// so copy views into their own buffer.
function toWavArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes && bytes.buffer instanceof ArrayBuffer && typeof bytes.byteLength === "number") {
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return out;
  }
  return null;
}

// sampleRate from a RIFF/WAVE header (the "fmt " chunk: u32 LE four bytes
// into the chunk body). null when the header is not recognizable.
function readWavSampleRate(wav) {
  if (!wav || wav.byteLength < 28) return null;
  const dv = new DataView(wav);
  const tag = (off) =>
    String.fromCharCode(
      dv.getUint8(off),
      dv.getUint8(off + 1),
      dv.getUint8(off + 2),
      dv.getUint8(off + 3),
    );
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let off = 12;
  while (off + 8 <= wav.byteLength) {
    const size = dv.getUint32(off + 4, true);
    if (tag(off) === "fmt ") {
      if (off + 8 + 16 > wav.byteLength) return null;
      return dv.getUint32(off + 8 + 4, true);
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

// deps: { WebSocket, url, token, recordingId, wav, onStateChange, onResult,
// onError }. wav is the encoded clip as an ArrayBuffer (the browser type;
// ArrayBufferViews such as Node Buffers are accepted and copied). Throws on
// missing programming deps (WebSocket/url/token/recordingId); reports
// runtime failures (bad wav, closed transport, server errors) via onError.
// Returns { cancel, stop }.
function createVoiceWsClient(deps) {
  const {
    WebSocket: WSImpl,
    url,
    token,
    recordingId,
    wav,
    onStateChange = () => {},
    onResult = () => {},
    onError = () => {},
  } = deps;
  if (typeof WSImpl !== "function") throw new Error("createVoiceWsClient: WebSocket required");
  if (typeof url !== "string" || url.length === 0)
    throw new Error("createVoiceWsClient: url required");
  if (typeof token !== "string" || token.length === 0)
    throw new Error("createVoiceWsClient: token required");
  if (typeof recordingId !== "string" || recordingId.length === 0)
    throw new Error("createVoiceWsClient: recordingId required");

  let ws = null;
  let done = false; // terminal: final, error, or cancel — no further callbacks

  function closeSocket() {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    const sock = ws;
    ws = null;
    try {
      if (sock.readyState !== 3) sock.close();
    } catch {
      // already closed
    }
  }

  function sendJson(obj) {
    if (ws && ws.readyState === WS_READY_OPEN) ws.send(JSON.stringify(obj));
  }

  function fail(code, safeMessage) {
    if (done) return;
    done = true;
    onError({ code, safeMessage });
    closeSocket();
  }

  function cancel() {
    if (done) return;
    done = true;
    // best effort: the server knows the id only once recording.start landed
    sendJson({ type: "recording.cancel", id: recordingId });
    onStateChange("idle");
    closeSocket();
  }

  function stop() {
    // Happy-path completion: recording.finish. The client also sends it
    // automatically right after the single binary frame; this is the
    // explicit (idempotent) form for callers.
    if (done) return;
    sendJson({ type: "recording.finish", id: recordingId });
  }

  const wavBytes = toWavArrayBuffer(wav);
  if (wavBytes === null) {
    fail("INVALID_WAV", "unrecognized wav bytes");
    return { cancel, stop };
  }
  const sampleRate = readWavSampleRate(wavBytes);
  if (sampleRate === null) {
    fail("INVALID_WAV", "unrecognized wav header");
    return { cancel, stop };
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    fail("INVALID_URL", "unparseable transport url");
    return { cancel, stop };
  }
  target.searchParams.set("token", token); // browser-compatible auth (see above)

  ws = new WSImpl(target.href);

  ws.onopen = () => {
    onStateChange("transcribing"); // upload phase begins (glue maps UPLOAD_STARTED)
    sendJson({
      type: "recording.start",
      id: recordingId,
      codec: "audio/wav", // the server's exact required value
      sampleRate,
      sizeBytes: wavBytes.byteLength, // optional preflight the server honors
    });
  };

  ws.onmessage = (ev) => {
    if (done) return;
    if (typeof ev.data !== "string") return; // the server never sends binary
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "recording.ready" && msg.id === recordingId) {
      // MVP = completed-utterance transfer: ONE binary frame with the full
      // WAV, then finish (FIFO per socket preserves the order).
      if (ws && ws.readyState === WS_READY_OPEN) {
        ws.send(wavBytes);
        sendJson({ type: "recording.finish", id: recordingId });
      }
    } else if (msg.type === "transcription.started") {
      // informational — already "transcribing"
    } else if (msg.type === "transcription.final" && msg.recordingId === recordingId) {
      done = true;
      onResult({
        rawText: msg.rawText,
        normalizedText: msg.normalizedText,
        detectedLanguage: msg.detectedLanguage,
        timings: msg.timings,
      });
      closeSocket();
    } else if (
      msg.type === "transcription.error" &&
      (msg.recordingId === undefined || msg.recordingId === recordingId)
    ) {
      // a single-recording client owns every id-less error on the socket
      fail(
        typeof msg.code === "string" && msg.code ? msg.code : "PROTOCOL",
        typeof msg.safeMessage === "string" && msg.safeMessage
          ? msg.safeMessage
          : "transcription error",
      );
    } else if (msg.type === "recording.canceled" && msg.id === recordingId) {
      done = true; // the caller already moved on (cancel) — no callback
      closeSocket();
    }
  };

  ws.onclose = () => {
    fail("TRANSPORT_CLOSED", "voice transport closed before a result");
  };

  ws.onerror = () => {
    // the close event follows and reports TRANSPORT_CLOSED
  };

  return { cancel, stop };
}

module.exports.__ws = { createVoiceWsClient };

// --- W5.2 section 4: browser glue (executes only in a real browser) -----------
//
// Thin by design: the heavy logic lives in sections 1-3 (Node-tested). This
// section references navigator / AudioContext / MediaRecorder only inside
// function bodies, so the bundle still evaluates under Node and the host's
// CJS evaluator — it is just never called there.

// Mirror of lib/web-transport.js DEFAULT_LIMITS (frozen). The bundle cannot
// require lib/, so this is kept in sync by hand (see the W5.2 report). The
// server stays the authority; these values only preflight locally.
const SERVER_DEFAULT_LIMITS = {
  maxClipBytes: 20 * 1024 * 1024,
  minDurationMs: 300,
  maxDurationMs: 120000,
  resultTimeoutMs: 60000,
  inactivityMs: 15 * 60 * 1000,
};

// MediaRecorder container preference. COMMENT (design.md): never assume
// MediaRecorder emits PCM WAV — Chromium emits webm/opus, Safari mp4/aac.
// The blob is decoded back with AudioContext.decodeAudioData and re-encoded
// to PCM16 WAV by section 1; the container is an implementation detail.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function makeRecordingId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `web-${c.randomUUID()}`;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// deps: {
//   WebSocket        injected for tests; default globalThis.WebSocket
//   onStateChange    (state) — capture-state transitions as they happen
//   onResult         (result) — { rawText, normalizedText, detectedLanguage,
//                        timings }, fired only when the machine lands on
//                        "ready" (late/dropped finals never fire it)
//   onError          (err) — { code, safeMessage }, fired only when the
//                        machine lands on "error"
//   targetSampleRate 16000 — must be in the server's allowed rates
//   limits           SERVER_DEFAULT_LIMITS — preflight only
//   url, token       the transport config from the plugin's main-entry Ipc
//                    (W5.3 resolves it via ctx.main(VoiceIpc).config())
// }
// Returns { stop, cancel, getState }. stop() ends the capture normally;
// cancel() aborts it (CANCELED -> idle, resources released, recording.cancel
// sent when the server knows the id yet). This module has NO composer
// knowledge and never auto-submits — W5.3 decides what to do with the result.
function startBrowserCapture(deps) {
  const {
    WebSocket: WSImpl = globalThis.WebSocket,
    onStateChange = () => {},
    onResult = () => {},
    onError = () => {},
    targetSampleRate = 16000,
    limits = { ...SERVER_DEFAULT_LIMITS },
    url,
    token,
  } = deps;

  let currentState = "idle";
  let stream = null;
  let audioCtx = null;
  let recorder = null;
  let client = null;
  let canceled = false;
  let cleaned = false;

  // onStateChange fires only on ACTUAL state changes (no-op transitions —
  // e.g. UPLOAD_STARTED from transcribing — stay quiet), so UI observers can
  // react 1:1.
  function transition(event, payload) {
    const next = nextCaptureState(currentState, event, payload);
    const changed = next.state !== currentState;
    currentState = next.state;
    if (changed) onStateChange(next.state);
    return next;
  }

  // Cleanup on EVERY terminal path: mic tracks stopped, AudioContext closed,
  // recorder handlers cleared. This module owns no timers, so there are no
  // orphan timers; the WS client closes its own socket on its terminal paths.
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      recorder = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // track already stopped
        }
      }
      stream = null;
    }
    if (audioCtx) {
      const ctx = audioCtx;
      audioCtx = null;
      try {
        ctx.close();
      } catch {
        // already closed
      }
    }
  }

  function failCapture(code, safeMessage) {
    const payload = { code, safeMessage };
    const next = transition("ERROR", payload);
    if (next.payload) onError(payload);
    cleanup();
  }

  function begin() {
    // 1. explicit permission (getUserMedia). The machine stays idle until
    //    the grant: "permission" means granted-and-starting (table docs).
    navigator.mediaDevices
      .getUserMedia({ audio: { sampleRate: targetSampleRate, channelCount: 1 } })
      .then((gum) => {
        if (canceled) {
          for (const track of gum.getTracks()) track.stop();
          return;
        }
        stream = gum;
        transition("PERMISSION_GRANTED"); // idle -> permission
        startRecorder();
      })
      .catch((err) => {
        if (canceled) return;
        const name = err && err.name;
        if (
          name === "NotAllowedError" ||
          name === "SecurityError" ||
          name === "PermissionDeniedError"
        ) {
          transition("PERMISSION_DENIED"); // state only; W5.3 shows recovery guidance
          cleanup();
        } else {
          failCapture(
            "MIC_UNAVAILABLE",
            err && err.message ? err.message : "microphone unavailable",
          );
        }
      });
  }

  function startRecorder() {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      audioCtx = new Ctx();
    } catch (err) {
      failCapture(
        "AUDIO_CONTEXT_FAILED",
        err && err.message ? err.message : "audio context unavailable",
      );
      return;
    }
    let mimeType = "";
    const MR = globalThis.MediaRecorder;
    if (MR && typeof MR.isTypeSupported === "function") {
      for (const cand of MIME_CANDIDATES) {
        if (MR.isTypeSupported(cand)) {
          mimeType = cand;
          break;
        }
      }
    }
    let rec;
    try {
      rec = mimeType ? new MR(stream, { mimeType }) : new MR(stream);
    } catch (err) {
      failCapture(
        "RECORD_START_FAILED",
        err && err.message ? err.message : "media recorder unavailable",
      );
      return;
    }
    recorder = rec;
    let blob = null;
    rec.ondataavailable = (ev) => {
      if (ev && ev.data && ev.data.size > 0) blob = ev.data;
    };
    rec.onerror = () => {
      if (canceled) return;
      failCapture("RECORD_ERROR", "recorder error");
    };
    rec.onstop = () => {
      if (canceled) return; // the cancel path already cleaned up
      void processRecording(blob);
    };
    try {
      rec.start();
    } catch (err) {
      failCapture(
        "RECORD_START_FAILED",
        err && err.message ? err.message : "recorder start failed",
      );
      return;
    }
    transition("RECORDING_STARTED"); // permission -> recording
  }

  async function processRecording(blob) {
    transition("RECORDING_STOPPED"); // recording -> transcribing
    let wav;
    try {
      if (!blob || blob.size === 0) throw new Error("no audio data captured");
      const decoded = await audioCtx.decodeAudioData(await blob.arrayBuffer());
      const channels = [];
      for (let i = 0; i < decoded.numberOfChannels; i++) channels.push(decoded.getChannelData(i));
      const mono = downmixToMono(channels, decoded.length);
      const resampled = resampleLinear(mono, decoded.sampleRate, targetSampleRate);
      const pcm = floatToPcm16(resampled);
      wav = encodePcm16Wav(pcm, targetSampleRate);
      // Preflight against the mirrored server limits (the server stays the
      // authority; this skips a doomed round trip):
      if (wav.byteLength > limits.maxClipBytes) {
        failCapture("TOO_LARGE", "clip exceeds size limit");
        return;
      }
      const durationMs = (pcm.length / targetSampleRate) * 1000;
      if (durationMs < limits.minDurationMs) {
        failCapture("TOO_SHORT", "clip shorter than the minimum duration");
        return;
      }
      if (durationMs > limits.maxDurationMs) {
        failCapture("TOO_LONG", "clip longer than the maximum duration");
        return;
      }
    } catch (err) {
      const code = !blob || blob.size === 0 ? "NO_AUDIO_DATA" : "DECODE_FAILED";
      failCapture(code, err && err.message ? err.message : "audio processing failed");
      return;
    }
    // A cancel() landing in the decode window (arrayBuffer/decodeAudioData
    // still pending) already set `canceled`, fired CANCELED and cleaned up;
    // the late decode result must not open a socket and upload the clip the
    // user canceled.
    if (canceled) return;
    try {
      client = createVoiceWsClient({
        WebSocket: WSImpl,
        url,
        token,
        recordingId: makeRecordingId(),
        wav,
        onStateChange: (s) => {
          if (canceled) return;
          if (s === "transcribing") transition("UPLOAD_STARTED");
          // s === "idle" only follows cancel(); CANCELED already fired.
        },
        onResult: (result) => {
          if (canceled) return;
          const next = transition("FINAL", result); // transcribing -> ready
          if (next.payload) onResult(result);
          cleanup();
        },
        onError: (err) => {
          if (canceled) return;
          const next = transition("ERROR", err); // transcribing -> error
          if (next.payload) onError(err);
          cleanup();
        },
      });
    } catch (err) {
      // programming-error class: missing url/token/WebSocket deps
      failCapture(
        "TRANSPORT_UNAVAILABLE",
        err && err.message ? err.message : "voice transport unavailable",
      );
    }
  }

  function stop() {
    if (canceled || cleaned) return;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        failCapture("RECORD_STOP_FAILED", "recorder stop failed");
      }
    }
  }

  function cancel() {
    if (canceled) return;
    canceled = true;
    transition("CANCELED"); // any active state -> idle (no-op from idle)
    if (client) {
      client.cancel(); // recording.cancel (if known server-side) + close
      client = null;
    }
    cleanup();
  }

  const handle = { stop, cancel, getState: () => currentState };
  void begin();
  return handle;
}

module.exports.__browser = { startBrowserCapture, SERVER_DEFAULT_LIMITS, MIME_CANDIDATES };
