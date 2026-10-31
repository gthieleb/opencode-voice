# Web Voice Input (add-web-voice-input) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan wave-by-wave. The authoritative detailed checklists live in the OpenSpec change `openspec/changes/add-web-voice-input/` (`tasks.md`, `test-plan.md`, `checkpoints.md`, `model-routing.md`) — the plan and the spec travel together and the spec wins on detail.

**Goal:** Add an optional browser voice-input adapter (mic button in the `opencode serve` web composer → existing STT/normalization pipeline → editable draft, manual submit only) to the opencode-voice TUI plugin, per OpenSpec change `add-web-voice-input`.

**Architecture:** Minimal same-origin adapter around the existing TUI plugin. Browser `getUserMedia()` → WAV → authenticated WebSocket → existing whisper/STT + LLM normalization entry point → `{raw, normalized}` returned to an editable composer draft. No reimplementation of STT, normalization, Piper, logging or config. The OpenCode composer injection point is **unverified upstream** — Gate A proves or falls back before any UI work.

**Tech Stack:** Plain ESM JavaScript (no build step), `node --test`, oxlint/oxfmt (`npm run check`), OpenCode V2 TUI plugin (`@opencode/plugin/tui`, `index.js` + `lib/`), Node/TypeScript Playwright Test in a pinned container for browser E2E.

