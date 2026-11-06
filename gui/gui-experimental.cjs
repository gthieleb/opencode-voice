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
