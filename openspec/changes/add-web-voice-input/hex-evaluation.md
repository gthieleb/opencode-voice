# Evaluation: `anomalyco/hex` as a possible replacement or STT backend

**Date:** 2026-11-15
**Status:** researched, decision = **deferred, not part of this change**
**Repo:** <https://github.com/anomalyco/hex> (MIT, same org as `anomalyco/opencode`)

This records why opencode-voice keeps its own browser capture, transport and
composer surface instead of adopting Hex, and what a later, optional
"STT backend swap" would look like. It is written so the research never has to
be repeated: every claim below cites either Hex's own documentation or a
GitHub issue/PR.

---

## 1. What Hex is

A Rust desktop application for local voice dictation (macOS, Windows, Linux).
Hold a key, speak, and the transcript is pasted into whatever app has focus.
Transcription is local (GGUF models: Parakeet, Whisper, Nemotron, …).

It is **not** a prompt router for a specific editor or browser session. Its
output contract is "paste into the focused text field".

## 2. The five surfaces, and what each needs

| Surface | What it does | Needs a running GUI? | Usable headless (CLI/web)? |
| --- | --- | --- | --- |
| `hex transcribe <file>` | Batch transcription of audio/video files | no | **yes** |
| `POST /transcriptions` (API 2) | WAV in, transcript out | no (`service --embedded`) | **yes** |
| `POST /control` (`hex dictation …`) | Drives the app's dictation | **yes** | macOS yes, Linux/Windows `404 control-unavailable` |
| `GET/POST /streams/{id}/…` | Live transcription of *another app's* pushed audio | **yes** (`503 model-not-loaded` otherwise) | no |
| `hex annotate send --to <session>` | Sends a screen capture to an OpenCode session | **yes** | no |

Sources: `docs/cli.md` (Transport, `dictation`, `annotate`), `docs/streams.md`
(Availability), `docs/specs/local-transcription-service.md` (embedded startup,
"The embedded helper never opens the microphone").

## 3. Why it does not replace this plugin

### 3.1 It refuses to own the microphone

The embedded service spec states it plainly:

> "Because the embedded service does not capture audio, it does not need
> microphone TCC identity."
> "The embedded helper never opens the microphone."

The microphone belongs to the host application. In our case the host is a
browser tab (`getUserMedia`), so Hex can never supply the capture half — the
half that is 80 % of W5.2.

### 3.2 There is no WebSocket input

`/streams` is HTTP POST for audio and Server-Sent Events for output. The only
WebSocket mention in the entire repository's issue tracker is #1401, which
asks for a *generic local destination for Annotate captures* (a Hermes gateway
speaking JSON-RPC over `/api/ws`) — not a Hex API. It is open, unimplemented,
and the maintainer's answer was a follow-up question, not a commitment.

So "push mic audio over a WebSocket to Hex" has no corresponding endpoint.

### 3.3 Live streaming requires the full app

`/streams` is served by the *running desktop app* with a GGUF model loaded by
dictation. `hex service --embedded` reports `partialTranscripts: false` and
does not serve `/streams` at all. On a headless box (no GUI, no audio device)
neither is reachable.

### 3.4 Session selection exists, but only for screen captures

`hex annotate send --to <session>` (and `--always` to save a per-site rule)
lets a person send a *capture* to an OpenCode session. Related open requests:
#1031 (send a capture to a *new* session) and #1401 (a configurable local
destination). It is screen-capture routing, requires the GUI process, and has
no browser-composer concept.

This is worth knowing: it proves the vendor is building session routing, so
the strategic overlap with our W5 work is real and should be revisited when
Hex ships something that reaches a browser composer. Today it does not.

## 4. "Cleanup with OpenCode" — what that actually is

Two different features are commonly conflated:

