import { defineConfig } from "@playwright/test";

// E2E_HOST=1 marks the containerized stack run (test/e2e/compose.yaml):
// host-only specs are skipped there (w51-spike spawns the host `opencode`
// binary and relies on the host OS-lib workaround). local runs are unchanged.
// BASE_URL sets the served web app; SIDECAR_WS is read by specs directly.
const inContainerStack = process.env.E2E_HOST === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  ...(inContainerStack ? { testIgnore: ["**/w51-spike.spec.js"] } : {}),
  use: {
    headless: true,
    baseURL: process.env.BASE_URL,
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${process.env.FIXTURE_WAV ?? "tests/e2e/fixtures/german-tone-fixture.wav"}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});
