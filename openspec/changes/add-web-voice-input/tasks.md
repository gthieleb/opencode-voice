# Tasks

## 1. Baseline / inventory
- [x] 1.1 Clone and pin current opencode-voice and OpenCode commits; capture runtime versions.
- [x] 1.2 Read `AGENTS.md`, source entry points, test inventory, scripts and benchmarking tools; identify existing STT/TTS abstractions.
- [x] 1.3 Run original test suite and lint; record baseline failures and coverage.
- [x] 1.4 Inspect current OpenCode GUI extension API and composer source; document supported injection point and fallback path.
- [x] 1.5 Audit exact Icon/IconButton exports, icon catalog entries, asset sources, licenses, and dark/light themes.

## Checkpoint A — Architecture decision (approval required before UI implementation; tasks 1.6–1.8, formerly A.1–A.3)
- [x] 1.6 [was A.1] Share inventory: reusable opencode-voice functions, original test results, OpenCode GUI composer injection evidence, native icon mappings.
- [x] 1.7 [was A.2] Present recommended minimal integration and fallback, including any upstream patch, and explicitly request user approval before adopting a fork/patch.
- [x] 1.8 [was A.3] Record decision and constraints in `checkpoints.md`.

## 2. Minimal implementation
- [ ] 2.1 Extract narrow shared transcription interface only if required; preserve TUI behavior and fallback.
- [ ] 2.2 Build authenticated, origin-restricted, bounded same-origin voice transport; reuse existing Whisper/STT adapter.
- [ ] 2.3 Implement browser media capture, codec adaptation and stop/cancel cleanup.
- [ ] 2.4 Add native-looking microphone button and states to supported composer extension point.
- [ ] 2.5 Display raw/normalized transcription with editable preview and explicit user submit only.
- [ ] 2.6 Document configuration, supported browsers, permissions, deployment and reverse-proxy requirements.

## Checkpoint B — MVP demonstration (acceptance gate; tasks 2.7–2.10, formerly B.1–B.4)
- [ ] 2.7 [was B.1] Demonstrate microphone visible in the lower OpenCode web composer, browser capture, existing Whisper/normalization pipeline, editable draft, manual submission.
- [ ] 2.8 [was B.2] Verify no accidental submit, session isolation and TUI regression tests; record tested versions and evidence.
- [ ] 2.9 [was B.3] Ask user to try at least three German coding prompts; collect explicit feedback on terminology, UX and permission behavior.
- [ ] 2.10 [was B.4] Do not expand to streaming/VAD or major refactoring before MVP review; record go/no-go decision.

## 3. Tests and quality
- [ ] 3.1 Extend existing unit/integration tests for TUI regression, session isolation, fallback and audio validation.
- [ ] 3.2 Prepare at least 20 Piper-generated German coding utterance fixtures, references and provenance; expand to 50–100 after first pass.
- [ ] 3.3 Execute Playwright Test browser E2E with fake microphone WAV; check draft versus actual submitted session message.
- [ ] 3.4 Verify Playwright MCP audio-input flags in installed server version and record repeatable configuration.
- [ ] 3.5 Test TTS audio artifact generation and optionally browser playback without assuming MCP speaker loopback.
- [ ] 3.6 Add benchmark report WER/CER, technical term recall, critical errors, raw versus normalized comparison and timings.
- [ ] 3.7 Request user-opted human speech samples; evaluate mixed German/English technical terms and privacy handling.
- [ ] 3.8 Test permissions denied, no devices, silence, malformed chunks, oversize, session switch and cancellation.
- [ ] 3.9 Add CI that runs deterministic unit, fixture and browser tests, with optional model-dependent benchmarks.

## Checkpoint C — Audio quality review (user input needed; tasks 3.10–3.13, formerly C.1–C.4)
- [ ] 3.10 [was C.1] Share benchmark table: WER, CER, technical terms, critical errors, real versus Piper speech and latency.
- [ ] 3.11 [was C.2] Invite user to record 5–10 representative German/English coding prompts; request consent before retaining audio as fixtures and offer immediate discard.
- [ ] 3.12 [was C.3] Show raw versus normalized transcripts for review before session delivery; resolve critical terminology errors or explicitly document exceptions.
- [ ] 3.13 [was C.4] Agree quality threshold / known limitations before final release candidate.

## 4. Completion
- [ ] 4.1 Document limitations and exact tested OpenCode/Chromium/Playwright MCP versions.
- [ ] 4.2 Run formatter, lint, tests and OpenSpec validation.
- [ ] 4.3 Prepare reviewable upstream PR with minimal changes and architecture notes.

## Checkpoint D — Release / upstream decision (tasks 4.4–4.6, formerly D.1–D.3)
- [ ] 4.4 [was D.1] Provide demo, full test reports, known limitations, compatibility table and diff/PR summary.
- [ ] 4.5 [was D.2] Obtain go/no-go from user before proposing an upstream PR or enabling auto-upgrade behavior; no automatic push or PR.
- [ ] 4.6 [was D.3] Record final decision, any deferred items and next milestones in `checkpoints.md`.

