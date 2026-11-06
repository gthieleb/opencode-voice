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

**RESOLVED 2026-11-06, rootless.** `sudo` stayed unavailable (`no-new-privileges`);
the libraries were materialized as unprivileged Debian packages instead:

```bash
mkdir -p /tmp/opencode/pw-libs/debs /tmp/opencode/pw-libs/extracted
cd /tmp/opencode/pw-libs/debs
for p in libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libxcomposite1 \
         libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2t64 \
         libatspi2.0-0t64 libxrender1 libxi6 libxres1; do
  apt-get download "$p"
done
for d in *.deb; do dpkg -x "$d" /tmp/opencode/pw-libs/extracted/; done
```

Run any Playwright invocation with:

```bash
LD_LIBRARY_PATH=/tmp/opencode/pw-libs/extracted/usr/lib/x86_64-linux-gnu \
FIXTURE_WAV=$PWD/tests/e2e/fixtures/german-tone-fixture.wav npx playwright test <spec>
```

- `/tmp/opencode/pw-libs` is volatile (cleared on reboot/eviction) — re-run the
  snippet above when the path is empty; the package set is also recorded in
  `test-evidence.md` (R0 gate-in block, 2026-11-06).
- Caveat: pinned Playwright chromium builds are validated against distro
  `install-deps` sets; if a future chromium bump introduces new missing libs,
  extend the `apt-get download` list (find them with
  `ldd <chromium binary> | grep 'not found'`).

**Second root cause fixed:** the POC spec used `about:blank`, which is not a
secure context, so `navigator.mediaDevices` is `undefined` regardless of launch
flags (this build also treats `data:` URLs as unsecure). The spec now serves a
throwaway page from `http://127.0.0.1:<ephemeral>` — secure in Chromium.

**Evidence after resolution (2026-11-06):** the command above runs
`poc-fake-mic` → **1 passed** with `stage: recorded` and non-trivial `bytes`;
`ldd` against the chromium binary shows no missing libraries.

## R0 checkpoint status

- 0b.1 ✔ (docker absent, host facts captured)
- 0b.2 ✔ compared (table above), decision: host-first + later-optional container
- 0b.3 ✔ **COMPLETE (2026-11-06)** — fixture injection PROVEN on host: POC
  passes with `stage: recorded` after B1 + secure-context fixes (test-evidence.md)
- 0b.4 ✖ blocked (no docker) — revisit only if user installs a runtime
- 0b.5 ✔ decision + artifacts written (this file)
- 0b.6 ✔ **R0 checkpoint REACHED (2026-11-06)**: working fake-mic/fixture
  prototype passing; T2 unblocked.
