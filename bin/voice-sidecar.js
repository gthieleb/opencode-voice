// voice sidecar launcher (R0.2 container stack): wraps lib/web-transport.js
// for the podman e2e stack. env:
//   VOICE_PORT       ws port (default 9100)
//   VOICE_TOKEN      required; exit 1 when missing
//   ALLOWED_ORIGINS  comma-separated; container default covers the stack
//   VOICE_TMPDIR     temp wav dir (default /tmp)
//   VOICE_STT_LANGUAGE  optional kv shim value for stt.language
//   FAKE_TRANSCRIBE  =1 swaps the real transcribeWavFile (whisper-cli + model
//                    on disk) for a stub answering a fixed German mixed-
//                    language string, so the container smoke runs without any
//                    model credentials. real mode stays wired and fails with
//                    STT_ERROR if whisper-cli/the model is absent.
// the normalizer is a no-LLM passthrough client (same injection shape as
// test/web-transport.test.js), so no provider credentials are ever needed.

import { createVoiceTransport } from "../lib/web-transport.js";

const portRaw = Number.parseInt(process.env.VOICE_PORT ?? "", 10);
const port = Number.isInteger(portRaw) && portRaw >= 0 ? portRaw : 9100;
const token = process.env.VOICE_TOKEN;
if (!token) {
  console.error("voice-sidecar: VOICE_TOKEN is required");
  process.exit(1);
}

const DEFAULT_ORIGINS = [
  "http://localhost:4096",
  "http://127.0.0.1:4096",
  "http://opencode-web:4096",
];
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS === undefined
    ? DEFAULT_ORIGINS
    : process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
).filter(Boolean);
// explicit empty ALLOWED_ORIGINS falls through to the transport's DEFAULT_ALLOWED_ORIGINS (localhost/127.0.0.1:4096); only clients without an Origin header are denied (allowNoOrigin=false)
const effectiveOrigins = allowedOrigins.length > 0 ? allowedOrigins : [];

const tmpDir = process.env.VOICE_TMPDIR || "/tmp";

// minimal kv shim backed by env; only the keys the stt pipeline may read
const kv = {
  get: (key) => (key === "stt.language" ? process.env.VOICE_STT_LANGUAGE || null : null),
};

// fixed German mixed-language transcript for the fake pipeline (coding
// vocabulary stays latin, per design.md normalization rules)
const FAKE_TEXT = "Okay, ich habe das package.json geprüft und pushe den Branch jetzt auf GitHub.";
const fakeTranscribe = async () => ({ text: FAKE_TEXT });

// passthrough normalizer: normalizeText sends a fixed header, the raw
// transcript follows the first blank line; echo it back unchanged
const client = {
  complete: async ({ prompt }) => {
    const sep = prompt.indexOf("\n\n");
    return { text: sep >= 0 ? prompt.slice(sep + 2) : prompt };
  },
};

const transport = createVoiceTransport({
  port,
  token,
  allowedOrigins: effectiveOrigins,
  kv,
  client,
  logger: null,
  opts: {
    tmpDir,
    ...(process.env.FAKE_TRANSCRIBE === "1" ? { transcribe: fakeTranscribe } : {}),
  },
});

await new Promise((resolve, reject) => {
  transport.server.once("listening", resolve);
  transport.server.once("error", reject);
});
const bound = transport.server.address();
console.log(`voice sidecar listening on 127.0.0.1:${bound.port}`);

// graceful shutdown: terminate clients and release the socket on sigterm
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`voice sidecar shutting down (${signal})`);
  await transport.close().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("sigterm"));
process.on("SIGINT", () => void shutdown("sigint"));
