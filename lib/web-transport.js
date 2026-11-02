// Web voice transport (T1 sidecar): authenticated, loopback-only WebSocket
// server implementing the recording -> transcription state machine from
// openspec/changes/add-web-voice-input. Runs in its own process; task 2.2
// (plugin/GUI) spawns it and hands the browser a one-time token.
//
// Protocol (JSON text frames + binary audio frames):
//   client: recording.start { id, codec, sampleRate, sizeBytes? }
//           <binary chunks, routed to the newest open recording>
//           recording.finish { id } / recording.cancel { id }
//   server: recording.ready { id } | recording.canceled { id }
//           transcription.started { recordingId, sessionId }
//           transcription.final { recordingId, sessionId, rawText,
//                                 normalizedText, detectedLanguage,
//                                 timings { uploadMs, transcribeMs, normalizeMs } }
//           transcription.error { code, safeMessage, recordingId? }
//
// Close codes: 4001 auth (AUTH_TOKEN_MISSING / AUTH_TOKEN_INVALID),
// 4002 ORIGIN_DENIED, 4003 CLIP_TOO_LARGE, 4004 INACTIVITY, 1011 internal.
// The upgrade is completed before auth/origin close-out so clients observe
// the stable application close codes (sidecar is loopback-only, so the
// briefly open unauthenticated socket is an acceptable trade).
//
// transcription.error codes (stable): INVALID_START, RATE_OR_LIMIT,
// TOO_LARGE, UNKNOWN_ID, PROTOCOL, RESULT_TIMEOUT, STT_ERROR, NO_SPEECH plus
// the audio-validate reasons (NOT_RIFF, NOT_WAVE, NOT_PCM, NOT_S16, NOT_MONO,
// UNSUPPORTED_SAMPLE_RATE, TOO_SHORT, TOO_LONG, EMPTY_DATA, SILENT,
// LENGTH_MISMATCH); TOO_SHORT from the parse stage is relabeled AUDIO_TRUNCATED
// (carried over from task 4b: structural vs duration stage disambiguation).

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { parseWav, validateAudioBuffer } from "./audio-validate.js";
import { normalizeText, transcribeWavFile } from "./stt.js";

const CLOSE_AUTH = 4001;
const CLOSE_ORIGIN = 4002;
const CLOSE_TOO_LARGE = 4003;
const CLOSE_INACTIVITY = 4004;
const CLOSE_INTERNAL = 1011;

const MAX_ID_LENGTH = 100;

const DEFAULT_LIMITS = {
  maxClipBytes: 20 * 1024 * 1024,
  minDurationMs: 300,
  maxDurationMs: 120000,
  resultTimeoutMs: 60000,
  inactivityMs: 15 * 60 * 1000,
};

// local origins of the browser used with `opencode serve`; override per spawn
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:4096", "http://127.0.0.1:4096"];
const DEFAULT_SAMPLE_RATES = [16000];

// constant-time token compare: fixed-size digests so length never leaks
function tokenMatches(expected, given) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof given !== "string" || given.length === 0) return false;
  const a = crypto.createHash("sha256").update(given, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// The normalizer only needs a `complete({ system, prompt })` function (stt.js
// normalizeText contract). Accept either a bare function (the shape stt-web
// tests stub) or the object llm-client createClient() returns.
function resolveComplete(client) {
  if (typeof client === "function") return client;
  if (client && typeof client.complete === "function") return client.complete.bind(client);
  return null;
}

function safeFileId(recId) {
  return recId.replace(/[^A-Za-z0-9_-]/g, "_");
}

// race a promise against a deadline; resolves (never rejects) with
// { timedOut, value } and invokes onTimeout the moment the deadline wins.
function withDeadline(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      onTimeout?.();
      resolve({ timedOut: true, value: null });
    }, ms);
    timer.unref?.();
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({
          timedOut: false,
          value: { error: err && err.message ? err.message : "unexpected transport error" },
        });
      },
    );
  });
}

