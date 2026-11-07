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
