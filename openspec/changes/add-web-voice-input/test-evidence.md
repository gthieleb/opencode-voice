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
