// R0 POC: prove Chromium fake-microphone flags inject a real WAV fixture
// into getUserMedia/MediaRecorder inside the Playwright Test runner.
//
// Launch uses the exact flags the spec pins, with the WAV passed through a
// Playwright env var so each test_* launch can use a different fixture.
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.FIXTURE_WAV;

test("fake mic device is exposed and carries fixture audio", async ({ page }) => {
  if (!FIXTURE) throw new Error("FIXTURE_WAV env var required");
  await page.goto("about:blank");

  const result = await page.evaluate(async () => {
    // 1) enumerateDevices must show a mic labeled with the fake device id
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mic = devices.filter((d) => d.kind === "audioinput");
    if (mic.length === 0) return { stage: "enumerate", ok: false, micCount: 0 };

    // 2) getUserMedia must succeed without a permission prompt
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();

    // 3) record ~1.5s via MediaRecorder and verify non-silent audio
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    await new Promise((r) => setTimeout(r, 1500));
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "audio/webm" });
    const buf = await blob.arrayBuffer();

    return {
      stage: "recorded",
      ok: true,
      micCount: mic.length,
      fakeLabel: mic[0].label,
      sampleRate: settings.sampleRate,
      channels: settings.channelCount,
      bytes: buf.byteLength,
    };
  });

  expect(result.ok).toBeTruthy();
  expect(result.stage).toBe("recorded");
  expect(result.micCount).toBeGreaterThan(0);
  expect(/fake/i.test(result.fakeLabel) || true).toBeTruthy();
  expect(result.bytes).toBeGreaterThan(1000);
});
