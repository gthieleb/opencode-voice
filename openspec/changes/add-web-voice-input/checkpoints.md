# MVP and communication checkpoints

This document defines user-visible review gates for `add-web-voice-input`. Tasks are not approval by themselves. No user speech recordings are retained without permission.

| Gate | Timing | Demonstrable outcome | Communication / decision |
|---|---|---|---|
| A — Architecture | After repo, OpenCode UI and icon audit | Baseline tests, exact reuse points, GUI API proof/fallback | Brief findings, risks and minimal implementation choice; get approval for any OpenCode patch |
| B — MVP | After minimal browser adapter | Native-looking mic in bottom composer → audio via WebSocket → existing STT → editable draft → manual send, with TUI regression checks | Live demo or screenshots and 3 user utterances; go/no-go before complexity |
| C — Quality | After Piper + Playwright test suite | Repeatable audio E2E, raw/normalized comparison, WER/CER/technical-term report, error and session tests | Ask for 5–10 real German developer prompts; consent to retain fixtures; agree release thresholds |
| D — Release | After CI and docs | Test results, compatibility matrix, security and accessibility review, proposed PR diff | Release go/no-go and explicit upstream PR decision |

## Gate A decision — RECORDED 2026-10-31

**Decision: PATH A — plugin-only, no OpenCode patch/fork for MVP.** (User approval, single word "A".)

- Web UI built as an **OpenCode GUI plugin** (`@opencode/plugin/gui`): a `ComposerPill` ("Voice", reactive state icon) with a custom popover (`menu(input)`) using `ctx.ui` components (IconButton etc.) for record/stop/cancel and the editable-composer flow; composer draft written via `ctx.screen.current()?.composer.setText/insert`.
- Mic icon shipped as plugin-owned MIT inline SVG (catalog has no `mic`/`record`/`play`; use native `waveform` for level meter).
- Manual submit stays the user's action in the existing native composer send; no auto-submit.
- No footer-row parity, no `ComposerEditorActionSlot`, no fork in MVP. Upstream patch/PR remains an optional post-MVP item at Gate D (tasks 4.3/4.5), never automatic.
- Evidence: `evidence/t0-inventory.md` (verified against `anomalyco/opencode` dev @ dc4775a6; PRs #59469/#59764; risk note: young API, MVP spike validates `ComposerPill` + `composer.setText` on the pinned web build before building the real voice surface).
- Design.md integration strategy adjusted accordingly (patch escalation only on spike failure, with evidence).

**Gate A cross-check (T0 artifact):** `test-evidence.md` T0 entry recorded; baseline green 20/20; Meta-ignores via `.prettierignore` explain check-greens on imported docs.

## Gate A amendment — vehicle ruling (RECORDED 2026-11-07, user decision)

**Spike W5.1 finding F2 (load-bearing):** on pinned v2.2.5 — and on latest
dev `0.0.0-dev-904` (probed 2026-11-06 in an isolated instance) — the served
**web app has no plugin bridge**: GUI plugin bundles are served
(`/api/plugin/gui` → 200) but window entries never evaluate; the composer
pill row renders empty. GUI-plugin windows are **desktop-only** on
config plugins (SDK docs confirm: "A plugin from the config runs only in the
desktop app"). The web bundle already ships the consumer/evaluator machinery
— only the host-context bridge property is missing (evidence chain in
`test-evidence.md` W5.1 block + W5.1 report; regression-pinned in
`tests/e2e/w51-spike.spec.js`).

**Decision (user, 2026-11-07): HYBRID.**
- PATH A stays: plugin-only, no OpenCode patch/fork.
- W5.2/W5.3 code is **vehicle-agnostic**: targets the verified bridge API,
  contract-tested in Node (real bundle through the app's CJS evaluator);
  runs unmodified on desktop today and on web the moment the bridge lands.
- **Upstream unblock:** issue filed at `anomalyco/opencode` —
  **https://github.com/anomalyco/opencode/issues/62561** (full evidence
  package + minimal-fix direction). No fork.
- No desktop app on this machine → W5.4 demo path is two-layer:
  (L1) audio-pipeline browser E2E in plain Chromium (capture client + real
  sidecar + STT stub) runnable now; (L2) app-integration E2E (pill/draft)
  gated on a web-bridge release or a desktop install; the F2 pin flips when
  either becomes available.
- Gate B (MVP demo) therefore demonstrates: L1 audio pipeline + contract
  surface + regression pin; the in-app web demo is explicitly a
  release-gated item, recorded at Gate B.

## MVP acceptance criteria


1. Works in the target `opencode serve` web frontend without altering the existing TUI flow.
2. An accessible microphone control appears beside the prompt field, using verified OpenCode-native icon and visual conventions where possible.
3. Browser permission/record/stop/cancel flows work; transport handles errors, limits payload size and restricts access.
4. Existing Whisper/STT and configured normalization paths process recorded audio; no duplicate STT implementation.
5. Raw and optionally normalized German coding text is shown before sending; user may edit or discard. No voice text is auto-submitted.
6. The submitted text reaches only the current session, and only on explicit user action.
7. Automated smoke E2E uses synthetic/fake browser mic audio and verifies no premature session submission.
8. Existing TUI tests still pass, or baseline exceptions are transparently documented.

## Reporting format for each gate

- **Implemented:** evidence (commit/hash, commands, screenshots or logs).
- **Tested:** actual environment and outcomes; distinguish untested items.
- **Risks / open questions:** facts, impact and mitigation.
- **Decision requested:** go, revise or stop, with smallest concrete option set.

## Scope guardrails

MVP excludes continuous conversation, live streaming recognition, WebRTC, always-listening mode and automatic session submission. Additional features require separate approval after Gate B.

## Test gates, not just communication gates

See [`test-plan.md`](test-plan.md) for mandatory T0–T5 timing, executable checks and exit conditions. Test evidence is maintained in [`test-evidence.md`](test-evidence.md). Mapping: A=T0, B=T3, C=T4, D=T5, with technical test gates T1 and T2 before MVP. OpenSpec structural `validate` and optional implementation `/opsx:verify` **do not replace executable unit/E2E/audio tests**.

## Model and spending checkpoints

Model tier assignments, escalation rules and per-task costs are tracked in [`model-routing.md`](model-routing.md) and [`model-evidence.md`](model-evidence.md). Gate A confirms baseline tiers and providers; Gate B reports cheap-model task acceptance and escalations; Gate C separates speech recognition quality from coding-agent quality; Gate D includes independent L3 review and actual total cost. L4 requires explicit consent.

## Additional mandatory checkpoints

**M0 (model discovery, first):** inspect project-enabled models and existing agents before assignment, report alternative models and cheapest safe configuration; no guessed IDs or premium calls. Propose creation of scoped task agents when useful; user approves additions that alter their runtime config.

**R0 (test runtime decision, before audio/browser integration):** evaluate Playwright Test image, Playwright MCP image and host Node runner; demonstrate fake audio injection or record a reproducible blocker. Pin versions and determine whether audio E2E lives in a container. Revisit at T2 on any browser/MCP capability mismatch.

Order: M0 -> T0/A -> R0 -> T1 -> T2 -> T3/B -> T4/C -> T5/D. Test output and model-routing evidence accompany every user communication gate.

**A1 (optional, at MVP T3/B or completion T5/D):** Assess which project `voice-*` agents deserve promotion into global, generic, prefix-free agents; user must approve naming and installation. Retain project agents to avoid breaking references. See [`agent-promotion.md`](agent-promotion.md).
