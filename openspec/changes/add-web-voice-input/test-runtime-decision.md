# Test runtime ADR — Playwright and audio (R0)

Status: PROPOSED; NOT TESTED. Owner: integration/debugger agent. Decision at R0.

## Options

| Option | Browser/test engine | Pros | Cons | Recommended use |
| --- | --- | --- | --- | --- |
| Host Node + @playwright/test | Host Chromium | Fast edit/debug; easier local browser | Host browser dependencies/versions vary | Local development fallback |
| Official `mcr.microsoft.com/playwright:v<version>-noble` | Docker Chromium + existing repo TS tests | Pinned reproducible browser and OS dependencies, CI-compatible | Need package install, mount fixtures, network to OpenCode | **Default audio E2E** after proof |
| Official `mcr.microsoft.com/playwright/mcp` | Docker MCP / headless Chromium | Existing upstream MCP packaging; good interactive UI smoke | Separate tool, headless-only per upstream docs; audio launch flags/fixtures must be tested | UI smoke; optional audio proof |
| Custom combined browser+Whisper+Piper image | Docker browser and native ML tools | Full environment reproducibility | Heavy images; architecture risk, model mounts, hardware dependence | Only if base alternatives fail |

## Default decision

Start with **TypeScript Playwright Test in pinned official browser image** and independent Playwright MCP container for interactive smoke. Preserve existing whisper.cpp/Piper runtime. Do not introduce Python Playwright packages. Docker is an execution environment, not a substitute for the repo's npm dependencies or actual audio test fixtures.

## Verification checklist
- [ ] Inspect installed Docker/Podman, repo package manager and existing test config
- [ ] Match image version to installed Playwright version, pin image digest when practical
- [ ] Container sees mounted WAV fixture at absolute path, no privileged host sound device
- [ ] Chromium fake audio configuration and microphone permission work
- [ ] Browser accesses OpenCode frontend and protected voice WebSocket across container network
- [ ] Audio passes transcription to editable draft; ensure no premature session submission
- [ ] Playwright MCP official image separately tested with same fixture: supported / unsupported / unknown
- [ ] Output screenshots/logs/benchmark artifacts exported from container
- [ ] Running containers and model processes cleaned up

## References
- https://playwright.dev/docs/docker
- https://github.com/microsoft/playwright-mcp#docker
- https://opencode.ai/docs/agents
- https://opencode.ai/docs/models

## Result (fill during R0)
- Tested versions/images: NOT RUN
- Working audio-injection approach: NOT RUN
- Selected option and rationale: PENDING
- User approval / blocker: PENDING
