// W5.1 spike (Gate A, PATH A): Node-level contract test for the GUI bundle.
//
// gui/gui-experimental.cjs is the plugin's ./gui-experimental entry. OpenCode
// v2.2.5 serves it to the app window (GET /api/plugin/gui) and evaluates it
// there as CommonJS via Function("require","module","exports", code), with
// `require` mapped to the app's shared module graph — a fixed id map in
// which node builtins and `electron` resolve to inert stubs (host chunk
// host-Br4YxjpZ.js).
//
// The served web app never evaluates window plugins (no plugin bridge on the
// web platform — finding F2 of the W5.1 report), and this repo has no
// desktop app, so this test runs the exact same evaluation in Node with:
//
//   - `@opencode/plugin/gui` -> the real SDK (devDependency); the app's
//     internal module was verified shape-identical (Ipc.define ->
//     {kind:"ipc",id,spec}, registries -> {kind:"registry",id}),
//   - `solid-js`             -> minimal createComponent stub,
//   - `effect`               -> minimal Schema stub,
//
// and drives the resulting definition with a stubbed ctx. It proves the
// bundle's contract surface end to end:
//
//   (1) the definition has `setup` and `main` and an i18n catalog;
//   (2) setup registers exactly one ComposerPill (id "voice") whose show()
//       view is { label: "Voice", icon: "waveform", title: <i18n title> };
//   (3) the pill's menu (popover) renders the Ipc status line — web branch:
//       the ctx.main(token) client interface is present; desktop branch:
//       the stub { url, token } resolves into the status line;
//   (4) the popover's write action calls
//       ctx.screen.current()?.composer.setText("voice spike draft");
//   (5) main() provides the Ipc with the stub config/ping implementations.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_PATH = path.join(REPO_ROOT, "gui", "gui-experimental.cjs");
const PLUGIN_ID = "@renjfk/opencode-voice";
const PILL_TITLE = "Voice input";

// The app's fixed require-map ids whose resolution is NOT asserted here
// (node builtins + electron resolve to inert proxies in the app; anything
// outside the fixed map throws). The bundle must require only:
// @opencode/plugin/gui, solid-js, effect.
const INERT_IDS = new Set([
  "electron",
  ..."assert async_hooks buffer child_process cluster console crypto dgram diagnostics_channel dns domain events fs http http2 https inspector module net os path path/posix path/win32 perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util util/types v8 vm worker_threads zlib".split(
    " ",
  ),
]);

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

// Minimal DOM: the popover composes with document.createElement, setAttribute,
// appendChild, className and textContent — nothing more.
function makeElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    attrs: {},
    className: "",
    textContent: "",
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}
globalThis.document = { createElement: (tag) => makeElement(tag) };

let sdkPromise;
let cachedDef;
let cachedExports;

/**
 * Children are two shapes in this harness: raw DOM elements from
 * document.createElement (id under `attrs`) and component props returned by
 * the createComponent stub (id directly on the object). Both are searched.
 */
function findById(root) {
  return (id) =>
    root.children.find(
      (child) => child && (child.attrs?.["data-testid"] === id || child["data-testid"] === id),
    );
}

/**
 * Returns the bundle's full `module.exports` (not just the default definition)
 * so tests can reach the pure helper sections (__pillView, __capture, ...).
 */
function loadRawExports() {
  if (cachedExports) return cachedExports;
  const known = {
    "@opencode/plugin/gui": { Plugin: { define: (d) => d }, Ipc: { define: (d) => d } },
    "solid-js": { createComponent: (component, props) => component(props) },
    effect: {
      Schema: { Struct: (fields) => ({ kind: "struct", fields }), String: {}, Boolean: {} },
    },
  };
  const req = (id) => {
    if (known[id]) return known[id];
    if (id.startsWith("node:") || INERT_IDS.has(id)) return inertModule(id);
    throw new Error(`bundle requires an id outside the app's fixed map: ${id}`);
  };
  const code = readFileSync(BUNDLE_PATH, "utf8");
  const moduleObj = { exports: {} };
  new Function("require", "module", "exports", code)(req, moduleObj, moduleObj.exports);
  cachedExports = moduleObj.exports;
  return cachedExports;
}

/**
 * Evaluates the real bundle file the same way the app does:
 * Function("require","module","exports", code), exports.default ?? exports,
 * then the app's definition validation (needs setup and/or main).
 */
