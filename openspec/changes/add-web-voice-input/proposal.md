---
slug: add-web-voice-input
createdAt: 2026-10-31
---

# Proposal: Web voice input for opencode-voice

## Why
The existing opencode-voice plugin supports speech-to-text and Piper text-to-speech for the OpenCode TUI, but browser users of `opencode serve` need a microphone control in the lower prompt composer. German-language developer prompts with English technical identifiers need measurable, safe recognition before the message reaches a session.

## What changes
- Add an optional, minimally invasive browser capture/UI adapter to the existing plugin.
- Reuse the existing whisper.cpp or configurable STT endpoint, LLM normalization, logging, language setting, Piper and configuration capabilities. Do not reimplement them.
- Show a native-looking microphone action near the bottom composer, expose recording and transcription status and insert editable text into the active draft.
- Never submit a voice transcript to the agent automatically by default.
- Start with WebSocket upload of audio clips (not prematurely claiming real-time streaming); explore direct integration into the current OpenCode GUI plugin extension points before any upstream frontend patch.
- Add German mixed-language speech-quality benchmarks and browser E2E tests, reusing repository tests and benchmark tools when possible.
- Audit the actual OpenCode icon catalog and align to native icon/button APIs rather than adding Iconify without evidence of need.

## Scope
In: desktop browser recording, permissions, captured-audio transport, transcription and normalization, editable transcript, cancellation, error recovery, optional existing TTS compatibility, tests/CI and documentation.

Out of scope for MVP: continuous conversation, mandatory WebRTC, replacing the plugin's TUI UX, remote public exposure by default, unsolicited auto-submission and model training.

## Compatibility / impact
Keep existing TUI bindings, SoX capture, STT provider options, Piper output, normalization prompts and fallback behavior intact. Any refactor must be covered by regression tests.

## Open questions requiring implementation-time evidence
1. Does the target OpenCode version support mounting a GUI extension inside the composer via its plugin API? Verify source and running application; if not, document smallest supportable integration or upstream patch.
2. Is transcription callable from browser audio without starting an additional persistent whisper worker? Prefer reuse of existing command/API adapter.
3. Which exact native OpenCode icon catalog entries are suitable for mic, recording, stop, failure and permission denied?
4. What hooks and audio permissions does the installed Playwright MCP version support? Verify with an actual browser session.
