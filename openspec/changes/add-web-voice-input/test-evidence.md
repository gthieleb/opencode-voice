# Test evidence log

All checkpoints are **NOT RUN** as of creation of this specification. This document must be populated by actual executions against checked-out repositories; no test result is implied by the plan.

| Gate | Status | Evidence / execution environment | Decision |
|---|---|---|---|
| T0 — Baseline | **RUN (2026-10-31)** | see below | Baseline green; Gate A pending |

### T0 detail (2026-10-31)

| Item | Value |
| --- | --- |
| opencode-voice repo | fork `gthieleb/opencode-voice`, branch `add-web-voice-input` @ `8138a53` (upstream pin `00c5e192…` = "feat: port to OpenCode V2 with execution-event auto TTS and fixed dialog wiring"; latest tag v1.0.0) |
| Plugin API version | devDependency `@opencode/plugin ^2.2.1` (V2 native, matches runtime `opencode v2.2.5`) |
| Node / npm | v24.22.1 / 12.2.1 (linux) |
| `npm install` | ✔ clean fresh install |
| `npm run test` (node --test) | ✔ **20 pass / 0 fail** (dialog-api test failed only while node_modules absent; resolved by install, not a code bug) |
| `npm run check` | ✔ clean after adding `.prettierignore` excluding meta dirs `.opencode/` + `openspec/` (initial 29 format findings were 100% imported OpenSpec/skill metadata files; zero repo source file affected) |
| OpenSpec validate | ✔ `openspec validate add-web-voice-input --strict` = valid (@fission-ai/openspec@1.16.0) |
| Whisper / Piper / SoX | ✖ **NOT INSTALLED** on host — STT/TTS pipeline smoke blocked locally; resolution deferred to R0 runtime decision (container vs host, with user approval) |

Agent task 1.1 + 1.2 + 1.3 inventory source locations: see tasks 1.4/1.5 research notes (append below when done).

| T1 — Transport/STT | NOT RUN | — | Pending |
| T2 — Browser smoke | NOT RUN | — | Pending |
| T3 — MVP | NOT RUN | — | Pending |
| T4 — Speech quality | NOT RUN | — | Pending |
| T5 — Release | NOT RUN | — | Pending |

### T1 progress (2026-11-02) — transport + STT contract (commits 003d35e..e2ec0f5)

| Gate | Status | Evidence |
|---|---|---|
| T1 — Transport/STT contract | **PARTIAL (core complete, real-STT backend pending)** | see below |

| Item | Result |
| --- | --- |
| Task 2.1 shared STT interface (`transcribeWavFile`, `normalizeText`) | ✔ commit abfc497; review PASS (24→24 tests, statement-level TUI identity verified by reviewer) |
| lib/audio-validate.js (`parseWav`, `validateAudioBuffer`) | ✔ commit 136bfd9; review PASS incl. 500-buffer fuzz + 6 crafted malformed WAVs, never-throws proven |
| lib/web-transport.js sidecar state machine | ✔ commit 4515c4c; L3 security review PASS (token constant-time, origin default-deny, temp-file path traversal probe clean, 21 MiB frame-bomb probe clean 1009) |
| L3 hardening round | ✔ commit e2ec0f5; re-review PASS all 4 items |
| Test totals | 63/63 pass (`node --test`), `npm run check` green, `openspec validate --strict` valid |
| Models used | implementers: opencode-go/glm-5.3-flash (2.1), huggingface GLM-4.7-Flash (4b, 4d), huggingface Qwen3.8-27B (4c); reviewers: huggingface Qwen3.8-27B (2.1), opencode-go GLM-5.3-Flash (4b, 4d re-review), huggingface GLM-5.3-Flash (4c L3) — cost UNKNOWN (free-tier), attempts 1 each |
| STILL OPEN for T1 full exit | real German/English mixed-term integration through a REAL STT backend: whisper-cli not installed on host (blocker B-block-2) and no STT API credentials; fetch-stubbed contract tests cover pipeline semantics in the meantime. Also TUI runtime regression in a real opencode TUI session not yet run (only unit-level identity). |
| B1 (browser OS libs) | **RESOLVED (2026-11-06) without sudo** — rootless `apt-get download` + `dpkg -x` of 16 system libs into `/tmp/opencode/pw-libs/extracted`; Playwright runs need `LD_LIBRARY_PATH=/tmp/opencode/pw-libs/extracted/usr/lib/x86_64-linux-gnu` (volatile path, exact command in `test-runtime-decision.md`) |