**a) `Clean up with Apple Intelligence`** (`labs.clean_up_with_apple_intelligence`,
macOS only, off by default). A single on-device pass over a dictation that its
mode does not otherwise rewrite: fixes misheard words, resolves spoken
self-corrections ("tuesday, no wait, wednesday" → "wednesday"), 2 s budget,
temperature 0.2. It deliberately runs *instead of* the OpenCode rewrite:

> "The stage is read in `Profiles::process_cancellable_with` … where the
> OpenCode rewrite would have run, though only when that rewrite is off."

It is not OpenCode, not available on Linux, and its own docs record it as not
yet observed in a real dictation on a Mac.

**b) The OpenCode rewrite and voice prompt.** Per-mode text rewriting through
an *already running* OpenCode service (`~/.local/state/opencode/service.json`,
HTTP, bearer/basic auth). "Voice prompt" lets a spoken phrase ("rewrite this")
replace the mode's rewrite for one request. Hex never starts OpenCode.

Neither feature decides *where text goes*: both produce a string that Hex
pastes into the focused field. Our value is the destination (this specific
composer in this specific session), which Hex does not model.

## 5. RAG

Hex ships **no retrieval-augmented generation**. What exists:

- `hex mcp`: read-only meeting search over stdio, **BM25** with stemming
  (k1 1.2, b 0.75) — a closed-corpus text search over your own transcripts.
- Labs › Meeting finished event: an SSE hint, not retrieval.

Explicitly not shipped, per `docs/features/meetings.md`:

> "Semantic search is not shipped. On-device candidates are Apple
> NaturalLanguage `NLContextualEmbedding` … embeddings wait until a query fails
> for lack of paraphrase."

Planned only for meetings, only on macOS, and only behind a real failing
query. Not applicable to prompt-in-code use.

## 6. Browser access — the one thing that landed

Issue #1755 (closed 2026-11-13) added a Labs toggle **Browser access to the
local API** (`labs.api_browser_access`, off by default) plus
`labs.api_browser_origins`:

- a listed origin's CORS preflight is answered without a token,
- responses carry `Access-Control-Allow-Origin` for that origin,
- every real request still needs the bearer token,
- only exact `http://` / `https://` origins, never `*`.

This means browser JavaScript can now call `POST /control` — to *drive Hex's
dictation*. That is the opposite direction of our transport: it lets a web app
ask Hex to record, not lets a web app deliver its own audio for transcription
and receive the text where it belongs.

## 7. If it is ever adopted: the only sane integration

A **STT backend swap inside the sidecar**, nothing more:

```
browser (getUserMedia)  ->  sidecar (lib/web-transport.js)
                                 |
                                 +--> lib/stt.js  (today: whisper-cli + sox)
                                 +--> optional: hex service --embedded
                                      POST /transcriptions (audio/wav)
```

Consequences, if that is ever built:

- `lib/stt.js` grows one adapter, selected by configuration.
- The user must install the `hex` binary; it is not on PATH in this repo's
  environment today (`which hex` → empty), so the default stays `whisper-cli`.
- Model quality/benchmarks become Hex's, not ours; our German mixed-language
  WER table (task 3.6) would then measure a third party's model.
- Nothing about capture, composer control, session targeting, preview,
  explicit submit, or the test gates changes.

## 8. Decision

**Deferred.** Not part of `add-web-voice-input`. Revisit only if one of these
becomes true:

1. Hex serves `/streams` (or any live audio input) from a headless service
   without a loaded dictation model.
2. Hex gains a browser-composer destination for transcripts.
3. We need a second STT engine and `whisper-cli` deployment has become the
   dominant install cost.

## 9. Sources

- `docs/cli.md`, `docs/streams.md`, `docs/specs/local-transcription-service.md`,
  `ROADMAP.md`, `AGENTS.md`, `docs/features/{labs,meetings,capture,README}.md`,
  `docs/opencode-compatibility.md`, `sdk/typescript/README.md`
- Issues/PRs: #1755 (closed), #1756 (the fix), #1757 (closed, not merged),
  #1401 (open), #1031 (open), #1224 (open, MCP for the control API)