export function createVoiceTransport(config, callbacks = {}) {
  const cfg = config || {};
  const port = Number.isInteger(cfg.port) && cfg.port >= 0 ? cfg.port : 0;
  const token = typeof cfg.token === "string" ? cfg.token : null;
  const allowedOrigins = new Set(
    (Array.isArray(cfg.allowedOrigins) && cfg.allowedOrigins.length > 0
      ? cfg.allowedOrigins
      : DEFAULT_ALLOWED_ORIGINS
    ).map((o) => String(o).toLowerCase()),
  );
  const limits = { ...DEFAULT_LIMITS, ...cfg.limits };
  // per-connection in-flight bytes across all open recordings (defense against
  // many concurrent partial clips); defaults to twice one clip
  const maxConnectionBytes =
    Number.isFinite(limits.maxConnectionBytes) && limits.maxConnectionBytes > 0
      ? limits.maxConnectionBytes
      : limits.maxClipBytes * 2;
  const kv = cfg.kv || null;
  const logger = cfg.logger || null;
  const opts = cfg.opts || {};
  const transcribe = typeof opts.transcribe === "function" ? opts.transcribe : transcribeWavFile;
  const allowedRates =
    Array.isArray(opts.allowedSampleRates) && opts.allowedSampleRates.length > 0
      ? opts.allowedSampleRates
      : DEFAULT_SAMPLE_RATES;
  const complete = resolveComplete(cfg.client);
  const getSessionId =
    typeof callbacks?.getSessionId === "function" ? callbacks.getSessionId : () => null;

  // model override is deliberately not honored here: transcribeWavFile falls
  // back to the kv default (stt.model); never fail silently (carried from 2.1)
  if (opts.model) {
    logger?.log(
      "Voice",
      "opts.model ignored by web transport; kv stt.model default applies",
      "warn",
    );
  }
  if (!token) {
    logger?.log("Voice", "no token configured; refusing all connections", "warn");
  }

  const tmpDir = opts.tmpDir || os.tmpdir();
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch (err) {
    logger?.log("Voice", `failed to ensure tmpDir ${tmpDir}: ${err.message}`, "warn");
  }

  const server = http.createServer((req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain" });
    res.end("upgrade required");
  });
  server.on("error", (err) => {
    logger?.log("Voice", `transport server error: ${err.message}`, "error");
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxClipBytes > 0 ? limits.maxClipBytes : 1,
  });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws, req) => {
    const verdict = checkUpgrade(req);
    if (!verdict.ok) {
      logger?.log("Voice", `connection rejected: ${verdict.reason}`, "debug");
      // complete the handshake, then close with the stable application code
      ws.close(verdict.code, verdict.reason);
      return;
    }
    wireConnection(ws);
  });

  function checkUpgrade(req) {
    let given;
    try {
      given = new URL(req.url || "/", "http://127.0.0.1").searchParams.get("token");
    } catch {
      given = null;
    }
    const authHeader = req.headers.authorization;
    if (given === null && typeof authHeader === "string" && /^bearer\s+/i.test(authHeader)) {
      given = authHeader.replace(/^bearer\s+/i, "").trim();
    }
    if (!tokenMatches(token, given)) {
      return { code: CLOSE_AUTH, reason: given ? "AUTH_TOKEN_INVALID" : "AUTH_TOKEN_MISSING" };
    }
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== null && String(origin).length > 0) {
      if (!allowedOrigins.has(String(origin).toLowerCase())) {
        return { code: CLOSE_ORIGIN, reason: "ORIGIN_DENIED" };
      }
    } else if (opts.allowNoOrigin !== true) {
      // absent origin = non-browser tool; denied unless explicitly allowed
      return { code: CLOSE_ORIGIN, reason: "ORIGIN_DENIED" };
    }
    return { ok: true };
  }

  function wireConnection(ws) {
    const connId = crypto.randomBytes(4).toString("hex");
    const recs = new Map(); // recId -> rec; insertion order = start order
    const usedIds = new Set(); // ids are one-shot per connection
    let connBytes = 0; // bytes accumulated across all open recordings
    let connOpen = true;

    const send = (obj) => {
      if (connOpen && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    };
    // echo ids bounded: never reflect oversize client input verbatim
    const sendError = (code, safeMessage, recId = null) => {
      if (typeof recId === "string" && recId.length > MAX_ID_LENGTH) {
        logger?.log("Voice", `oversize recording id (${connId}): ${JSON.stringify(recId)}`, "warn");
        recId = recId.slice(0, MAX_ID_LENGTH);
      }
      send(
        recId
          ? { type: "transcription.error", code, safeMessage, recordingId: recId }
          : { type: "transcription.error", code, safeMessage },
      );
    };
    // remove a recording, release its in-flight bytes, best-effort unlink
    const release = (rec, { unlinkWav = false } = {}) => {
      if (recs.delete(rec.id)) connBytes -= rec.bytes;
      if (unlinkWav && rec.wavPath) {
        try {
          fs.unlinkSync(rec.wavPath);
        } catch {}
      }
    };

    // inactivity watchdog: silence beyond limits.inactivityMs closes the socket
    let idleTimer = null;
    const bumpActivity = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        logger?.log("Voice", `connection ${connId} closed: inactivity`, "debug");
        ws.close(CLOSE_INACTIVITY, "INACTIVITY");
      }, limits.inactivityMs);
      idleTimer.unref?.();
    };

    const handleStart = (msg) => {
      const id = msg.id;
      const hasId = typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH;
      if (!hasId) return sendError("INVALID_START", "invalid recording id");
      if (usedIds.has(id))
        return sendError("INVALID_START", "recording id already used on this connection", id);
      if (msg.codec !== "audio/wav")
        return sendError("INVALID_START", "unsupported codec, want audio/wav", id);
      if (typeof msg.sampleRate !== "number" || !allowedRates.includes(msg.sampleRate)) {
        return sendError("RATE_OR_LIMIT", "unsupported sample rate", id);
      }
      if (limits.maxClipBytes <= 0)
        return sendError("TOO_LARGE", "clip size limit misconfigured", id);
      // optional client-declared total size for a preflight oversize reject
      if (typeof msg.sizeBytes === "number" && msg.sizeBytes > limits.maxClipBytes) {
        return sendError("TOO_LARGE", "declared clip size exceeds limit", id);
      }
      const rec = {
        id,
        state: "recording", // recording -> processing; canceled is a flag
        canceled: false,
        chunks: [],
        bytes: 0,
        firstByteAt: null,
        wavPath: null,
      };
      usedIds.add(id);
      recs.set(id, rec);
      send({ type: "recording.ready", id });
    };

    const handleCancel = (msg) => {
      const id = msg.id;
      const rec = typeof id === "string" ? recs.get(id) : undefined;
      if (!rec) {
        return sendError(
          "UNKNOWN_ID",
          "unknown or stale recording id",
          typeof id === "string" ? id : null,
        );
      }
      rec.canceled = true;
      if (rec.state === "recording") release(rec); // never hit disk; file-less
      // a processing rec is released by its pipeline once it notices `canceled`
      send({
        type: "recording.canceled",
        id: typeof id === "string" ? id.slice(0, MAX_ID_LENGTH) : id,
      });
    };

    const handleFinish = (msg) => {
      const id = msg.id;
      const rec = typeof id === "string" ? recs.get(id) : undefined;
      if (!rec || rec.state !== "recording") {
        return sendError(
          "UNKNOWN_ID",
          "unknown or stale recording id",
          typeof id === "string" ? id : null,
        );
      }
      rec.state = "processing";
      // pipelines run independently and overlap (concurrent recordings)
      void runPipeline(rec);
    };

    const onBinary = (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      // route to the newest open recording (Map keeps start order)
      let target = null;
      for (const rec of recs.values()) {
        if (rec.state === "recording") target = rec;
      }
      if (!target) {
        return sendError("PROTOCOL", "binary data without an active recording", null);
      }
      if (target.bytes + chunk.length > limits.maxClipBytes) {
        sendError("TOO_LARGE", "clip exceeds size limit", target.id);
        release(target);
        ws.close(CLOSE_TOO_LARGE, "CLIP_TOO_LARGE");
        return;
      }
      if (connBytes + chunk.length > maxConnectionBytes) {
        sendError("TOO_LARGE", "connection exceeded in-flight size limit", target.id);
        release(target);
        ws.close(CLOSE_TOO_LARGE, "CLIP_TOO_LARGE");
        return;
      }
      target.chunks.push(chunk);
      target.bytes += chunk.length;
      if (target.firstByteAt === null) target.firstByteAt = Date.now();
      connBytes += chunk.length;
    };

    const runPipeline = async (rec) => {
      const uploadMs = rec.firstByteAt === null ? 0 : Date.now() - rec.firstByteAt;
      const buffer = Buffer.concat(rec.chunks);
      rec.chunks = [];
      let deadlineHit = false;
      const detectedLanguage = resolveLanguage();

      const outcome = await withDeadline(
        (async () => {
          // structural parse first: TOO_SHORT at the parse stage means a
          // truncated clip, relabel it (carried over from task 4b)
          const parsed = parseWav(buffer);
          if (!parsed.ok) {
            const code = parsed.reason === "TOO_SHORT" ? "AUDIO_TRUNCATED" : parsed.reason;
            return { kind: "error", code, safeMessage: parsed.detail || "invalid audio" };
          }
          const validated = validateAudioBuffer(buffer, {
            maxBytes: limits.maxClipBytes,
            minDurationMs: limits.minDurationMs,
            maxDurationMs: limits.maxDurationMs,
            allowedSampleRates: allowedRates,
          });
          if (!validated.ok) {
            return {
              kind: "error",
              code: validated.reason,
              safeMessage: validated.detail || "invalid audio",
            };
          }

          const wavPath = path.join(tmpDir, `voice-${connId}-${safeFileId(rec.id)}.wav`);
          rec.wavPath = wavPath;
          try {
            try {
              // exclusive create with restrictive perms: never clobber a file
              fs.writeFileSync(wavPath, buffer, { flag: "wx", mode: 0o600 });
            } catch (err) {
              if (err && err.code !== "EEXIST") throw err;
              // expected name taken -> one retry under a random suffix
              const altPath = path.join(
                tmpDir,
                `voice-${connId}-${safeFileId(rec.id)}-${crypto.randomBytes(3).toString("hex")}.wav`,
              );
              rec.wavPath = altPath;
              fs.writeFileSync(altPath, buffer, { flag: "wx", mode: 0o600 });
            }
          } catch (err) {
            logger?.log("Voice", `failed to write temp clip: ${err.message}`, "error");
            return {
              kind: "error",
              code: "STT_ERROR",
              safeMessage: "failed to write temp clip",
            };
          }
          send({ type: "transcription.started", recordingId: rec.id, sessionId: getSessionId() });

          const transcribeStart = Date.now();
          const result = await transcribe(
            kv,
            { wavPath, timeoutMs: limits.resultTimeoutMs, language: opts.language },
            logger,
          ).catch((err) => ({ error: err.message }));
          const transcribeMs = Date.now() - transcribeStart;
          // checkpoint: late results of canceled / timed-out recs are dropped
          if (rec.canceled) return { kind: "canceled" };
          if (deadlineHit) return { kind: "timeout" };
          if (result && result.error) {
            logger?.log("Voice", `transcription failed: ${result.error}`, "error");
            return { kind: "error", code: "STT_ERROR", safeMessage: "transcription failed" };
          }
          const rawText = result && typeof result.text === "string" ? result.text : "";
          if (rawText.length === 0) {
            return { kind: "error", code: "NO_SPEECH", safeMessage: "no speech detected" };
          }

          // LLM normalization; on failure fall back to raw delivery (TUI semantics)
          let normalizedText = null;
          let normalizeMs = 0;
          if (complete) {
            const normalizeStart = Date.now();
            try {
              const norm = await normalizeText(
                complete,
                rawText,
                opts.sessionTitle ?? "",
                opts.systemPrompt ?? "",
                logger,
              );
              if (norm && typeof norm.text === "string" && norm.text.length > 0) {
                normalizedText = norm.text;
              }
            } catch (err) {
              logger?.log("Voice", `normalization failed, delivering raw: ${err.message}`, "warn");
            }
            normalizeMs = Date.now() - normalizeStart;
          } else {
            logger?.log("Voice", "no normalizer configured, delivering raw transcript", "warn");
          }
          if (deadlineHit) return { kind: "timeout" };
          if (rec.canceled) return { kind: "canceled" };
          return {
            kind: "final",
            rawText,
            normalizedText,
            timings: {
              uploadMs: Math.max(0, uploadMs),
              transcribeMs: Math.max(0, transcribeMs),
              normalizeMs: Math.max(0, normalizeMs),
            },
          };
        })(),
        limits.resultTimeoutMs,
        () => {
          deadlineHit = true;
        },
      );

      const reply = outcome.timedOut ? { kind: "timeout" } : outcome.value;
      switch (reply.kind) {
        case "final":
          send({
            type: "transcription.final",
            recordingId: rec.id,
            sessionId: getSessionId(),
            rawText: reply.rawText,
            normalizedText: reply.normalizedText,
            detectedLanguage,
            timings: reply.timings,
          });
          release(rec, { unlinkWav: true });
          return;
        case "timeout":
          sendError(
            "RESULT_TIMEOUT",
            `transcription timed out after ${limits.resultTimeoutMs}ms`,
            rec.id,
          );
          release(rec, { unlinkWav: true });
          return;
        case "canceled":
          // pipeline released resources; the client already got canceled
          release(rec, { unlinkWav: true });
          return;
        default:
          sendError(reply.code, reply.safeMessage, rec.id);
          release(rec, { unlinkWav: true });
      }
    };

    function resolveLanguage() {
      if (opts.language) return opts.language;
      try {
        const fromKv = kv && typeof kv.get === "function" ? kv.get("stt.language") : null;
        if (typeof fromKv === "string" && fromKv.length > 0) return fromKv;
      } catch {}
      return "auto";
    }

    const onText = (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch {
        return sendError("PROTOCOL", "malformed json message", null);
      }
      if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
        return sendError("PROTOCOL", "malformed json message", null);
      }
      if (msg.type === "recording.start") return handleStart(msg);
      if (msg.type === "recording.finish") return handleFinish(msg);
      if (msg.type === "recording.cancel") return handleCancel(msg);
      return sendError(
        "PROTOCOL",
        "unknown message type",
        typeof msg.id === "string" ? msg.id : null,
      );
    };

    ws.on("message", (data, isBinary) => {
      if (!connOpen) return;
      bumpActivity();
      try {
        if (isBinary) onBinary(data);
        else onText(data);
      } catch (err) {
        logger?.log(
          "Voice",
          `connection ${connId} handler error, closing: ${err.message}`,
          "error",
        );
        ws.close(CLOSE_INTERNAL, "INTERNAL");
      }
    });
    ws.on("error", (err) => {
      logger?.log("Voice", `connection ${connId} error: ${err.message}`, "debug");
    });
    ws.on("close", () => {
      connOpen = false;
      if (idleTimer) clearTimeout(idleTimer);
      for (const rec of recs.values()) release(rec, { unlinkWav: true });
      logger?.log("Voice", `connection ${connId} closed`, "debug");
    });

    bumpActivity();
  }

  let closed = null;
  const close = () => {
    if (!closed) {
      closed = new Promise((resolve, reject) => {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {}
        }
        // noServer mode: wss.close() only closes the ws layer; the http server
        // (and its listening socket) has to be closed explicitly
        wss.close(() => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      });
    }
    return closed;
  };

  const url = () => {
    const addr = server.address();
    return addr ? `ws://127.0.0.1:${addr.port}` : null;
  };

  server.listen(port, "127.0.0.1");
  logger?.log(
    "Voice",
    `voice transport listening on 127.0.0.1 (origins=${allowedOrigins.size}, maxClipBytes=${limits.maxClipBytes})`,
    "debug",
  );

  return { server, close, url };
}