### R0 + T2 gate-in (2026-11-06) — blocker B1 resolved, fake-mic POC passes

| Item | Result |
| --- | --- |
| B1 resolution | rootless lib install: libnspr4, libnss3(+nssutil), libatk1.0-0t64, libatk-bridge2.0-0t64, libatspi2.0-0t64, libasound2t64, libgbm1, libxkbcommon0, libXcomposite1, libXdamage1, libXfixes3, libXrandr2, libxrender1, libxi6, libxres1, libXrender deps → all launch errors gone (`ldd` clean) |
| Secure-context finding | headless shell treats `data:` URLs as NOT secure (`navigator.mediaDevices` undefined) — POC spec rewritten to serve a throwaway page from `http://127.0.0.1` (always secure in Chromium); future E2E specs must do the same |
| Fake-mic POC | ✔ **PASS**: `LD_LIBRARY_PATH=… FIXTURE_WAV=$PWD/tests/e2e/fixtures/german-tone-fixture.wav npx playwright test poc-fake-mic` → 1/1 passed, `stage: recorded`, non-trivial byte count — fixture injection via `--use-fake-*` flags PROVEN on host |
| tasks 0.9 / 0.12 | ✔ R0 checkpoint COMPLETE (host-first runtime; container variant remains a documented deferred option) |
| Task 0.4 (M0 model trial) | ✔ recorded in `model-evidence.md` (Qwen3-8B read-only tool-calling probe; Llama-3.1-8B rejected for agent routing) |
| T1 residual | unchanged: real-STT-backend integration + TUI runtime regression still open (tracked above) |
| Test totals | 63/63 `node --test` unchanged; `npm run check` green after POC spec fix |

| Gate | Status | Evidence / execution environment | Decision |
|---|---|---|---|
| T2 — Browser smoke | **gate-in open** | E2E specs must use 127.0.0.1 secure-context pattern + LD_LIBRARY_PATH contract | T2 (tasks 2.3–2.5) may proceed |

### W5.1 progress (2026-11-07) — GUI-plugin spike/scaffold (commits 08e5e8f, 43271d3 + fix round)

