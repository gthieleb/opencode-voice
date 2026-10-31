# German Coding Transcription

## ADDED Requirements

### Requirement: German with embedded English developer terminology
The system SHALL allow `de` configuration and process mixed-language programming expressions while preserving recognizable technical identifiers and avoiding unsupported guesses.

#### Scenario: Mixed-language prompt
- **WHEN** a German utterance includes terms such as JSON, YAML, Kubernetes, kubectl, TypeScript or GitHub Actions
- **THEN** the raw STT and normalized results are separately available, and the expected terms are scored against references

#### Scenario: Identifier uncertainty
- **WHEN** a spoken identifier is ambiguous
- **THEN** normalization SHALL NOT silently invent a high-confidence exact identifier; the user can inspect and edit the result

### Requirement: Measurable recognition quality
The system SHALL publish fixture-based WER, CER, technical-term accuracy, identifier accuracy and critical error rates, with separate pre/post-normalization scores.

#### Scenario: Benchmark execution
- **WHEN** the versioned test corpus runs
- **THEN** a machine-readable and human-readable report identifies references, predictions, errors, model and hardware test conditions

### Requirement: Consent-controlled real user audio
The system SHALL only retain user-provided voice samples for regression fixtures after explicit consent.

#### Scenario: User declines recording retention
- **WHEN** a user declines retention
- **THEN** the system discards the recording after the test and retains no audio fixture
