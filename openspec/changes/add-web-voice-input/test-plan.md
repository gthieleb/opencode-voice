# Test strategy and executable checkpoints

This test plan is normative for change `add-web-voice-input`. **OpenSpec's `validate` verifies specification structure; `/opsx:verify` checks implementation-to-spec alignment. Neither executes Playwright, measures speech quality, nor proves runtime correctness.** Use the repository's real test runner and CI for those results.

## Policy: shift-left and evidence

- Follow red/green/refactor where practical: add failing tests for each contract before implementation; rerun affected tests after every change.
- Run appropriate existing TUI tests whenever shared STT, normalization, configuration or transport internals change.
- Each checkpoint requires recorded commit hashes, test commands, environment, input fixtures, results, relevant logs/screenshots and known failures in `test-evidence.md`. Never mark passed based solely on written specs.
- No user speech audio is stored or uploaded without explicit consent. CI primarily uses deterministic synthetic fixtures.
- If a checkpoint fails, fix or document a blocking exception and do not advance across its gate. An exception requires explicit user approval for MVP/release gates.

## Checkpoints

### T0 — Baseline, prior to changes
- [ ] Record `opencode-voice` and OpenCode commit/version, Node/runtime, host OS, browser and installed Playwright MCP version.
- [ ] Inventory and execute **existing** project tests, lint, typecheck and benchmarks where available; distinguish missing tests from passed tests.
- [ ] Smoke test Whisper and Piper commands/models and document environment assumptions, especially German language behavior.
- [ ] Prove or disprove GUI composer integration and check native icon assets. Publish a brief inventory and architecture decision checkpoint A.
- **Exit:** baseline report plus smallest feasible adapter plan; explicit approval before any OpenCode source patch/fork.

### T1 — Transport and transcription contract, before web UI integration
- [ ] Unit tests for audio encoding/sample-rate, framing, session correlation, cancellation, timeout, limits and error reporting.
- [ ] Integration test passes a recorded fixture through the *existing* transcription and normalization functions. Assert both raw and normalized transcript, including a German/English term.
- [ ] WebSocket auth/origin/security checks, oversized/invalid payload checks and disconnect cleanup pass.
- [ ] Existing TUI regression tests pass.
- **Exit:** scripted repeatable audio-to-text result independent of the UI.

### T2 — Browser smoke, immediately after first mic UI
- [ ] Playwright Test launches real OpenCode web frontend and verifies mic location, accessibility labels, permission handling, start/stop/cancel.
- [ ] Chromium fake microphone and a known WAV fixture reach the existing STT pipeline and appear as editable text in the composer.
- [ ] Verify **zero messages** are submitted to the session before an explicit user send.
- [ ] Run an interactive Playwright MCP smoke test and record whether current MCP browser launch flags can inject WAV audio; if not, use Playwright Test as E2E and document MCP limitation.
- **Exit:** repeatable browser-to-draft demonstration with no premature submission.

### T3 — MVP acceptance and communication checkpoint B
- [ ] Full E2E asserts actual submitted message in the **current server-side OpenCode session**, and none in unrelated sessions.
- [ ] Edit or discard text; rapid cancel/retry; session switch; denied permission; missing device; network failure.
- [ ] Verify TUI unchanged and accessible native-looking icon/button states.
- [ ] Share short demo/test report and invite user to speak **three** ordinary German coding prompts (no retention by default).
- **Exit:** user go/revise/stop for MVP; no VAD, streaming or other scope expansion before review.

