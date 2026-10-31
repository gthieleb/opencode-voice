# Native Icon and Design-System Integration

## ADDED Requirements

### Requirement: Follow actual OpenCode UI icon implementation
The implementation SHALL inspect the pinned OpenCode frontend icon catalog, icon components and composer controls, and reuse native icon assets/design tokens where supported. It SHALL NOT add Iconify solely on the assumption that OpenCode uses it.

#### Scenario: Native icon available
- **WHEN** an appropriate microphone icon exists in OpenCode's icon catalog
- **THEN** the microphone action renders through the native icon/button component using existing size and state conventions

#### Scenario: Native icon unavailable
- **WHEN** no appropriate icon exists
- **THEN** the implementation documents license/provenance and proposes the smallest compatible addition instead of independently bundling a new icon framework

### Requirement: Accessible recording states
The button SHALL expose distinct idle, recording, transcribing, permission denied and error states through appropriate visual and accessible labeling.

#### Scenario: Recording active
- **WHEN** the microphone is recording
- **THEN** the control visibly reflects recording and announces the state to assistive technology without relying on color alone

#### Scenario: Theme switch
- **WHEN** OpenCode switches between light and dark themes
- **THEN** the microphone action remains legible, keyboard-focusable and aligned to the native composer