async function loadBundle() {
  if (cachedDef) return cachedDef;
  const sdk = await (sdkPromise ??= import("@opencode/plugin/gui"));
  const effectStub = {
    Schema: {
      Struct: (fields) => ({ kind: "struct", fields }),
      String: { kind: "string" },
      Boolean: { kind: "boolean" },
    },
  };
  const solidStub = {
    createComponent: (component, props) => component(props),
  };
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
  const code = readFileSync(BUNDLE_PATH, "utf8");
  const moduleObj = { exports: {} };
  new Function("require", "module", "exports", code)(req, moduleObj, moduleObj.exports);
  const def = moduleObj.exports.default ?? moduleObj.exports;
  assert.ok(def, "bundle must export a plugin definition");
  assert.ok(
    typeof def.setup === "function" || typeof def.main === "function",
    "definition needs setup and/or main",
  );
  cachedDef = def;
  return def;
}

function makeCtx(def, { platform = "web" } = {}) {
  const added = [];
  const provided = [];
  const setTextCalls = [];
  const mainTokens = [];
  const t = (key, params) => {
    let text = def.i18n?.en?.[key] ?? key;
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
    return text;
  };
  return {
    id: PLUGIN_ID,
    options: {},
    app: {
      name: "opencode",
      version: "2.2.5",
      channel: "prod",
      platform,
      packaged: false,
      os: "linux",
    },
    t,
    add: (registry, item) => {
      added.push({ registry, item: typeof item === "function" ? item() : item });
      return () => {};
    },
    main: (token) => {
      mainTokens.push(token);
      return {
        config: () => Promise.resolve({ url: "ws://localhost:0", token: "stub" }),
        ping: () => Promise.resolve(true),
      };
    },
    screen: {
      current: () => ({
        composer: { setText: (text) => setTextCalls.push(text) },
      }),
    },
    ui: {
      // The createComponent stub calls this with the props and returns the
      // props, so the test can reach onClick / data-testid directly.
      Button: (props) => props,
    },
    provide: (token, impl) => {
      provided.push({ token, impl });
    },
    _added: added,
    _provided: provided,
    _setTextCalls: setTextCalls,
    _mainTokens: mainTokens,
  };
}

test("bundle evaluates under the app's CJS contract and declares the surface", async () => {
  const def = await loadBundle();
  assert.equal(typeof def.setup, "function");
  assert.equal(typeof def.main, "function");
  assert.ok(def.i18n?.en?.title === PILL_TITLE, "i18n catalog carries the pill title");
});

test("setup registers one ComposerPill with the idle view (task 2.4)", async () => {
  const def = await loadBundle();
  const sdk = await import("@opencode/plugin/gui");
  const ctx = makeCtx(def, { platform: "web" });
  def.setup(ctx);

  assert.equal(ctx._added.length, 1, "exactly one registry contribution");
  assert.equal(ctx._added[0].registry, sdk.ComposerPill, "registry is the SDK ComposerPill");
  const pill = ctx._added[0].item;
  assert.equal(pill.id, "voice");

  // A freshly mounted pill renders the idle view.
  assert.deepEqual(pill.show({ session: {}, screen: {} }), {
    label: "Voice",
    icon: "waveform",
    title: PILL_TITLE,
  });

  // The popover carries the record surface: an idle hint, a state line, and
  // the Record / Cancel buttons.
  const root = pill.menu({ session: {}, screen: {}, close: () => {} });
  assert.equal(root.attrs["data-testid"], "voice-popover");
  const byTestId = findById(root);
  assert.equal(byTestId("voice-state").attrs["data-state"], "idle");
  assert.equal(byTestId("voice-state").textContent, "Voice");
  assert.equal(byTestId("voice-record").children, "Record");
  assert.equal(byTestId("voice-cancel").children, "Cancel");
});

test("pill view follows every capture state (pure mapping)", async () => {
  const def = await loadBundle();
  const mod = loadRawExports();
  // The pill's view is derived from the capture state machine's own states,
  // so every state the machine can reach has a defined view.
  for (const state of mod.__capture.CAPTURE_STATES) {
    assert.ok(def.i18n.en[mod.__pillView(state).key], `state ${state} has an i18n label`);
    assert.equal(typeof mod.__pillView(state).icon, "string", `state ${state} has an icon`);
  }
  // An unknown state never throws and falls back to idle.
  assert.deepEqual(mod.__pillView("not-a-state"), mod.__pillView("idle"));
});

test("record with no transport config reports it instead of hanging (web)", async () => {
  const def = await loadBundle();
  const ctx = makeCtx(def, { platform: "web" });
  def.setup(ctx);
  const pill = ctx._added[0].item;
  const root = pill.menu({ session: {}, screen: {}, close: () => {} });
  const byTestId = findById(root);

  // No window.__OPENCODE_VOICE_TRANSPORT__ on the web: the button must say so
  // rather than await an Ipc call that never resolves (finding F2).
  delete globalThis.__OPENCODE_VOICE_TRANSPORT__;
  byTestId("voice-record").onClick();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(byTestId("voice-state").attrs["data-state"], "unconfigured");
  assert.equal(byTestId("voice-ipc-status").textContent, ctx.t("hintNotConfigured"));
});

