# Test runtime decision (R0) — 2026-10-31

## Environment facts (probed 2026-10-31)

| Probe | Result |
| --- | --- |
| Docker / Podman | **NOT INSTALLED** (`docker`: command not found, `podman`: absent) |
| Host OS / arch | linux x86_64, 2 CPU, 15 GB RAM |
| Node | v24.22.1 (npm 12.2.1) |
| `@playwright/test` | 1.64.1 added as devDependency; `npx playwright install chromium` ✔ → chromium-1248 + headless shell in `~/.cache/ms-playwright` |
| Chromium launch | ✖ fails: `libnspr4.so` missing (OS-level browser deps); `npx playwright install-deps` fails: `sudo` blocked by `no-new-privileges` flag in this shell |
| OpenCode voice repo runtime | plain ESM JS, `node --test`, oxlint/oxfmt, no TS toolchain |

## Options compared (task 0b.2)

| Option | Status | Notes |
| --- | --- | --- |
| (2) Official pinned Playwright Test image (container) | **BLOCKED: no docker/podman on host** | would be the reproducible default per spec; requires container runtime install (user approval) |
| (3) Official Playwright MCP Docker image | **BLOCKED: no docker** | task 0b.4 smoke unanswerable until a container runtime exists |
| (1) Host Node Playwright Test runner | **PARTIAL** | binaries ✔, config + fixture + spec authored; only OS system libs missing (one sudo command) |

## Decision (provisional, pending user input on blocked items)

**Primary: Host Node Playwright Test 1.64.1 (option 1), pinned via package.json devDependency.**
Rationale: only immediately available option; keeps tests in the repo's existing Node/esm tooling (no TS added — config + specs authored as ESM JS); containerization postponed, not abandoned.

**Deliberately deferred (needs user go):**
- Docker or podman install → would re-open options (2)/(3) for reproducible Chromium E2E (recommended later — reproduce matrix from official Playwright image digest once available).
- MCP-container audio smoke (0b.4) unanswerable until then; contract: any containerization of E2E lands only as a separate decision with digest pinning.

Artifacts produced for the POC (option 1), reusable either way:
- `tests/e2e/fixtures/make-fixture.js` → deterministic mono 16 kHz 16-bit WAV tone fixture (`german-tone-fixture.wav`), no model dependency
- `tests/e2e/poc-fake-mic.spec.js` → enumDevices + getUserMedia + MediaRecorder (1.5 s) proof spec
- `playwright.config.js` → headless Chromium with exactly the pinned flags: `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-audio-capture=<wav>`, `--autoplay-policy=no-user-gesture-required`

## Blocker B1 (T2 needs it): Chromium OS libs on host

Blocked by privileges; user must run once (their shell/sudo):
`sudo npx playwright install-deps chromium` (or minimal `sudo apt-get install -y libnspr4 libnss3 …`).
Evidence after: rerun `FIXTURE_WAV=$PWD/tests/e2e/fixtures/german-tone-fixture.wav npx playwright test poc-fake-mic` — expect 1 passing test with `stage: recorded` result and non-trivial `bytes`.

## R0 checkpoint status

- 0b.1 ✔ (docker absent, host facts captured)
- 0b.2 ✔ compared (table above), decision: host-first + later-optional container
- 0b.3 ⏳ fixture/config/spec ready; execution blocked on B1
- 0b.4 ✖ blocked (no docker) — revisit only if user installs a runtime
- 0b.5 ✔ decision + artifacts written (this file)
- 0b.6 🟡 R0 checkpoint partially reached: fake-mic POC demonstrable **after B1**; T2 blocked until then, T1 (pure Node/WS/STT contract) MAY proceed in parallel — B1 is a browser-only blocker