**Spec:** `openspec/changes/add-web-voice-input/` (proposal.md, design.md, tasks.md, test-plan.md, checkpoints.md, model-routing.md, agent-setup.md, specs/web-voice-input/*.md)

## Global Constraints (from AGENTS.md + proposal/design)

- Single TUI plugin via `Plugin.define`; TUI behavior, SoX capture, STT provider options, Piper output, normalization prompts, fallback behavior stay intact; every shared-code refactor is covered by regression tests.
- LLM calls: OpenAI chat completions API (not Anthropic messages API).
- Config: only `options` / storage-backed `api.kv`; no dotfile I/O. Web-specific settings go through the existing config path.
- Diagnostics via `lib/logger.js` (`OPENCODE_VOICE_DEBUG` only).
- **No automatic submit:** a voice transcript is never sent to a session by default; only explicit user action submits, to the current session only.
- Browser never sees provider credentials; transport binds to the OpenCode session auth and same origin; no new public listening port.
- MVP excludes: continuous conversation, live streaming/VAD, WebRTC, always-listening, auto-submission.
- Floor targets (calibrate at Gate C): WER ≤10%, technical-term accuracy ≥95%, critical identifier accuracy ≥90%, unintended submissions = 0, p95 transcript latency ≤3 s (pinned fixture/model/hardware).
- No user speech audio retention without explicit consent; CI uses deterministic synthetic fixtures only.
- Model routing per `model-routing.md`: Qwen-first (L0/L1 default), max 2 bounded attempts per task before escalation, L3 review for auth/security/architecture, L4 only with explicit user consent. Never commit guessed model IDs — Phase M0 first.

## Review Focus

1. **Premature session submit** — draft text must never reach a session without explicit send; test: T2/T3 E2E asserts zero session messages before manual send (`tasks.md` T2).
2. **Cross-session delivery** — submitted text reaches only the originating session; test: session-isolation case in T3.
3. **Auth/origin bypass on the WebSocket** — oversized/malformed payloads, stale/canceled recording IDs, unauthenticated origin; test: T1 security checks (`2.2`, L3 review mandatory).
4. **TUI regressions from shared-code extraction** — existing `node --test` suite must stay green after any `lib/` refactor; test: full `npm run test` per task touching shared code (T1).
5. **Browser audio format assumptions** — MediaRecorder does not emit PCM WAV on all browsers; validate sample rate/mono/format server-side; test: audio validation unit tests + fixture-based E2E (T1/T2).

## Gate Order (normative, from checkpoints.md)

`M0 → T0/Gate A → R0 → T1 → T2 → T3/Gate B → T4/Gate C → T5/Gate D` (+ optional A1 agent promotion at B or D). No gate advances while its predecessor's exit condition fails; exceptions need explicit user approval.

## Waves

### Wave 0 — Setup (done already)
- [x] Clone repo to `~/projects/opencode-voice`, create branch `add-web-voice-input`.
- [x] Copy OpenSpec change package (`openspec/changes/add-web-voice-input/`) and agent templates (`.opencode/agents/`) into the repo.

### Wave 1 — M0: Model & agent discovery (blocking, no implementation)
**Files:** Create: `.opencode/agent-evidence-m0.md` notes → append results to `openspec/changes/add-web-voice-input/model-evidence.md`.
- [ ] Run `opencode --version`, `opencode models`, `opencode agent list`; inspect project/user OpenCode config without printing secrets. Record real, credential-backed model IDs (not catalog visibility).
- [ ] Check each candidate tier model for tool-calling + repo comprehension with one read-only smoke task; record cost/attempts.
- [ ] Bind `model: provider/id` frontmatter into `.opencode/agents/{voice-docs-fixtures,voice-cheap-coder,voice-integration-debugger,voice-independent-reviewer}.md` only for verified IDs (L0→docs-fixtures, L1→cheap-coder, L2→integration-debugger, L3→independent-reviewer). Do not overwrite any existing agents.
- [ ] Publish **Checkpoint M0** to the user: discovered models, assignments, gaps, cost guardrails. **User must approve before Wave 2.**
- Commit: `chore: import add-web-voice-input spec package and bind agent models (M0)`

### Wave 2 — T0 / Gate A: Baseline, composer evidence, architecture decision
**Files:** Modify: `test-evidence.md`, `checkpoints.md`. Create: `evidence/t0-inventory.md`.
- [ ] Record repo SHA, Node version, runtime details; run `npm run test` and `npm run check`; record baseline (all green or documented exceptions) in `test-evidence.md`. *(T0)*
- [ ] Smoke-test whisper.cpp and Piper German behavior; document environment assumptions. *(T0)*
- [ ] Pin the target OpenCode release; inspect composer structure/extension points in OpenCode `packages/session-ui` and `packages/ui` at that version; document supported injection point or the smallest upstream patch. Use the vision subagent for any screenshot evidence. *(1.4)*
- [ ] Audit the pinned version's icon catalog (`catalog.ts`, new-icons variant): pick exact native mic/stop/error/denied icons; record license provenance. *(1.5)*
- [ ] Present **Gate A** report (Implemented/Tested/Risks/Decision requested): reuse points, architecture choice, any proposed upstream patch. **User approval required before UI implementation and before any OpenCode source patch/fork.**
- Commit: `docs: T0 baseline report and Gate A architecture decision`

### Wave 3 — R0: Test runtime decision (before T1)
**Files:** Create: `tests/e2e/` skeleton, write decision to `test-runtime-decision.md`, evidence to `test-evidence.md`.
- [ ] Detect Docker/Podman availability, arch, CI platform. Compare (a) host Playwright Test runner, (b) pinned official Playwright Test image, (c) official Playwright MCP image — separately.
- [ ] Prove fixture injection: mounted absolute-path WAV + Chromium `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=…` reaches `getUserMedia`; verify sample format, permissions, container↔host networking, WebSocket reachability.
- [ ] Decide host vs container; pin image digest/tag and npm version; prefer TypeScript/Node; no Python Playwright, no blanket host installs.
- [ ] Record **Checkpoint R0**. **No T1/T2 progress without R0 outcome.**
- Commit: `test: playwright runtime decision and fake-mic POC (R0)`

### Wave 4 — T1: Transport + transcription contract (before any web UI)
**Files:** Create: `lib/web-transport.js`, `lib/audio-validate.js`, tests in `test/web/`.
- [ ] Write failing unit tests first (red): audio encoding/sample-rate validation, framing, session correlation, cancellation, timeout, size limits, error reporting → run → implement `audio-validate.js` + `web-transport.js` (protocol messages per design.md: `recording.start/finish/cancel`, `transcription.started/final/error`) → green → commit. *(3.1)*
- [ ] Integration test: recorded fixture through the *existing* transcription + normalization functions; assert raw AND normalized text incl. one German/English mixed term (`JSON`). *(T1)*
- [ ] Security tests: WS auth/origin binding, oversized/invalid payloads, disconnect cleanup. *(T1)*
- [ ] Run full `npm run test` — zero TUI regressions. **T1 exit: repeatable audio→text result, UI-independent.**
- Commit: `feat: bounded same-origin voice transport and STT contract (T1)`

### Wave 5 — T2 + minimal web UI (2.3–2.5)
**Files:** Create: web capture client + mic button module (location per Gate A evidence), `docs/web-voice.md` (config, browsers, permissions, reverse-proxy notes).
- [ ] Browser media capture, codec/WAV adaptation, stop/cancel cleanup (tracking mic tracks, sockets, temp files). *(2.3)*
- [ ] Native-looking mic button with states idle/permission/recording/transcribing/ready/denied/error, native Icon/IconButton, accessible labels, dark/light. *(2.4)*
- [ ] Raw/normalized editable preview; explicit manual submit only. *(2.5)*
- [ ] Playwright Test E2E (fake mic + WAV fixture): mic visible, permission flow, start/stop/cancel, transcript appears as editable draft, **zero session messages before manual send**. *(T2, 3.3)*
- [ ] Playwright MCP interactive smoke; record whether current MCP version supports audio-input flags; document limitation honestly. *(3.4, T2)*
- Commit: `feat: browser mic capture, composer button and editable draft (T2)`

### Wave 6 — Gate B: MVP acceptance (user gate)
- [ ] Live demo (or annotated screenshots): mic in composer → capture → existing STT → editable draft → manual submit into the correct current session. ← demonstrating file: E2E run + screenshots
- [ ] User speaks ≥3 ordinary German coding prompts (no retention); collect explicit UX/terminology feedback. ← user
- [ ] TUI regression suite green; tested versions recorded in `test-evidence.md`. ← verification
- [ ] Publish **Gate B** report. Go/No-Go before any scope expansion (no VAD/streaming/refactors).

### Wave 7 — T4 / Gate C: Speech quality
**Files:** Create: `fixtures/speech/` (Piper-generated), `benchmarks/wer.js` reporting into `evidence/benchmarks/<date>.md`.
- [ ] Generate + version ≥20 Piper German coding fixtures with canonical references and provenance (L0 agent). *(3.2)*
- [ ] Benchmark raw AND normalized separately: WER, CER, technical-term recall, identifier exact-match, critical errors, p50/p95 latency. *(3.6)*
- [ ] Negative/error cases: permissions denied, no devices, silence, malformed chunks, oversize, session switch, cancellation. *(3.8)*
- [ ] Optional: invite 5–10 real user utterances with explicit consent + local-delete policy. *(3.7)*
- [ ] Publish **Gate C**: benchmark table + raw/normalized comparison; agree release thresholds with user.

### Wave 8 — T5 / Gate D: Release readiness
**Files:** Modify: `.github/workflows/ci.yml` (extend), `README.md` (section web voice input, linking `docs/web-voice.md`), `test-evidence.md`.
- [ ] CI: unit/integration/browser-smoke/`openspec validate --strict` on PR; model-dependent benchmarks optional nightly. *(3.9, T5)*
- [ ] Formatted/linted (`npm run check`), full suite green, OpenSpec validate passing. *(4.2)*
- [ ] Compatibility matrix + known limitations; L3 security/review sign-off (independent reviewer agent). *(4.1, 6.4)*
- [ ] Publish **Gate D**: demo, reports, PR diff summary. Upstream PR only after explicit user go/no-go; no automatic push.

### Wave 9 — Optional A1: agent promotion (only at Gate B or D, opt-in)
- [ ] Only proven agents, generalized prefix-free names, collision check, explicit per-agent user authorization, then copy to `~/.config/opencode/agents/` and verify `opencode agent list`. Record in `agent-promotion.md`.

## Communication Checkpoints

- **Channels:** (1) this session — each gate report here first; (2) GitHub Issues/PR in this repo — milestone comments at Gate A/D; (3) CI artifacts for evidence zips.
- **Schedule:** report after every wave per `checkpoints.md` format — 📡 **Wave [N] Complete — [Title]** / **Done / Verified / Next / Blockers**; user-facing decision reports at M0, Gate A (Wave 2), R0 (Wave 3), Gate B (Wave 6), Gate C (Wave 7), Gate D (Wave 8) use the Implemented/Tested/Risks/Decision-requested template.
- **Issue tracking:** one tracking issue "add-web-voice-input" opened at Wave 2; closed at Gate D.
- **Delegation:** all GitHub-facing comments delegated to the reviewer/general subagent with the report text; screenshots attached per release-asset piggyback rule (never dead references).
- **Implicit gate reports:** questions/beats during the demo/validation wave are user-visible by default; internal subagent execution is silent, failures surfaced per template.

## Execution Skill

`superpowers:subagent-driven-development` — one agent per wave task, the four project agents (`voice-*`, bound in M0) as work horses, `voice-independent-reviewer` (L3) before Gate D. Same-repo parallel coding is not used (single wave sequence, no worktrees needed); read-only research subagents may run in parallel within a wave.

## Repo gates (current state, verified)

- CI exists: `.github/workflows/ci.yml` + `release.yml` (extend, don't replace). ✔
- **No `.pre-commit-config.yaml`** and hooks not installed — gap. Question to user: create a minimal config for this repo (gitleaks + pre-commit-hooks + oxlint hook) as part of Wave 8, or skip pre-commit here? *(Open because it alters repo config beyond the spec.)*
- No `openspec/` tree existed before Wave 0 (package added it); `openspec validate` availability depends on installed CLI — verify at Wave 8, fall back to manual spec→evidence mapping per `test-plan.md`.