### T4 — Speech-quality checkpoint C
- [ ] Generate and version at least 20 Piper German code-task fixtures plus canonical reference transcripts; expand toward 50–100 after first results.
- [ ] Benchmark **raw and normalized** transcripts separately: WER, CER, technical-term recall, identifier exact-match and critical semantic errors.
- [ ] Measure p50/p95 processing latency with pinned hardware, model and sample lengths; report model-specific results rather than an unsupported performance claim.
- [ ] Invite 5–10 authentic user-recorded phrases with explicit optional consent and local deletion policy. Compare real versus synthetic audio and pronunciation of `JSON`, `YAML`, `kubectl`, `useEffect`, paths/identifiers.
- [ ] Gate policy: agree measured thresholds with user; any critical wrong command/path/identifier requires review even if aggregate WER is acceptable.
- **Exit:** shared benchmark evidence; user accepts thresholds or requests improvements.

### T5 — Release checkpoint D
- [ ] Run original regression suite, unit/integration tests, automated Playwright browser E2E, security/error scenarios and accessibility checks in CI.
- [ ] Run OpenSpec structure validation: `openspec validate add-web-voice-input --strict` (as supported by installed version).
- [ ] Run implementation-to-spec audit `/opsx:verify add-web-voice-input` if that optional OpenSpec skill is available; otherwise manually map each requirement to observed test evidence.
- [ ] Summarize tested OpenCode/plugin/browser versions, CI logs, compatibility, known limitations and proposed upstream patch/PR diff.
- **Exit:** explicit release and upstream-PR go/no-go. Do not archive or claim complete while required tests fail.

## Example CI gates (adapt commands to repository inventory)

1. Pull request: existing lint/typecheck/unit tests + deterministic audio integrations + browser fake-microphone smoke + `openspec validate`.
2. Nightly or locally with installed models: full German Piper/Whisper benchmark, optional platform matrix.
3. Pre-release: all automated test groups, tested target OpenCode web build, evidence review, `/opsx:verify` when available and user acceptance.

Commands for package scripts are deliberately not invented; discover those in `package.json`/repository first. `openspec validate` validates specs, NOT runtime behavior.

## Test evidence template

For each checkpoint append to `test-evidence.md`: date, gate, repository SHA(s), commands, browser/OS/Whisper/Piper/OpenCode/Playwright MCP versions, fixture list, pass/fail/skip counts, WER/CER/term score when applicable, CI/artifact link or log path, observed failure, owner and explicit go/no-go decision. Pending tests must remain `NOT RUN`.

## R0: container versus host test runner evaluation (required before T1/T2)

Prefer official **Playwright Test** Docker image with a pinned version for reproducible Chromium microphone tests. The image includes browser binaries and OS browser dependencies but **does not install the project's `@playwright/test` dependency**; use the repository lockfile (`npm ci`/`pnpm install --frozen-lockfile`, as applicable) and match package/image versions. The official **Playwright MCP** Docker image is a separate image with headless Chromium and MCP tools; do not confuse it with the test runner. Do not install Python Playwright simply for audio: the browser media capture is independent of the test runner language; retain TypeScript/Node.

Probe Chromium fake-audio flags with fixture WAV mounted as a real absolute path inside the container and verify it reaches `getUserMedia` -> existing STT -> editable draft. Track sample rate/mono/format and browser lifecycle. Reconcile container-to-OpenCode host networking (container `localhost` is not host `localhost`); prefer a temporary isolated Compose network or explicit host gateway. Verify browser microphone permission, fixture mount read-only, test output mount writable, and WebSocket access. Use `--init`; do not default to privileged container, host mic passthrough or `--no-sandbox` on unknown websites. Exact flags/config must be tested against pinned MCP version.

**Decision gate R0:** compare (1) local host Playwright Test, (2) official pinned Playwright Test image, (3) official MCP image for interactive smoke. Record compatibility, setup effort, CPU/audio limitations, and reliability. If MCP container cannot accept the fixture or launch config, use Test container for audio E2E and MCP container for UI smoke only, mark limitation honestly. Piper/Whisper could remain on host or existing runtime to reuse models; containerization of STT/TTS is optional and must be benchmarked, not mandated.

Test report includes mode, exact image tag/digest, installed Playwright version, mounted fixture path, app URL, executed command, results, and teardown. Container setup alone does not constitute passing an audio E2E test.