test("a result lands in the preview and is NOT written to the composer (task 2.5)", async () => {
  const def = await loadBundle();
  const ctx = makeCtx(def, { platform: "web" });
  def.setup(ctx);
  const pill = ctx._added[0].item;
  const root = pill.menu({ session: {}, screen: {}, close: () => {} });
  const byTestId = findById(root);
  const preview = byTestId("voice-preview");
  const insert = byTestId("voice-insert");

  // The product contract from the proposal: a transcript is never submitted
  // automatically. Delivering a result must leave the composer untouched.
  assert.equal(preview.attrs["data-empty"], "true", "preview starts empty");
  assert.equal(insert.disabled, true, "Insert is disabled with nothing to review");

  // Deliver a result the way the capture client does: the popover installs
  // its handler on the shared state object, and startBrowserCapture calls
  // stateRef.onResult(result). Re-mounting reads the same shared state, which
  // is how a reopened popover shows a pending transcript.
  const stateRef = ctx._voiceStateRef;
  assert.ok(stateRef, "the popover exposes the shared capture state");
  stateRef.lastResult = { rawText: "open the file", normalizedText: "Open the file." };

  const reopened = pill.menu({ session: {}, screen: {}, close: () => {} });
  const reopenedPreview = findById(reopened)("voice-preview");
  const reopenedInsert = findById(reopened)("voice-insert");

  assert.equal(reopenedPreview.value, "Open the file.", "normalized text wins");
  assert.equal(reopenedInsert.disabled, false, "Insert enables once there is text");
  assert.deepEqual(ctx._setTextCalls, [], "delivering a result writes nothing to the composer");

  // Insert with an empty preview is a no-op even if clicked.
  preview.value = "";
  preview.textContent = "";
  insert.disabled = false;
  insert.onClick();
  assert.deepEqual(ctx._setTextCalls, [], "empty Insert writes nothing");
});

test("Insert writes exactly the reviewed text, once (task 2.5)", async () => {
  const def = await loadBundle();
  const ctx = makeCtx(def, { platform: "web" });
  def.setup(ctx);
  const pill = ctx._added[0].item;
  const root = pill.menu({ session: {}, screen: {}, close: () => {} });
  const byTestId = findById(root);
  const preview = byTestId("voice-preview");
  const insert = byTestId("voice-insert");

  // A person edits the preview before inserting; what they see is what goes.
  preview.value = "click the Settings icon, then Export";
  insert.disabled = false;
  insert.onClick();
  assert.deepEqual(ctx._setTextCalls, ["click the Settings icon, then Export"]);
  assert.equal(preview.value, "", "preview clears after insert");
  assert.equal(insert.disabled, true, "Insert re-disables");

  // Clicking again writes nothing more: insert is not a submit loop.
  insert.onClick();
  assert.deepEqual(ctx._setTextCalls, ["click the Settings icon, then Export"]);
});

test("desktop branch reads the Ipc config; main provides it", async () => {
  const def = await loadBundle();
  const ctx = makeCtx(def, { platform: "desktop" });
  def.setup(ctx);
  const pill = ctx._added[0].item;

  const root = pill.menu({ session: {}, screen: {}, close: () => {} });
  const record = findById(root)("voice-record");

  // This test covers the config hand-off, not capture: Node has no
  // navigator.mediaDevices, so a real getUserMedia would throw. Pin that the
  // surface reaches getUserMedia (i.e. the config was accepted and capture
  // began) without asserting anything about the microphone itself.
  // Node 24 exposes `navigator` as a getter-only global, so it is replaced
  // through defineProperty and restored to its original descriptor after.
  const navDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let getUserMediaCalled = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => {
          getUserMediaCalled = true;
          return Promise.reject(new Error("test stub: no microphone"));
        },
      },
    },
  });
  try {
    record.onClick();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    if (navDescriptor) Object.defineProperty(globalThis, "navigator", navDescriptor);
    else delete globalThis.navigator;
  }
  assert.equal(ctx._mainTokens.length, 1, "record called ctx.main exactly once");
  assert.equal(ctx._mainTokens[0].id, `${PLUGIN_ID}.voice`);
  assert.equal(getUserMediaCalled, true, "config was accepted and capture started");

  // The main entry provides the Ipc implementation (desktop main process).
  const mainCtx = makeCtx(def, { platform: "desktop" });
  def.main(mainCtx);
  assert.equal(mainCtx._provided.length, 1);
  const { token, impl } = mainCtx._provided[0];
  assert.equal(token.id, `${PLUGIN_ID}.voice`);
  assert.deepEqual(await impl.config(), { url: "ws://localhost:0", token: "stub" });
  assert.equal(await impl.ping(), true);
});
