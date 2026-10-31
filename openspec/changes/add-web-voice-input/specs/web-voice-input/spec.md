# Web Voice Input

## ADDED Requirements

### Requirement: Browser microphone control
The system SHALL expose a microphone button in the lower OpenCode web prompt composer when the web adapter is enabled, matching native styling and remaining keyboard/screen-reader accessible.

#### Scenario: Visible idle control
- **WHEN** a supported OpenCode web session opens
- **THEN** the composer shows an accessible microphone action in its idle state

#### Scenario: Permission denied
- **WHEN** the browser denies access to the microphone
- **THEN** the UI indicates the failure, offers recovery guidance, and preserves the draft

### Requirement: Draft-first transcription
The system SHALL display the transcribed text as an editable draft before the user explicitly submits it and SHALL NOT submit automatically by default.

#### Scenario: Successful transcription
- **WHEN** a recorded utterance is transcribed and normalized
- **THEN** the result is inserted into the correct active composer draft without invoking the session prompt endpoint

#### Scenario: Explicit submission
- **WHEN** the user reviews and submits the draft
- **THEN** the normal OpenCode composer submits the exact edited text once to the intended session

#### Scenario: Session switch during recognition
- **WHEN** the active session changes before a result returns
- **THEN** the old recording must not be inserted or submitted into the new session
