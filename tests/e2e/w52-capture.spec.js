// W5.2 (task 2.3): fake-microphone proof for the browser capture path in the
// pinned headless Chromium.
//
// What this proves (what the Node contract tests cannot):
//   (1) the FULL bundle source evaluates in a real browser under the host's
//       CJS evaluator contract — Function("require","module","exports", code)
//       with the three real require-map ids inert-stubbed (the W5.2 sections
//       use none of them);
//   (2) the __browser glue drives the complete path in-browser:
//       getUserMedia (Chromium fake device) -> MediaRecorder (webm/opus) ->
//       decodeAudioData -> downmixToMono -> resampleLinear(…, 16000) ->
//       floatToPcm16 -> encodePcm16Wav -> createVoiceWsClient
//       (recording.start -> one binary frame -> recording.finish) against a
//       REAL in-process lib/web-transport.js sidecar (STT/normalization
//       stubbed the way test/web-transport.test.js does);
//   (3) the stop path: state sequence exactly
//       permission -> recording -> transcribing -> ready
//       with the delivered result being the stubbed raw + normalized text
//       and finite timings;
//   (4) the cancel path: permission -> recording -> idle, no result, no
//       error, nothing transcribed — and a SECOND capture afterwards still
//       reaches ready (resources released, no orphan state);
//   (5) the origin restriction with a REAL browser Origin header: the
//       transport allows only the page's own origin — the WS upgrade from
//       the page carries it and is accepted (no allowNoOrigin).
//
// Run (host contract, same as the W5.1 spec):
//
//   LD_LIBRARY_PATH=/tmp/opencode/pw-libs/extracted/usr/lib/x86_64-linux-gnu \
//   FONTCONFIG_FILE=/tmp/opencode/pw-libs/fontconfig/fonts.conf \
//     npx playwright test tests/e2e/w52-capture.spec.js
//
// Fixture: tests/e2e/fixtures/german-tone-fixture.wav (2 s of 440/620 Hz
// tones, mono 16 kHz) injected via the --use-fake-* flags in
// playwright.config.js (R0 POC pattern; FIXTURE_WAV overrides).

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { createVoiceTransport } from "../../lib/web-transport.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLE_PATH = path.join(REPO_ROOT, "gui", "gui-experimental.cjs");
const TOKEN = "w52-fake-mic-token";
const RECORD_MS = 1800;
const STUB_RAW = "fixture tone raw";
const STUB_NORMALIZED = "fixture tone normalized";

// ---------------------------------------------------------------------------
// Headless-Chromium OS-library contract (same as tests/e2e/w51-spike.spec.js;
// volatile /tmp/opencode/pw-libs — the W5.1 spec header carries the full
// re-materialize recipe).
// ---------------------------------------------------------------------------

const PW_LIBS = "/tmp/opencode/pw-libs";
const PW_LIB_DIR = `${PW_LIBS}/extracted/usr/lib/x86_64-linux-gnu`;
const FONTS_CONF_CANONICAL = `${PW_LIBS}/fontconfig/fonts.conf`;
const FONTS_CONF_XML = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${PW_LIBS}/extracted/usr/share/fonts</dir>
  <cachedir>${PW_LIBS}/extracted/var/cache/fontconfig</cachedir>
  <alias>
    <family>sans-serif</family>
    <prefer><family>DejaVu Sans</family></prefer>
  </alias>
  <alias>
    <family>serif</family>
    <prefer><family>DejaVu Serif</family></prefer>
  </alias>
  <alias>
    <family>monospace</family>
    <prefer><family>DejaVu Sans Mono</family></prefer>
  </alias>
