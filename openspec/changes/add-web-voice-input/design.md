# Design: Minimal web adapter around existing opencode-voice

## Verified upstream observations (2026-10-31)
- `renjfk/opencode-voice` documents SoX microphone capture, whisper.cpp or an OpenAI-compatible transcription API, LLM normalization with raw transcript fallback, and Piper TTS.
- OpenCode `packages/session-ui/src/components/message-part.tsx` imports `Icon` and `IconButton` from `@opencode-ai/ui`.
- OpenCode `packages/ui/src/icons/icon/icon.tsx` imports a local icon catalog and renders a generated in-DOM SVG sprite (`opencode-v2-icon-sprite`) using SolidJS. An experimental new-icons toggle exists.
- OpenCode's `packages/ui` package exports an `./icon` entry and packages additional app/file/provider icon sprites.
- This establishes native UI icon infrastructure; the original upstream artwork authors/complete dependency inventory have NOT been definitively audited. Do not assert that Iconify is or is not used in every other part of the monorepo.

## Integration strategy (ordered decision)
1. Pin and inspect an actual OpenCode version; inspect UI plugin capability and exact composer component, context hooks and icon catalog. Preserve the version and source links in implementation notes.
2. Prefer an official GUI plugin extension/API with a native composer action, using shared OpenCode UI tokens and icon components if supported.
3. If no composer extension exists, prepare the smallest upstream change introducing a composer action slot; keep its implementation separate from opencode-voice. Do not use brittle DOM injection in the production implementation.
4. Avoid an independent overlay UI or fork unless explicitly justified by the spike and accepted.

## Data flow
Browser `getUserMedia()` -> browser recorder -> mono PCM16-compatible WAV or conversion adapter -> authenticated same-origin WebSocket -> upload-size and duration checks -> existing STT entry point -> existing LLM normalization -> `{raw, normalized}` result -> editable composer draft -> ordinary OpenCode submit action by user.

The browser must not access provider credentials. Prefer an endpoint hosted in the same trusted OpenCode server origin. Do not open a public listening port by default. Preserve existing configuration; introduce only web-related settings as needed.

## Why WebSocket over WebRTC for MVP
Single-host prompt dictation requires no peer-to-peer media routing; WebSocket is simpler to secure, observe and test. Prefer completed-utterance audio transfer first. Incremental streaming/VAD is an optional subsequent enhancement only if benchmarks justify it.

## Proposed protocol
Client: `recording.start` (id, codec, sampleRate), binary audio chunks or bounded completed clip, `recording.finish`, `recording.cancel`.
Server: `recording.ready`, `transcription.started`, `transcription.final` (recordingId, rawText, normalizedText, detectedLanguage, timings), `transcription.error` (code, safeMessage).
Server MUST correlate responses to recording and session draft; refuse oversized/malformed recordings, stale or canceled IDs. Bind authentication/authorization to the host OpenCode session and origin; document reverse-proxy WebSocket behavior.

## Audio / compatibility details
Preferred capture: `getUserMedia` with explicit permission; use MediaRecorder only when server supports codec/container or convert deterministically into existing whisper-compatible format. Validate sample rate, mono channel, clipping, silence and output WAV correctness; never claim MediaRecorder emits PCM WAV on all browsers. Expose timeout, minimum duration and maximum size. Close mic tracks, sockets and temporary files on completion or cancel.

## German coding normalization
Default locale configurable `de`; support English coding expressions (`JSON`, `YAML`, `GitHub Actions`, `Kubernetes`, `kubectl`, `package.json`, `TypeScript`, `useEffect`). Preserve technical identifiers, case and punctuation when supported by audio/context. Do not fabricate exact names from ambiguous speech. Return both raw and normalized versions and provide preview/editing.

## Piper and audio output
Reuse existing Piper audio generation for offline reference fixtures and regression tests. For browser TTS, investigate an optional transport of generated audio, gated behind deliberate playback controls; autoplay restrictions apply. Automated tests validate WAV/audio artifacts; Playwright MCP audio-output loopback cannot be assumed.

## Icon / design system audit
Use OpenCode's native Icon/IconButton and design tokens where reachable. Identify exact icon names by inspecting catalog.ts, new-icons variant and composer references in the target revision. Audit provenance and licenses of the chosen assets. Test visual states idle, microphone permission request, recording, transcribing, ready, denied, error. Accessible text, button titles, focus, disabled state, responsive layout and dark/light themes required. Avoid adding Iconify or a new icon set unless native icon catalog cannot supply the desired icons.

## Playwright / audio test plan
A. Unit/integration: audio validation, transport state machine, normalization fallback, concurrent recording IDs, auth and cleanup.
B. Browser E2E (Playwright Test): use Chromium fake media flags and fixture-based audio capture; microphone mock helper is optional after pinning and testing compatibility with AudioWorklet/MediaRecorder.
C. MCP smoke test: launch Playwright MCP with Chromium flags `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-audio-capture=/absolute/path.wav`; grant microphone permissions; verify actual UI and session payload. This is a hypothesis until executed.
D. Real microphone exploratory tests: explicitly request user consent and ten German coding utterances; never silently retain original recordings.
E. TTS: verify Piper generated audio's format and duration; optionally perform offline round-trip ASR, but treat TTS-to-ASR scores as synthetic, not human accuracy evidence.

## Quality metrics (initial targets, to calibrate)
Word error rate <=10%; technical term accuracy >=95%; critical identifier accuracy >=90%; unintended session submissions = 0; p95 transcription runtime <=3 seconds for fixed fixture/model/hardware conditions. Keep the raw ASR versus normalized scoring separate and publish recordings' provenance and conditions.

## References
- https://github.com/renjfk/opencode-voice
- https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/icons/icon/icon.tsx
- https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/icons/catalog.ts
- https://github.com/anomalyco/opencode/blob/dev/packages/session-ui/src/components/message-part.tsx
- https://github.com/anomalyco/opencode/blob/dev/packages/ui/package.json
- https://github.com/microsoft/playwright-mcp
- https://github.com/tsuemura/playwright-audio-mocking
- https://openspec.dev/docs/schemas/spec-driven
