// Tests for the shared transcription interface used by the future web adapter:
// transcribeWavFile (injected wav path, API + local backends) and normalizeText.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { normalizeText, registerSTT, transcribeWavFile } from "../lib/stt.js";

const kv = { get: () => null, set: () => {} };
const api = {
  ui: {
    toast() {},
    DialogSelect() {},
    dialog: { replace() {}, clear() {} },
  },
  session: {},
};
const logger = null;
const complete = async () => ({ text: "" });

const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stt-web-test-"));

registerSTT(
  api,
  kv,
  complete,
  null,
  { sttEndpoint: "https://openrouter.ai/api/v1", sttModel: "test/stt-model", tmpDir: testTmpDir },
  logger,
);

after(() => {
  fs.rmSync(testTmpDir, { recursive: true, force: true });
});

// Keep the environment key for api creds unset for this run.
delete process.env.OPENCODE_VOICE_STT_TEST_KEY;

test("transcribeWavFile rejects a nonexistent wav path", async () => {
  const wavPath = path.join(testTmpDir, "missing.wav");
  const result = await transcribeWavFile(kv, { wavPath, timeoutMs: 60000 }, logger);
  assert.ok(result.error && result.error.includes("No recording file"));
});

test("transcribeWavFile rejects a header-only 44-byte wav", async () => {
  const wavPath = path.join(testTmpDir, "header-only.wav");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.write("WAVE", 8);
  fs.writeFileSync(wavPath, header);
  const result = await transcribeWavFile(kv, { wavPath, timeoutMs: 60000 }, logger);
  assert.ok(result.error && result.error.includes("Recording is empty"));
});

test("transcribeWavFile routes openrouter config through the JSON request builder", async (t) => {
  const wavPath = path.join(testTmpDir, "clip.wav");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.write("WAVE", 8);
  fs.writeFileSync(wavPath, Buffer.concat([header, Buffer.alloc(100)]));

  let fetchUrl = null;
  let fetchInit = null;
  t.mock.method(global, "fetch", async (url, init) => {
    fetchUrl = String(url);
    fetchInit = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: "  Hallo json!  " }),
    };
  });

  const result = await transcribeWavFile(kv, { wavPath, timeoutMs: 60000 }, logger);

  assert.deepEqual(result, { text: "Hallo json!" });
  assert.ok(fetchUrl.endsWith("/audio/transcriptions"));
  assert.equal(fetchInit.method, "POST");
  assert.equal(fetchInit.headers["Content-Type"], "application/json");

  const body = JSON.parse(fetchInit.body);
  assert.deepEqual(body, {
    model: "test/stt-model",
    input_audio: {
      data: fs.readFileSync(wavPath).toString("base64"),
      format: "wav",
    },
  });
});

test("normalizeText wraps the transcription normalizer and context", async () => {
  const calls = [];
  const client = async (payload) => {
    calls.push(payload);
    return { text: "normalized" };
  };
  const result = await normalizeText(client, "raw speech", "Refactor stt", "SYS", logger);
  assert.deepEqual(result, { text: "normalized" });
  assert.deepEqual(calls, [
    {
      system: 'SYS The user is currently working on: "Refactor stt"',
      prompt: "Clean up this speech-to-text transcription:\n\nraw speech",
    },
  ]);
});