| Item | Result |
| --- | --- |
| GUI-plugin loading mechanism | **PROVEN** on v2.2.5: project `opencode.json` `"plugins": ["<dir>"]` → package self-reference `Bun.resolveSync("<name>/gui-experimental", <dir>)` → entry lookup `server/tui/rpc/gui` (gui candidate = `gui-experimental` when package named) → served at `GET /api/plugin/gui?id=<pkg>` with sha256 revision. **RC1:** Bun 1.4.4 has no package self-reference → silent drop (zero logs) without git-ignored `node_modules/<name> -> ..` symlink (spec recreates it, `ensureSelfLink`). **RC2:** exports must be string shorthand (import conditions; `require`-only fails). |
| **F2 (load-bearing)** | On v2.2.5 (and dev-904, probed 2026-11-06) the served **web app never evaluates config-plugin GUI windows**: web host context has no plugin bridge; consumer/evaluator machinery already ships in the web bundle; pill row renders empty; zero `/api/plugin/gui` app requests. SDK docs: "A plugin from the config runs only in the desktop app". Regression-pinned in `tests/e2e/w51-spike.spec.js` (asserts the boundary; flips when the bridge lands). |
| Vehicle ruling | **HYBRID** (user, 2026-11-07): vehicle-agnostic code + upstream issue **anomalyco/opencode#62561** (evidence package + minimal-fix direction); no fork; W5.4 demo two-layer (audio-pipeline browser E2E now, app-integration E2E release-gated). See `checkpoints.md` §"Gate A amendment". |
| Pill/composer/main-IPC surface | PROVEN via Node contract test: real bundle evaluated through the app's exact CJS evaluator (`Function("require","module","exports", code)`, fixed require map) — `ComposerPill` registry identity, `show()` view, popover render, `composer.setText` invocation, `Ipc.define` id under plugin namespace, `main` provide. 3/3 green. |
| Build verdict | **No bundler required** (R-no-build holds): host serves + evaluates the raw `.cjs` source verbatim (e2e asserts served code contains the raw source markers). |
| Isolation recipe (verified, in `tests/e2e/w51-spike.spec.js`) | dedicated port 4399, scratch XDG under `os.tmpdir()/opencode/e2w51-<pid>-*`, throwaway project dir, inherited `OPENCODE_*` scrubbed, SIGTERM→SIGKILL teardown + scratch removal; web-app access: session route `/server/<base64url(origin)>/session/<id>` + `?auth_token=base64url("opencode:<pw>")` (browser basic-auth alone insufficient); Playwright 1.64 `setHTTPCredentials` (not `setHTTPBasicAuth`). |
| Browser contract extended | headless Chromium FATALs on text rendering without fontconfig: added libfontconfig1/fontconfig/libfreetype6/fonts-dejavu-core + self-contained `fonts.conf` → run contract now `LD_LIBRARY_PATH=… FONTCONFIG_FILE=/tmp/opencode/pw-libs/fontconfig/fonts.conf npx playwright test …` (re-materialize recipe embedded in spec header, fails fast). |
| Tests | e2e `w51-spike.spec.js` 1 passed; `npm run test` 66/66; `npm run check` 0 errors (1 pre-existing warning lib/audio-validate.js:109, not from this task). |
| Review | L3 task review **Approved**, 1 Important (stdout pipe-backpressure deadlock in server fixture) → fix round 1 dispatched; 5 Minors deferred to final review (incl. fail-on-console-error, port-busy clarity, data-testid prop forwarding note for W5.3, self-link README note for W5.5, 10ms sleep). |

### W5.2 progress (2026-11-07) — browser media capture client (task 2.3)

