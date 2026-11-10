# Container E2E stack (R0.2)

Podman-only stack exercising opencode web v2 + the voice sidecar + the
Playwright runner from `openspec/changes/add-web-voice-input/test-runtime-decision.md`
(revision R0.2: container-first, host playwright demoted to fallback).

**Constraint:** agents in the OpenCode sandbox cannot execute containers
(`no-new-privileges` blocks the userns clone). Everything here is authored and
statically validated (YAML via python, bash via `bash -n`); **the user runs
the stack** and shares artifacts (`test-results/`, `digests.txt`).

## One command

```sh
test/e2e/run-container.sh              # full stack, then the test suite
```

flags:

| flag         | effect                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_     | full stack: `opencode-web` + `voice-sidecar` + `e2e`, `compose run --rm e2e` semantics, digest pins recorded to `test/e2e/digests.txt`            |
| `--poc-only` | only `tests/e2e/poc-fake-mic.spec.js` (0b.3 acceptance); starts just the sidecar container (the e2e container shares its netns), not opencode-web |
| `--down`     | stop + remove the stack                                                                                                                           |
| `--clean`    | `--down` + remove the built sidecar image (the pinned playwright image stays cached)                                                              |

A full run leaves the stack up: `compose run --rm e2e` only removes the test
container itself, while `opencode-web` + `voice-sidecar` keep running (`--down`
removes them).

The wrapper probes a compose driver (`podman compose` provider, then
`podman-compose`); if neither exists it prints the three explicit
`podman run` commands to execute by hand.

## Prerequisites

- podman ≥ 5, rootless (verified 5.7.0 on this machine; docker not required)
- a compose provider for `podman compose` (docker-compose v2 or
  podman-compose), else read the printed manual commands
- disk: the playwright image is ~2 GB; first run also builds the sidecar image
- no host `npm ci` needed — the e2e container installs from the repo lockfile

## Services

| service         | image / build                                                                                                                   | notes                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opencode-web`  | `guarnacciaa/opencode-v2:2.0.29` (verified via Docker Hub tags API 2026-11-10; newest overall is 2.2.7, newest 2.0.x is 2.0.32) | basic auth `opencode` / `e2e-voice-secret`, published on **host 18096** (host 4096 is held by the live OpenCode session; override `VOICETEST_WEB_PORT`)                                                                                                                                                                                                                                        |
| `voice-sidecar` | built from `test/e2e/sidecar.Dockerfile` (node:24-slim + repo `lib/`, `bin/`, lockfile)                                         | `bin/voice-sidecar.js` runs the real transport with a **no-LLM passthrough normalizer** and (compose default) `FAKE_TRANSCRIBE=1`: the STT stub answers a fixed German mixed-language string, so no whisper binary/model/credentials are needed. Unset `FAKE_TRANSCRIBE` for the real `transcribeWavFile` path — it will fail with `STT_ERROR` until whisper-cli + a model exist in the image. |
| `e2e`           | `mcr.microsoft.com/playwright:1.64.1-noble`                                                                                     | runs `npm ci` (lockfile, into the `node_modules` volume — the host checkout's node_modules is never touched) and `npx playwright test`                                                                                                                                                                                                                                                         |

## What gets asserted

- `tests/e2e/poc-fake-mic.spec.js` — Chromium fake-mic fixture injection
  (`enumerateDevices` / `getUserMedia` / `MediaRecorder` produce non-silent
  audio from `tests/e2e/fixtures/german-tone-fixture.wav`).
- `tests/e2e/w52-capture.spec.js` — capture contract against the real
  `createVoiceTransport` in-process (start/finish → `transcription.final`);
  its host OS-lib gate (`assertBrowserContract()`) early-returns on
  `E2E_HOST=1` — the `/tmp/opencode/pw-libs` contract cannot hold inside the
  pinned image — so the spec runs in the container like the POC spec.
- `tests/e2e/w51-spike.spec.js` — **skipped in the container** (`E2E_HOST=1`
  branch in `playwright.config.js`): it spawns the host `opencode` binary and
  needs the host OS-lib workaround, which the container must not rely on.
- `opencode-web` healthcheck (basic-auth GET on the web app root) gates the
  e2e start; the sidecar healthcheck proves the ws port answers 426 to plain
  http. `BASE_URL` / `SIDECAR_WS` are already exported for the upcoming
  real-UI spec driving the served app + sidecar.

## Digest pinning

After every run the wrapper writes the pulled/built image digests to
`test/e2e/digests.txt` (repo file, deliberately not under `.superpowers/`).
After the first successful full run, commit that file — it feeds
"Digest pinning" in `test-runtime-decision.md` §Revision R0.2.

## Deliberate deviations from the task brief (and why)

1. **`SIDECAR_WS=ws://127.0.0.1:9100` instead of `ws://voice-sidecar:9100`.**
   `lib/web-transport.js` hardcodes the loopback bind
   (`server.listen(port, "127.0.0.1")`) as a security invariant. A sidecar on
   its own netns is therefore unreachable from the e2e container by service
   name — so the e2e container shares the sidecar's network namespace
   (`network_mode: "service:voice-sidecar"`), where the loopback URL works and
   `opencode-web` still resolves through the voicetest DNS.
2. **Published web port 18096 instead of 4096:4096.** The live OpenCode
   session serves 4096 on this host; a second bind would fail the whole stack.
   Container port stays 4096; override with `VOICETEST_WEB_PORT`.
3. **Healthcheck target `/` instead of `/api/info`.** The endpoint list of the
   pinned image tag cannot be verified offline; a 404 would deadlock the stack
   on `depends_on: service_healthy`. The web app root under the same basic
   auth is version-proof (wget fallback included for curl-less images).
4. **`node_modules` as a named volume.** The brief's "anonymous volume" is
   materialized as a project-scoped named volume (same isolation, removable
   via `compose down`).

## Environment variables (container side)

`BASE_URL`, `SIDECAR_WS`, `VOICE_TOKEN`, `FIXTURE_WAV`, `CI`, `E2E_HOST`
(see `compose.yaml`), plus the sidecar's `VOICE_PORT` / `VOICE_TOKEN` /
`ALLOWED_ORIGINS` / `VOICE_TMPDIR` / `VOICE_STT_LANGUAGE` / `FAKE_TRANSCRIBE`
(see `bin/voice-sidecar.js` header comment). Host side: `VOICETEST_WEB_PORT`.

## Troubleshooting

- `podman compose` prints "no compose provider" → install podman-compose or
  docker-compose v2, or use the printed manual commands.
- Port conflict on 18096 → `VOICETEST_WEB_PORT=… test/e2e/run-container.sh`.
- Tests fail with pull/registry errors → rerun; `npm ci` inside the e2e
  container needs outbound network (the compose network is intentionally not
  `internal: true`).
- `test-results/` appears at the repo root after runs (gitignored).