</fontconfig>
`;

function assertBrowserContract() {
  // container run (E2E_HOST=1): the pinned image ships its own os libs, so the host /tmp/opencode/pw-libs contract can never hold there
  if (process.env.E2E_HOST === "1") return;
  if (!fs.existsSync(`${PW_LIB_DIR}/libnspr4.so`)) {
    throw new Error(
      "headless-chromium OS libraries missing (volatile /tmp/opencode/pw-libs was cleared). Re-materialize per the recipe in tests/e2e/w51-spike.spec.js header, then re-run.",
    );
  }
  if (!(process.env.LD_LIBRARY_PATH ?? "").includes(PW_LIB_DIR)) {
    throw new Error(
      `LD_LIBRARY_PATH must include ${PW_LIB_DIR} — see the run contract in the spec header.`,
    );
  }
  if (process.env.FONTCONFIG_FILE && process.env.FONTCONFIG_FILE !== FONTS_CONF_CANONICAL) {
    if (!fs.existsSync(process.env.FONTCONFIG_FILE)) {
      throw new Error(`FONTCONFIG_FILE=${process.env.FONTCONFIG_FILE} does not exist.`);
    }
  } else {
    // self-heal: write the canonical fonts.conf and export it before the
    // browser launches (the child inherits process.env)
    if (!fs.existsSync(FONTS_CONF_CANONICAL)) {
      fs.mkdirSync(path.dirname(FONTS_CONF_CANONICAL), { recursive: true });
      fs.mkdirSync(`${PW_LIBS}/extracted/var/cache/fontconfig`, { recursive: true });
      fs.writeFileSync(FONTS_CONF_CANONICAL, FONTS_CONF_XML);
    }
    process.env.FONTCONFIG_FILE = FONTS_CONF_CANONICAL;
  }
}

// ---------------------------------------------------------------------------
// Test page: evaluates the bundle ONCE the host way, then lets the node side
// start/stop/capture drives each capture. Every callback lands in
// window.__events; window.__terminal is set by result/error/denied.
// ---------------------------------------------------------------------------

const PAGE_HTML = `<!doctype html><html><body><script>
"use strict";
window.__events = [];
window.__handle = null;
window.__terminal = null;
window.__bundleReady = false;
window.__pageError = null;
const record = (type, value) => window.__events.push({ type, value });
let exp = null;

async function load() {
  const code = await (await fetch("/bundle.cjs")).text();
  // The host's evaluator contract (W5.1 report): CJS over the fixed require
  // map. The three real ids get inert stubs — the W5.2 sections use none of
  // them; the W5.1 scaffold top level only calls Ipc.define / Plugin.define.
  const req = (id) => {
    if (id === "@opencode/plugin/gui") {
      return { Plugin: { define: (d) => d }, Ipc: { define: (d) => d }, ComposerPill: {} };
    }
    if (id === "solid-js") return { createComponent: (c, p) => c(p) };
    if (id === "effect") {
      return {
        Schema: {
          Struct: (f) => ({ kind: "struct", fields: f }),
          String: { kind: "string" },
          Boolean: { kind: "boolean" },
        },
      };
    }
    throw new Error("unexpected require: " + id);
  };
  const moduleObj = { exports: {} };
  new Function("require", "module", "exports", code)(req, moduleObj, moduleObj.exports);
  exp = moduleObj.exports;
  window.__bundleExports = exp;
  window.__bundleReady = true;
}

window.__startCapture = async () => {
  const cfg = await (await fetch("/config")).json();
  window.__events.length = 0;
  window.__terminal = null;
  window.__handle = exp.__browser.startBrowserCapture({
    WebSocket,
    url: cfg.url,
    token: cfg.token,
    targetSampleRate: 16000,
    limits: exp.__browser.SERVER_DEFAULT_LIMITS,
    onStateChange: (s) => {
      record("state", s);
      if (s === "denied") window.__terminal = { state: s };
    },
    onResult: (r) => {
      record("result", r);
      window.__terminal = r;
    },
    onError: (e) => {
      record("error", e);
      window.__terminal = e;
    },
  });
};

load().catch((e) => {
  window.__pageError = String(e && e.message ? e.message : e);
  record("pageError", window.__pageError);
});
</script></body></html>`;

async function envWithServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "w52-fake-mic-"));
  const transcribeCalls = [];
  let server = null;
  let t = null;
  server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PAGE_HTML);
    } else if (req.url === "/bundle.cjs") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(fs.readFileSync(BUNDLE_PATH));
    } else if (req.url === "/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: t.url(), token: TOKEN }));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pageOrigin = `http://127.0.0.1:${server.address().port}`;

  // The frozen sidecar, in-process: allows ONLY the page's real origin, so
  // the browser's own Origin header is what gets accepted (no allowNoOrigin).
  t = createVoiceTransport({
    port: 0,
    token: TOKEN,
    allowedOrigins: [pageOrigin],
    kv: { get: () => null, set() {} },
    client: async () => ({ text: STUB_NORMALIZED }),
    logger: null,
    opts: {
      tmpDir,
      transcribe: async (_kv, o) => {
        transcribeCalls.push({ ...o, sawFile: fs.existsSync(o.wavPath) });
        return { text: STUB_RAW };
      },
    },
  });
  if (!t.server.listening) await new Promise((r) => t.server.once("listening", r));
  return {
    server,
    t,
    tmpDir,
    transcribeCalls,
    pageOrigin,
  };
}

