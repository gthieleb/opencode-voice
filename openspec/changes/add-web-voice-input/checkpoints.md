# MVP and communication checkpoints

This document defines user-visible review gates for `add-web-voice-input`. Tasks are not approval by themselves. No user speech recordings are retained without permission.

| Gate | Timing | Demonstrable outcome | Communication / decision |
|---|---|---|---|
| A — Architecture | After repo, OpenCode UI and icon audit | Baseline tests, exact reuse points, GUI API proof/fallback | Brief findings, risks and minimal implementation choice; get approval for any OpenCode patch |
| B — MVP | After minimal browser adapter | Native-looking mic in bottom composer → audio via WebSocket → existing STT → editable draft → manual send, with TUI regression checks | Live demo or screenshots and 3 user utterances; go/no-go before complexity |
| C — Quality | After Piper + Playwright test suite | Repeatable audio E2E, raw/normalized comparison, WER/CER/technical-term report, error and session tests | Ask for 5–10 real German developer prompts; consent to retain fixtures; agree release thresholds |
| D — Release | After CI and docs | Test results, compatibility matrix, security and accessibility review, proposed PR diff | Release go/no-go and explicit upstream PR decision |

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
