# Voice E2E Testing

## ADDED Requirements

### Requirement: Real browser-path end-to-end verification
The test suite SHALL exercise the browser microphone API, transport, speech pipeline, editable composer and final OpenCode session submission, rather than asserting mocked transcript UI alone.

#### Scenario: Fake microphone fixture
- **WHEN** Chromium receives a deterministic German coding WAV via a fake audio input device
- **THEN** Playwright tests verify recognition in the draft and absence of premature session submit

#### Scenario: Submit only on approval
- **WHEN** the test edits the recognized text and presses the normal send action
- **THEN** the targeted OpenCode session receives exactly the edited text once

### Requirement: Playwright MCP feasibility verification
The project SHALL test, not assume, whether the installed Playwright MCP launcher can pass fake-media browser flags and audio fixture input.

#### Scenario: MCP configured audio
- **WHEN** a Playwright MCP-controlled Chromium session opens with fake microphone arguments
- **THEN** the test logs whether `getUserMedia` captured the intended fixture and documents launcher configuration and limitations

### Requirement: TTS testing boundaries
The suite SHALL verify Piper output artifacts and only claim browser-audio-output E2E if a working playback capture mechanism has been demonstrated.

#### Scenario: TTS fixture synthesis
- **WHEN** a text reference is synthesized with Piper
- **THEN** automated checks verify audio format, sample rate, duration and non-silence
