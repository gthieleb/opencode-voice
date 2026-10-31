import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${process.env.FIXTURE_WAV ?? "tests/e2e/fixtures/german-tone-fixture.wav"}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
})
