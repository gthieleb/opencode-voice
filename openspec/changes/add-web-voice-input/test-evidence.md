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
| B1 (browser OS libs) | still open — blocks T2 (tasks 2.3–2.5 + Playwright browser smoke) |
