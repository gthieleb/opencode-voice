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
const PILL_TITLE = "Voice input (W5.1 spike)";
const SPIKE_DRAFT_TEXT = "voice spike draft";

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

test("setup registers one ComposerPill with the expected view (web branch)", async () => {
  const def = await loadBundle();
  const sdk = await import("@opencode/plugin/gui");
  const ctx = makeCtx(def, { platform: "web" });
  def.setup(ctx);

  assert.equal(ctx._added.length, 1, "exactly one registry contribution");
  assert.equal(ctx._added[0].registry, sdk.ComposerPill, "registry is the SDK ComposerPill");
  const pill = ctx._added[0].item;
  assert.equal(pill.id, "voice");
  const view = pill.show({ session: {}, screen: {} });
  assert.deepEqual(view, {
    label: "Voice",
    icon: "waveform",
    title: PILL_TITLE,
  });

  // The popover renders the web-branch status (main entry is desktop-only)
  // and the write-draft button.
  const root = pill.menu({ session: {}, screen: {}, close: () => {} });
  assert.equal(root.attrs["data-testid"], "voice-popover");
  const [status, button] = root.children;
  assert.equal(
    status.textContent,
    "web platform: main entry is desktop-only; Ipc client present (config: yes, ping: yes)",
  );
  assert.equal(button["data-testid"], "voice-write-draft");

  // Clicking the action writes the spike draft through the screen's composer.
  button.onClick();
  assert.deepEqual(ctx._setTextCalls, [SPIKE_DRAFT_TEXT]);
});

test("desktop branch resolves the Ipc stub; main provides it", async () => {
  const def = await loadBundle();
  const ctx = makeCtx(def, { platform: "desktop" });
  def.setup(ctx);
  const pill = ctx._added[0].item;

  const root = pill.menu({ session: {}, screen: {}, close: () => {} });
  const status = root.children[0];
  assert.equal(status.textContent, "voice ipc: loading");
  assert.equal(ctx._mainTokens.length, 1, "popover called ctx.main exactly once");
  assert.equal(ctx._mainTokens[0].id, `${PLUGIN_ID}.voice`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(status.textContent, "voice ipc: ws://localhost:0 (token: stub)");

  // The main entry provides the Ipc implementation (desktop main process).
  const mainCtx = makeCtx(def, { platform: "desktop" });
  def.main(mainCtx);
  assert.equal(mainCtx._provided.length, 1);
  const { token, impl } = mainCtx._provided[0];
  assert.equal(token.id, `${PLUGIN_ID}.voice`);
  assert.deepEqual(await impl.config(), { url: "ws://localhost:0", token: "stub" });
  assert.equal(await impl.ping(), true);
});
