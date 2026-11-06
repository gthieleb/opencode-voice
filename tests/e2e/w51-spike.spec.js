// W5.1 spike (Gate A, PATH A): prove the OpenCode GUI-plugin surface in the
// served web app on the pinned runtime (OpenCode CLI v2.2.5).
//
// This spec is fully self-contained: it starts its own OpenCode server in a
// throwaway project + scratch XDG state (isolated from the live session, see
// the "Isolation recipe" in .superpowers/sdd/plan/task-w51-report.md) and
// drives the web UI with a dedicated browser context.
//
// Proven here (served web app, pinned v2.2.5):
//   (1) the GUI plugin loads from a project `opencode.json` `plugins` entry
//       pointing at the local repo (package `./gui-experimental` export) and
//       is registered active with `features.gui`;
//   (2) the server serves the window bundle to the app (GET
//       /api/plugin/gui -> code + sha256 revision + options);
//   (3) the web shell renders the session (composer visible, no app error)
//       with the plugin configured;
//   (4) finding F2: the served web app's host context has no plugin bridge
//       (desktop-only), so the window entry never evaluates and no pill
//       renders; the spec asserts this empirically (zero
//       /api/plugin/gui requests, empty pill row). The pill/popover/draft
//       surface itself is proven in Node by tests/w51-gui-contract.test.js,
//       which runs the real bundle through the app's CJS evaluator contract
//       with a stubbed ctx (see the W5.1 report).
//
// Run (host contract, see openspec/changes/add-web-voice-input/test-runtime-decision.md):
//
//   LD_LIBRARY_PATH=/tmp/opencode/pw-libs/extracted/usr/lib/x86_64-linux-gnu \
//   FONTCONFIG_FILE=/tmp/opencode/pw-libs/fontconfig/fonts.conf \
//     npx playwright test tests/e2e/w51-spike.spec.js
//
// `playwright.config.js` is intentionally untouched; this file manages its
// own browser context (HTTP basic auth for the password-protected server).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Dedicated non-default port: the live OpenCode session owns 4096 and must
// never be touched by verification.
const PORT = 4399;
const HOSTNAME = "127.0.0.1";
const PASSWORD = "w51-spike-pw-2026";
const BASE_URL = `http://${HOSTNAME}:${PORT}`;
const PLUGIN_ID = "@renjfk/opencode-voice";
const SPIKE_DRAFT_TEXT = "voice spike draft";
const PILL_TITLE = "Voice input (W5.1 spike)";

const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "opencode";

// ---------------------------------------------------------------------------
// Headless-Chromium OS-library contract (see
// openspec/changes/add-web-voice-input/test-runtime-decision.md, extended for
// W5.1 with fontconfig + fonts: the real app renders text, which crashes the
// headless shell's Skia font backend without a resolvable fonts.conf).
//
// Run the spec as:
//
//   LD_LIBRARY_PATH=/tmp/opencode/pw-libs/extracted/usr/lib/x86_64-linux-gnu \
//   FONTCONFIG_FILE=/tmp/opencode/pw-libs/fontconfig/fonts.conf \
//     npx playwright test tests/e2e/w51-spike.spec.js
//
// If /tmp/opencode/pw-libs is gone (volatile), re-materialize it:
//
//   mkdir -p /tmp/opencode/pw-libs/debs /tmp/opencode/pw-libs/extracted
//   cd /tmp/opencode/pw-libs/debs
//   for p in libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 \
//            libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
//            libxkbcommon0 libasound2t64 libatspi2.0-0t64 libxrender1 \
//            libxi6 libxres1 libfontconfig1 fontconfig libfreetype6 \
//            fonts-dejavu-core; do apt-get download "$p"; done
//   for d in *.deb; do dpkg -x "$d" /tmp/opencode/pw-libs/extracted/; done
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
  const libdirOk = existsSync(`${PW_LIB_DIR}/libnspr4.so`);
  const fontOk =
    existsSync(`${PW_LIB_DIR}/libfontconfig.so.1`) &&
    existsSync(`${PW_LIB_DIR}/libfreetype.so.6`) &&
    existsSync(`${PW_LIBS}/extracted/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`);
  const ldpOk = (process.env.LD_LIBRARY_PATH ?? "").includes(PW_LIB_DIR);
  let fcFile = process.env.FONTCONFIG_FILE;
  if (fcFile === FONTS_CONF_CANONICAL || !fcFile) {
    if (!existsSync(FONTS_CONF_CANONICAL)) {
      mkdirSync(path.dirname(FONTS_CONF_CANONICAL), { recursive: true });
      mkdirSync(`${PW_LIBS}/extracted/var/cache/fontconfig`, { recursive: true });
      writeFileSync(FONTS_CONF_CANONICAL, FONTS_CONF_XML);
    }
    fcFile = FONTS_CONF_CANONICAL;
  }
  if (!libdirOk || !fontOk) {
    throw new Error(
      "headless-chromium OS libraries missing (volatile /tmp/opencode/pw-libs was cleared). Re-materialize per the recipe in tests/e2e/w51-spike.spec.js header, then re-run.",
    );
  }
  if (!ldpOk) {
    throw new Error(
      `LD_LIBRARY_PATH must include ${PW_LIB_DIR} — see the run contract in the spec header.`,
    );
  }
  if (!existsSync(fcFile)) {
    throw new Error(
      `FONTCONFIG_FILE=${fcFile} does not exist. Set FONTCONFIG_FILE=${FONTS_CONF_CANONICAL} (the file is auto-written on first run) — see the spec header.`,
    );
  }
  return fcFile;
}

