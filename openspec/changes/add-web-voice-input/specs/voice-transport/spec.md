# Voice Transport

## ADDED Requirements

### Requirement: Reuse existing STT backend
The web integration SHALL invoke the existing whisper.cpp or configured remote STT adapter and existing LLM normalization/fallback rather than a duplicate ASR pipeline.

#### Scenario: Existing STT configured
- **WHEN** browser audio reaches the backend in a supported validated format
- **THEN** the shared STT path transcribes and normalizes it, returning raw and normalized outputs

#### Scenario: Normalization service unavailable
- **WHEN** the normalization endpoint fails
- **THEN** the raw transcript remains available as the draft, with an appropriate status indication

### Requirement: Bounded, secured WebSocket transport
The system SHALL authenticate browser connections, enforce origin/session restrictions, validate payloads and bound size/time/capacity; WebSocket is the default MVP transport.

#### Scenario: Invalid or oversized audio
- **WHEN** an unsupported codec or oversized audio payload is sent
- **THEN** the backend rejects it with a safe structured error and does not transcribe it

#### Scenario: Cancelled recording
- **WHEN** the user cancels the recording
- **THEN** the pipeline releases resources and ignores any late results

### Requirement: Maintain TUI compatibility
The system SHALL preserve existing SoX/TUI entrypoints, config, commands and Piper behavior.

#### Scenario: Existing TUI workflow
- **WHEN** the web adapter is disabled
- **THEN** prior TUI voice recording and playback behave as before