async function loadBundlePage(page, origin) {
  await page.goto(`${origin}/`);
  await expect
    .poll(() => page.evaluate(() => window.__bundleReady === true && !window.__pageError), {
      timeout: 15000,
      message: "bundle evaluation in Chromium",
    })
    .toBe(true);
  const pageError = await page.evaluate(() => window.__pageError);
  expect(pageError).toBeNull();
}

async function waitForState(page, state, timeoutMs = 15000) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (s) => window.__events.some((e) => e.type === "state" && e.value === s),
          state,
        ),
      { timeout: timeoutMs, message: `capture state "${state}"` },
    )
    .toBe(true);
}

async function waitForTerminal(page, timeoutMs = 30000) {
  await expect
    .poll(() => page.evaluate(() => window.__terminal !== null), {
      timeout: timeoutMs,
      message: "terminal result/error",
    })
    .toBe(true);
}

async function readStates(page) {
  return page.evaluate(() => window.__events.filter((e) => e.type === "state").map((e) => e.value));
}

async function readErrors(page) {
  return page.evaluate(() => window.__events.filter((e) => e.type === "error"));
}

test("fake mic: stop path — full capture -> real transport -> ready", async ({ page }) => {
  assertBrowserContract();
  const env = await envWithServer();
  try {
    await loadBundlePage(page, env.pageOrigin);
    await page.evaluate(() => window.__startCapture());
    await waitForState(page, "recording");
    // record a slice of the looping fixture tone, then stop normally
    await new Promise((resolve) => setTimeout(resolve, RECORD_MS));
    await page.evaluate(() => window.__handle.stop());
    await waitForTerminal(page);

    const terminal = await page.evaluate(() => window.__terminal);
    expect(await readStates(page)).toEqual(["permission", "recording", "transcribing", "ready"]);
    expect(await readErrors(page)).toEqual([]);
    expect(terminal).toMatchObject({
      rawText: STUB_RAW,
      normalizedText: STUB_NORMALIZED,
      detectedLanguage: "auto",
    });
    for (const k of ["uploadMs", "transcribeMs", "normalizeMs"]) {
      expect(Number.isFinite(terminal.timings[k]) && terminal.timings[k] >= 0, `timings.${k}`).toBe(
        true,
      );
    }
    // the real pipeline ran on the re-encoded 16 kHz mono WAV (server temp
    // file naming: voice-<connId>-<safeFileId(recordingId)>.wav)
    expect(env.transcribeCalls).toHaveLength(1);
    expect(env.transcribeCalls[0].sawFile).toBe(true);
    expect(path.basename(env.transcribeCalls[0].wavPath)).toMatch(
      /^voice-[0-9a-f]{8}-web-[0-9a-f-]{36}\.wav$/,
    );
  } finally {
    await env.t.close().catch(() => {});
    env.server.close();
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});

test("fake mic: cancel path — idle, nothing transcribed, re-capture works", async ({ page }) => {
  assertBrowserContract();
  const env = await envWithServer();
  try {
    await loadBundlePage(page, env.pageOrigin);
    // 1) cancel while recording (before the recorder stops, so no WS client
    //    was ever created — nothing reaches the server)
    await page.evaluate(() => window.__startCapture());
    await waitForState(page, "recording");
    await page.evaluate(() => window.__handle.cancel());
    await waitForState(page, "idle");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await readStates(page)).toEqual(["permission", "recording", "idle"]);
    expect(await readErrors(page)).toEqual([]);
    expect(await page.evaluate(() => window.__terminal)).toBeNull();
    expect(env.transcribeCalls).toHaveLength(0);

    // 2) a second capture afterwards must reach ready: tracks, AudioContext
    //    and module state were fully released by the cancel
    await page.evaluate(() => window.__startCapture());
    await waitForState(page, "recording");
    await new Promise((resolve) => setTimeout(resolve, RECORD_MS));
    await page.evaluate(() => window.__handle.stop());
    await waitForTerminal(page);
    expect(await readStates(page)).toEqual(["permission", "recording", "transcribing", "ready"]);
    const terminal = await page.evaluate(() => window.__terminal);
    expect(terminal).toMatchObject({ rawText: STUB_RAW, normalizedText: STUB_NORMALIZED });
    expect(env.transcribeCalls).toHaveLength(1);
  } finally {
    await env.t.close().catch(() => {});
    env.server.close();
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});