// ---------------------------------------------------------------------------
// Isolation fixtures
// ---------------------------------------------------------------------------

/**
 * Ensures `<repo>/node_modules/@renjfk/opencode-voice` points at the repo
 * root. The v2.2.5 plugin loader resolves the plugin's own subpath exports
 * with `Bun.resolveSync("<name>/gui-experimental", <plugin dir>)`, and Bun
 * has no package self-reference: without a `node_modules` link the bare
 * name is unresolvable and the loader silently drops the plugin (no log, no
 * error). This is root cause RC1 of the W5.1 report.
 * `node_modules` is git-ignored, so this only affects the local machine.
 */
function ensureSelfLink() {
  const linkDir = path.join(REPO_ROOT, "node_modules", "@renjfk");
  const link = path.join(linkDir, "opencode-voice");
  if (existsSync(link)) return;
  mkdirSync(linkDir, { recursive: true });
  symlinkSync("..", link);
}

function scrubOpenCodeEnv(env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (key.startsWith("OPENCODE_")) delete out[key];
  }
  return out;
}

/**
 * Starts a fully isolated `opencode serve`:
 *   - dedicated port 4399 (never 4096),
 *   - scratch XDG state under a fresh /tmp/opencode/e2w51-* dir,
 *   - throwaway project directory whose opencode.json is the only config
 *     that references the local repo (the user's ~/.config/opencode is
 *     never read: XDG_CONFIG_HOME is pointed at the scratch dir),
 *   - pinned server password (OPENCODE_PASSWORD) for deterministic auth.
 *
 * Returns { url, sessionUrl, child, scratchHome, projectDir, stop }.
 */
