#!/usr/bin/env bash
# container e2e stack driver (R0.2). executed in the user's terminal: agents
# cannot run podman in their sandbox (userns clone is blocked there).
# deterministic + idempotent: everything is prefixed "voicetest".
#
# usage:
#   test/e2e/run-container.sh              full stack (web + sidecar + e2e)
#   test/e2e/run-container.sh --poc-only   only tests/e2e/poc-fake-mic.spec.js
#                                          (no opencode service needed)
#   test/e2e/run-container.sh --down       stop + remove the stack
#   test/e2e/run-container.sh --clean      --down + remove the built image
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

COMPOSE_FILE="test/e2e/compose.yaml"
PROJECT="voicetest"
DIGESTS_FILE="test/e2e/digests.txt"
OPENCODE_IMAGE="guarnacciaa/opencode-v2:2.0.29"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:1.64.1-noble"
SIDECAR_IMAGE="voicetest/voice-sidecar:e2e"
WEB_PORT="${VOICETEST_WEB_PORT:-18096}" # host 4096 is held by the live session

log() { printf '[voicetest] %s\n' "$*"; }
die() { printf '[voicetest] ERROR: %s\n' "$*" >&2; exit 1; }

command -v podman >/dev/null 2>&1 || die "podman not found; install podman >= 5 (no docker required)"
podman info >/dev/null 2>&1 || die "podman info failed; rootless podman setup incomplete?"

# compose driver probing: `podman compose` needs an external provider
# (docker-compose v2 or podman-compose); fall back to podman-compose, else
# print three explicit podman run commands for manual execution.
if podman compose version >/dev/null 2>&1; then
  compose() { podman compose -f "$COMPOSE_FILE" -p "$PROJECT" "$@"; }
  PROVIDER="podman compose"
elif command -v podman-compose >/dev/null 2>&1; then
  compose() { podman-compose -f "$COMPOSE_FILE" -p "$PROJECT" "$@"; }
  PROVIDER="podman-compose"
else
  PROVIDER="none"
fi

print_manual_full() {
  cat <<EOF
[voicetest] no compose provider found (neither 'podman compose' nor podman-compose).
[voicetest] run these commands manually from the repo root ($PWD):

  podman network create voicetest

  podman build -f test/e2e/sidecar.Dockerfile -t ${SIDECAR_IMAGE} .

  podman run -d --name voicetest-opencode-web --network voicetest \\
    -p ${WEB_PORT}:4096 \\
    -e OPENCODE_PASSWORD=e2e-voice-secret \\
    -e OPENCODE_HOSTNAME=0.0.0.0 -e OPENCODE_PORT=4096 \\
    -v "$PWD":/workspace:ro \\
    -v "$PWD/test/e2e/opencode-config":/root/.config/opencode \\
    ${OPENCODE_IMAGE}

  podman run -d --name voicetest-voice-sidecar --network voicetest \\
    -e VOICE_TOKEN=e2e-voice-token -e VOICE_PORT=9100 \\
    -e FAKE_TRANSCRIBE=1 -e VOICE_TMPDIR=/tmp/voice \\
    ${SIDECAR_IMAGE}

  podman run --rm --network container:voicetest-voice-sidecar \\
    -v "$PWD":/workspace \\
    -v voicetest-node_modules:/workspace/node_modules \\
    -w /workspace \\
    -e BASE_URL=http://opencode-web:4096 \\
    -e SIDECAR_WS=ws://127.0.0.1:9100 \\
    -e VOICE_TOKEN=e2e-voice-token \\
    -e FIXTURE_WAV=/workspace/tests/e2e/fixtures/german-tone-fixture.wav \\
    -e CI=1 -e E2E_HOST=1 \\
    ${PLAYWRIGHT_IMAGE} \\
    bash -lc "npm ci --no-audit --no-fund && npx playwright test"

[voicetest] teardown afterwards:
  podman rm -f voicetest-opencode-web voicetest-voice-sidecar
  podman network rm voicetest
  podman volume rm voicetest-node_modules
EOF
}

print_manual_poc() {
  cat <<EOF
[voicetest] no compose provider found; run this single command manually from
[voicetest] the repo root ($PWD):

  podman run --rm -v "$PWD":/workspace -w /workspace \\
    -e FIXTURE_WAV=/workspace/tests/e2e/fixtures/german-tone-fixture.wav \\
    -e CI=1 \\
    ${PLAYWRIGHT_IMAGE} \\
    bash -lc "npm ci --no-audit --no-fund && npx playwright test tests/e2e/poc-fake-mic.spec.js"
EOF
}

teardown() {
  local clean="$1"
  if [ "$PROVIDER" = "none" ]; then
    cat <<EOF
[voicetest] no compose provider found; tear the manual stack down with:
  podman rm -f voicetest-opencode-web voicetest-voice-sidecar
  podman network rm voicetest
  podman volume rm voicetest-node_modules
EOF
    return 0
  fi
  compose down --volumes --remove-orphans || log "down reported nothing to remove"
  if [ "$clean" = "yes" ]; then
    podman rmi "$SIDECAR_IMAGE" 2>/dev/null || log "sidecar image already absent"
    # the pinned playwright image is kept cached on purpose; remove by hand if
    # disk matters: podman rmi ${PLAYWRIGHT_IMAGE}
    log "cleaned stack + built sidecar image (playwright image kept cached)"
  else
    log "stack down"
  fi
}

record_digests() {
  {
    printf '# digest pins recorded by test/e2e/run-container.sh (%s)\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    podman images --digests --format '{{.Repository}}:{{.Tag}} {{.Digest}}' |
      grep -E 'guarnacciaa/opencode-v2|mcr\.microsoft\.com/playwright|voicetest/voice-sidecar' |
      sort -u || true
  } >"$DIGESTS_FILE"
  log "digest pins written to ${DIGESTS_FILE}"
}

mode="${1:-full}"
case "$mode" in
--down) teardown no; exit 0 ;;
--clean) teardown yes; exit 0 ;;
--poc-only) ;;
full) ;;
*) die "usage: test/e2e/run-container.sh [--poc-only|--down|--clean]" ;;
esac

log "podman $(podman --version | awk '{print $3}') via provider: ${PROVIDER}"

if [ "$mode" = "--poc-only" ]; then
  if [ "$PROVIDER" = "none" ]; then
    print_manual_poc
    exit 1
  fi
  # the e2e service shares the sidecar netns, so that one container must run
  # even for the POC; opencode-web is NOT started (spec is self-contained)
  compose up -d voice-sidecar
  trap 'compose rm -sf voice-sidecar >/dev/null 2>&1 || true' EXIT
  compose run --rm --no-deps e2e \
    bash -lc "npm ci --no-audit --no-fund && npx playwright test tests/e2e/poc-fake-mic.spec.js"
  record_digests
  exit 0
fi

if [ "$PROVIDER" = "none" ]; then
  print_manual_full
  exit 1
fi

compose run --rm e2e
record_digests
log "done; web ui (manual browser checks): http://localhost:${WEB_PORT}/ (user opencode / e2e-voice-secret)"