| Item | Result |
| --- | --- |
| Architecture | Per W5.1 verdict all window-side code lives in `gui/gui-experimental.cjs` (host serves + evaluates raw source; fixed require map — no `lib/` imports). Four new CJS sections exported non-default: `__audio` (byte-exact `encodePcm16Wav`, `downmixToMono`, `resampleLinear`, `floatToPcm16` — pure, Node-runnable), `__capture` (`CAPTURE_STATES`, pure `nextCaptureState` 7×9 table), `__ws` (`createVoiceWsClient`, spec-WebSocket based: browser **and** Node ≥22 undici), `__browser` (`startBrowserCapture` glue + `SERVER_DEFAULT_LIMITS` mirror + `MIME_CANDIDATES` — browser-only, never called in Node). W5.1 scaffold + default export untouched. |
| Browser auth (frozen server, no gap) | `lib/web-transport.js` `checkUpgrade` reads `?token=` **query param first** (Bearer header only fallback) — browsers can't set WS upgrade headers but can set the query, so plain `window.WebSocket` + `url?token=` authenticates. Origin: real browser sends `Origin` on upgrade; sidecar default allow-list = the app origins (`http://localhost:4096`, `http://127.0.0.1:4096`). Codec is **`audio/wav`** (server hard-rejects anything else, `handleStart`); `sampleRate` derived from the WAV header so start and payload can't disagree; optional `sizeBytes` preflight honored by the server. Full client message sequence + server code quotes: `.superpowers/sdd/plan/task-w52-report.md`. |
| Node contract + integration | `tests/w52-capture-contract.test.js` (15 tests, consumes bundle exports via the W5.1 evaluator — no re-implementation): header byte-exactness; encode→`lib/audio-validate.js` round-trip (valid 16 kHz accepted; empty/EMPTY_DATA + header-truncated rejected); resample length + exact spots (48k→16k index-exact, 44.1k→16k ramp bit-exact); downmix; floatToPcm16 clamps (±3.0/NaN/±Inf); **exhaustive 63-row transition table** + payload carry/drop (FINAL-after-CANCELED no-op pinned); **real `createVoiceTransport` integration** (port 0, STT/normalization stubbed per `test/web-transport.test.js` pattern): happy path `start→ready→frame→finish→final` with verbatim result fields + timings, mid-flight server close → `TRANSPORT_CLOSED`, wrong token → `TRANSPORT_CLOSED`, silent clip → server `SILENT` pass-through, cancel (mid-upload + pre-open) → idle, no late result/error. |
| Chromium fake-mic proof | `tests/e2e/w52-capture.spec.js` (2 tests, pinned browser image, R-B1 `LD_LIBRARY_PATH`+`FONTCONFIG_FILE` contract, `--use-fake-*` flags from `playwright.config.js`, fixture `german-tone-fixture.wav`): page evaluates the FULL bundle under the host's exact `Function("require","module","exports")` contract (real ids inert-stubbed), then drives `startBrowserCapture` against a real in-process sidecar that allows **only the page's own origin** (real browser Origin header, no allowNoOrigin). **Stop path:** states exactly `permission→recording→transcribing→ready`, stubbed raw+normalized result, finite timings, transcriber ran on `voice-<connId>-web-<uuid>.wav`. **Cancel path:** `permission→recording→idle`, nothing transcribed (deterministic), and a second capture afterwards reaches ready (cleanup proven). 2/2 passed, stable across 2 runs. |
| Playwright MCP limitation (documented) | Audio tested via Playwright Test + pinned image, not the `playwright` MCP server: the MCP-managed browser does not inherit the rootless host OS-library contract (Chromium FATALs in Skia font backend without it; no launch-args/env hook in installed version). MCP remains usable for non-audio browser work. |
| Tests / gates | `npm run test` 81/81 (66 baseline + 15); `npm run check` 0 errors (1 pre-existing warning); `npx openspec validate add-web-voice-input --strict` valid; W5.1 e2e regression green with grown bundle (3/3 playwright passed). Frozen files untouched; no new product listening port. |

### R0.2 container stack (2026-11-10, commits bee371d + d608e62)

| Item | Result |
| --- | --- |
| User decision | container-first for further tests: OpenCode web v2 image + pinned Playwright image (podman) |
| Stack | `test/e2e/compose.yaml`: opencode-web (`guarnacciaa/opencode-v2:2.0.29`, digest sha256:8164568c…, newer 2.2.7 noted as bump-ready), voice-sidecar (node:24-slim, real `createVoiceTransport` + FAKE_TRANSCRIBE=1, live smoke: ready→started→final with German mixed stub), e2e (`mcr.microsoft.com/playwright:1.64.1-noble`, shares sidecar netns → `ws://127.0.0.1:9100`) |
| Runner | `test/e2e/run-container.sh` (podman compose → podman-compose fallback → printed manual podman run; --poc-only / --down / --clean; digests to test/e2e/digests.txt even on red runs) |
| Post-review fixes | C1 host-lib contract gated for container (E2E_HOST=1), I1 digest-on-red fixed, M1 comment accuracy, M3 lifecycle doc — re-review PASS 4/4 |
| Agent-side verification | static only (sandbox cannot run podman): 82/82 tests, check green, bash -n, YAML parse, sidecar live ws smoke incl. 4001/4002 close codes |
| **Pending acceptance (user terminal)** | `cd ~/projects/opencode-voice && test/e2e/run-container.sh` — first real podman run of the stack is the R0.2 acceptance; T2 container E2E depends on it |