async function startIsolatedServer() {
  const scratchHome = `${os.tmpdir()}/opencode/e2w51-${process.pid}-home`;
  const projectDir = `${os.tmpdir()}/opencode/e2w51-${process.pid}-project`;
  for (const sub of ["xdg-data", "xdg-config", "xdg-state", "xdg-cache"]) {
    mkdirSync(path.join(scratchHome, sub), { recursive: true });
  }
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    path.join(projectDir, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugins: [REPO_ROOT],
      },
      null,
      2,
    ),
  );
  ensureSelfLink();

  const env = scrubOpenCodeEnv(process.env);
  env.OPENCODE_PASSWORD = PASSWORD;
  env.OPENCODE_DISABLE_MODELS_FETCH = "1";
  env.XDG_DATA_HOME = path.join(scratchHome, "xdg-data");
  env.XDG_CONFIG_HOME = path.join(scratchHome, "xdg-config");
  env.XDG_STATE_HOME = path.join(scratchHome, "xdg-state");
  env.XDG_CACHE_HOME = path.join(scratchHome, "xdg-cache");

  const child = spawn(OPENCODE_BIN, ["serve", "--port", String(PORT), "--hostname", HOSTNAME], {
    cwd: projectDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = await waitForServerReady(child);
  const auth = Buffer.from(`opencode:${PASSWORD}`).toString("base64");
  const api = async (method, urlPath, body) => {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`API ${method} ${urlPath} -> ${res.status}: ${await res.text()}`);
    }
    return res.json();
  };

  // Plugin activation is async after the HTTP API comes up; poll until the
  // local plugin is listed and active.
  const deadline = Date.now() + 30_000;
  let plugin;
  for (;;) {
    const list = await api(
      "GET",
      `/api/plugin?location%5Bdirectory%5D=${encodeURIComponent(projectDir)}`,
    );
    plugin = (list.data ?? []).find((p) => p.id === PLUGIN_ID);
    if (plugin?.state?.status === "active") break;
    if (Date.now() > deadline) {
      throw new Error(
        `plugin ${PLUGIN_ID} never became active; last state: ${JSON.stringify(plugin)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const session = await api("POST", "/api/session", {
    location: { directory: projectDir },
  });
  const sessionID = session.data?.id ?? session.id;

  // The GUI code endpoint the app window uses to fetch the bundle
  // (GET /api/plugin/gui?id=<plugin id>), wrapped in { location, data }.
  const gui = async () => {
    const res = await api("GET", `/api/plugin/gui?id=${encodeURIComponent(PLUGIN_ID)}`);
    return res.data ?? res;
  };

  return {
    stdout,
    plugin,
    sessionID,
    gui,
    // The served web app registers its own origin as an http server entry
    // whose key is the origin URL; the route /server/:serverKey/session/:id
    // carries that key base64url-encoded (current chunk: Ln/Rn + encode
    // chunk). "sidecar" is the *desktop* app's local server key.
    //
    // Auth: the app reads ?auth_token=<base64url("opencode:<password>")> at
    // boot (health chunk `me`) and puts explicit Authorization headers on its
    // own API calls (SDK client), which browser-level basic-auth
    // (setHTTPCredentials) does not reliably cover for its fetch/SSE stack.
    sessionUrl: `${BASE_URL}/server/${Buffer.from(new URL(BASE_URL).origin, "utf8").toString("base64url")}/session/${sessionID}?auth_token=${Buffer.from(`opencode:${PASSWORD}`, "utf8").toString("base64url")}`,
    child,
    scratchHome,
    projectDir,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
      rmSync(scratchHome, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    },
  };
}

function waitForServerReady(child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error(`opencode serve did not start within 30s; output:\n${buf}`));
    }, 30_000);
    const onOut = (chunk) => {
      buf += chunk.toString();
      if (buf.includes("server listening")) {
        clearTimeout(timer);
        child.stdout.off("data", onOut);
        resolve(buf);
      }
    };
    child.stdout.on("data", onOut);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`opencode serve exited early (code ${code}); output:\n${buf}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.setTimeout(120_000);

test("W5.1 spike: GUI plugin registers and serves its bundle; web shell renders; pill bridge is desktop-only (F2)", async ({
  browser,
}) => {
  assertBrowserContract();
  const server = await startIsolatedServer();
  const consoleErrors = [];
  const guiRequests = [];
  try {
    // (1) Server-side registration: active, and the loader resolved the
    // package's ./gui-experimental export (features.gui).
    expect(server.plugin.state.status).toBe("active");
    expect(server.plugin.features.gui).toBe(true);
    expect(server.plugin.source).toEqual({
      type: "local",
      path: REPO_ROOT,
    });

    // (2) The bundle is served to the app window with its sha256 revision
    // and the (empty) config options.
    const gui = await server.gui();
    expect(gui.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(gui.options).toEqual({});
    expect(gui.code).toContain("ComposerPill");
    expect(gui.code).toContain(PILL_TITLE);
    expect(gui.code).toContain(SPIKE_DRAFT_TEXT);

    // (3)+(4) Load the session in the web shell.
    const context = await browser.newContext();
    // Playwright 1.64: renamed from setHTTPBasicAuth. Belt-and-braces next
    // to ?auth_token, which the app's own SDK client uses for its fetch/SSE
    // stack.
    await context.setHTTPCredentials({ username: "opencode", password: PASSWORD });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("request", (req) => {
      if (req.url().includes("/api/plugin/gui")) guiRequests.push(req.url());
    });

    await page.goto(server.sessionUrl, { waitUntil: "domcontentloaded" });

    // (3) The web shell renders the session: composer editor present, no
    // app-level error screen.
    const editor = page.locator('[data-component="composer-editor"]');
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /something went wrong/i })).toHaveCount(0);

    // (4) F2, empirical: the served web app (v2.2.5) never fetches the GUI
    // bundle — its host context has no plugin bridge (the bridge exists
    // only in the desktop/Electron build), so the window entry never
    // evaluates and the plugin contributes no composer pill. The pill row
    // itself is present but empty.
    const pillRow = page.locator('[data-component="session-plugin-pills"]');
    await expect(pillRow).toHaveCount(1, { timeout: 10_000 });
    await expect(
      page.locator('[data-component="session-plugin-pills"] [data-slot="session-plugin-pill"]'),
    ).toHaveCount(0);
    expect(
      guiRequests,
      "the web shell made no /api/plugin/gui request (desktop-only bridge)",
    ).toEqual([]);
    test.info().annotations.push({
      type: "w51-finding-f2",
      description:
        "GUI plugin windows (ComposerPill) do not render in the served web " +
        "app on v2.2.5: the web host context has no plugin bridge. The " +
        "pill/popover/draft surface is proven in Node by " +
        "tests/w51-gui-contract.test.js.",
    });

    if (consoleErrors.length > 0) {
      test.info().annotations.push({
        type: "console-errors",
        description: consoleErrors.join("\n"),
      });
    }
  } finally {
    await server.stop();
  }
});