## 5. Mandatory test gates (see `test-plan.md`; tasks 5.1–5.6, formerly T0–T5)
- [ ] 5.1 [was T0] — Run actual baseline tests and tools before any implementation; record results in `test-evidence.md`.
- [ ] 5.2 [was T1] — Audio/WebSocket/STT integration tests, security and TUI regressions pass before UI integration.
- [ ] 5.3 [was T2] — Playwright fake-mic browser smoke passes; check MCP audio injection and verify no automatic submit.
- [ ] 5.4 [was T3] — Full OpenCode server-side session E2E passes and user reviews three spoken examples; MVP go/no-go.
- [ ] 5.5 [was T4] — Piper + optional consented human-speech quality report reviewed; agree measurable release thresholds.
- [ ] 5.6 [was T5] — CI suite, OpenSpec structural validation and implementation verification completed before release/PR decision.

## 6. Cost-first model assignment and review (see `model-routing.md`)
- [ ] 6.1 Verify actual available model IDs with `opencode models`; pin provider, model, runtime and any pricing assumptions.
- [ ] 6.2 Trial L0/L1 models on five representative safe tasks; compare total cost per accepted task against L2, including retries.
- [ ] 6.3 Delegate each task using the routing matrix; record model, attempts, evidence and escalations in `model-evidence.md`.
- [ ] 6.4 Have L3 independently review security/auth/session handling, architectural changes and release readiness.
- [ ] 6.5 Ask user before L4/premium-model invocation; cap cost and prevent endless loops.
- [ ] 6.6 Include model/cost/attempt summary in communication gates A–D and T0–T5 evidence.

## 0. Mandatory preflight: model and agent availability (before T0 or implementation)
- [x] 0.1 Detect installed OpenCode version and working project; run `opencode models` and `opencode agent list`; inspect project and user OpenCode config **without exposing credentials**. `/models` in the UI is a second source. Record actual enabled provider/model IDs, pricing or local hardware, context limit and tool-calling suitability in `model-evidence.md`. Do not infer availability from model catalog alone.
- [x] 0.2 Inventory existing agents and compatible agent schema (current stable vs V2); do not overwrite existing agents. Determine whether `model:` frontmatter and permissions are honored in installed version.
- [x] 0.3 Recommend a cheapest viable L0/L1/L2/L3 mapping using **available IDs**; if missing propose (a) existing alternative (b) configuring cheap task-specific coding agents (c) connecting a provider/local inference, subject to user approval and cost visibility. Never silently add credentials, install provider or invoke premium API.
- [ ] 0.4 Run quick read-only trial of the cheapest model for tool calling and repository comprehension; test a small isolated coding change with executable acceptance criteria only after baseline. Record successes/retries/total cost; promote on two failed bounded attempts.
- [x] 0.5 Set up or propose project `.opencode/agents/` profiles from this package. Only after model discovery fill model overrides; absent model property inherits selected primary model (not a proof of cheap execution). Confirm with `opencode agent list` and a smoke invocation.
- [x] 0.6 Publish **Model & Agent Checkpoint M0**: actual discovered models, selected assignments, missing capabilities, alternatives, cost guardrails, users' decision where needed. Gate implementation on M0.

## 0b. Mandatory test execution environment selection (before T1; tasks 0.7–0.12, formerly 0b.1–0b.6)
- [ ] 0.7 [was 0b.1] Detect Docker/Podman availability, host OS, CPU architecture, audio hardware requirements, CI platform and target OpenCode frontend networking.
- [ ] 0.8 [was 0b.2] Compare host-installed Node Playwright Test, official version-pinned Playwright Test image, and official Playwright MCP container **separately**; inspect existing repo test dependencies. Recommend containerized Chromium E2E by default for reproducibility, but keep test runner language TypeScript/Node and reuse repo dependency manager.
- [ ] 0.9 [was 0b.3] Prove fixture injection using actual WAV file in container-mounted path with Chromium fake-microphone flags; validate sample format, loop/stop behavior, permissions, `localhost`/host-gateway networking, WebSocket and artifact mount access.
- [ ] 0.10 [was 0b.4] Smoke-check official MCP Docker image: can installed MCP version pass Chromium launch args/config and mounted fixture paths? If not, use Playwright Test Docker for audio E2E and Playwright MCP for UI smoke; do not claim direct audio-input support without evidence.
- [ ] 0.11 [was 0b.5] Decide host vs container strategy and pin image digest/tag, npm package version and fixtures; write decision to `test-runtime-decision.md`, evidence to `test-evidence.md`, and propose Dockerfiles/Compose **only if justified**. Avoid Python Playwright unless repository needs Python; no blanket host package installs.
- [ ] 0.12 [was 0b.6] **Runtime Checkpoint R0**: working prototype of fake mic/fixture and documented image/security/reproducibility tradeoff. No T1/T2 progress without R0 outcome (or documented approved blocker).

## 7. Optional A1 — agent promotion to global OpenCode (at T3/B or T5/D)
- [ ] 7.1 Review real results and test evidence for all four project agents; recommend only proven reusable candidates.
- [ ] 7.2 Present generic name proposals and prompt generalizations without `voice-`; check collisions, permissions and provider/model availability.
- [ ] 7.3 Request explicit user authorization for **each** global agent to install; do not silently change global configuration.
- [ ] 7.4 If authorized, copy generalized profiles to `~/.config/opencode/agents/`, keep project originals, and update only approved references.
- [ ] 7.5 Verify `opencode agent list` and a constrained smoke invocation; record successful or deferred outcomes in `agent-promotion.md` and model evidence.
