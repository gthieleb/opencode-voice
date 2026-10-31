# T0 inventory — composer extension point & icon audit (2026-10-31)

Research against `anomalyco/opencode` branch `dev` @ `dc4775a64da024bc94f385c85e344d03005e7410` (2026-10-31). Two independent research agents (different providers, same class): composer/GUI-plugin study (`Qwen3.8-27B` via huggingface) and icon-catalog study (`GLM-5.3-Flash` via opencode-go). Full raw reports preserved in session; distilled here.

## 1.4 Composer extension point — verdict: **A-partial**

### Supported third-party surface (`@opencode/plugin/gui`)
- GUI plugin SDK runs in the served web app (`packages/app`) and offers:
  - **`ComposerPill`** registry — capsule in the lane row *above* the composer (`packages/app/src/session/composer/plugin-pills.tsx`, lane = `session/composer/composer-lane.tsx`), with reactive `show()` (label/icon), click `run`, `rows` menu, and since PR #59764 a **full custom popover via `menu(input)`** (host-owned Popover; plugin owns inner JSX). In-repo precedent: `goal` GUI plugin renders `ctx.ui.Button`s inside its pill popover.
  - **`ctx.screen.current()?.composer`** host API (PR #59469, merged 2026-10-27): `text`, `focused`, `insert`, `setText`, `model`, `setModel`, `setVariant`, attach parts — plugins can write the draft of the active composer.
  - `ctx.ui`: app-native `Icon`, `Button`, `IconButton`, `Tooltip`, `Menu`, `Loader`, `Dialog`, `Switch`, `TextInput`, `Keybind`, `Markdown`, `Code` usable inside plugin-rendered surfaces.
  - `Command` registry with global keybind (e.g. Ctrl+Shift+V) as keyboard trigger.
- **NO third-party slot exists in the composer footer row** (`packages/app/src/composer/editor/editor.tsx` L1391–1476, `composer-actions` group: submit button, steer/queue) — pure first-party JSX.
- First-party web voice itself is app-internal and experimental: `packages/app/src/voice/` (`VoiceComposer` renders a Call button *beside*, not inside, the footer; gated by an experiment flag, desktop-only, absent from prod builds). Active first-party development (72 recent voice PR/issue hits; api changes weekly).

### Fallback path (upstream patch) — only if footer-row placement is mandated
- Cleanest precedent to mirror: `modelControl` host-injection prop in `packages/app/src/composer/composer.tsx`; add a `ComposerEditorActionSlot`/similar before submit in the footer row.
- Second, lower-risk option: append to `SessionComposerLane` children (`session/composer/region.tsx`) — same lane the pills already occupy.

### Design rebuilding of the plan's assumptions
- The zip's `design.md` "prefer official GUI plugin extension point with native composer action" is **confirmed real** — via `ComposerPill` + `ctx.ui`, and **better than assumed** because composer *text write* (`composer.insert/setText`) is available to plugins, which the TUI plugin API lacks (opencode-voice's own comment states no way to write composer text from TUI).
- Spec wording "microphone action **near** the bottom composer" is satisfiable by the pill UI without any patch. Spec "in the lower composer" (web-voice-input req) maps to pill-above-composer + popover MVP; exact footer-row parity would require the upstream patch — Gate A decision.

## 1.5 Icon catalog audit

- Catalog lives in exactly `packages/ui/src/icons/{catalog.ts, icon/additional-icons.ts, new-icons.ts}`; package `@opencode/ui` (this fork's scope), export map `./icon` → `Icon` (`name: IconName | (string & {})`, `size` small/normal/large) and `./icon-button` → `IconButton` (`variant` neutral/contrast/submit/ghost/ghost-muted, `state` rest/hover/pressed). Registry helpers: `iconNames()`, `isIconName()`, `getIcon()`; unknown name falls back to `plus`.
- Render: one hidden SVG sprite (`#opencode-v2-icon-sprite`) + `<use>`; all bodies use `currentColor` → theming via design tokens is automatic for dark/light; no per-icon classes needed.
- License MIT; provenance: bespoke hand-authored inline SVG (kebab-case, Font-Awesome-flavored names, square-cap strokes). No iconify upstream.
- **Available & relevant:** `waveform` (6-bar level meter), `outline-wave-audio`, `outline-audio`, `stop` (only true stop glyph), `xmark-small`/`close`/`circle-xmark`/`circle-x`, `circle-exclamation`/`warning`/`outline-hexagonal-warning`, `info`, `lock`.
- **Missing: `mic`/`microphone`, `record`, `play`** — verified absent across all three catalog files. Authoring a `mic` (and optionally `record`) entry as inline SVG in `additional-icons.ts` would require an upstream patch to the OpenCode repo. In a *plugin*, we instead ship the artwork in the plugin's own components (inline SVG copy), keeping the plugin self-contained and MIT-licensed — no catalog patch needed.
- New-icons experiment: swaps artwork only, adds nothing relevant (stop + waveform explicitly unchanged).

## Decision consequences (for Gate A, tasks 1.6–1.8)

| Achievability | via |
|---|---|
| Mic control visible near composer, native look | ✔ `ComposerPill` + `ctx.ui.Icon/IconButton` (no patch) |
| Editable draft + explicit submit | ✔ `ctx.screen.composer.setText/insert` + existing submit action (no patch); native first-party submit stays in footer |
| Keyboard trigger | ✔ `Command` + keybind |
| Footer-row button parity | ✖ needs upstream patch (cleanest: extend `composer.tsx` modelControl precedent) — optional post-MVP |
| Native mic icon | ✖ catalog lacks `mic` — plugin ships own MIT inline SVG (or upstream icon PR later) |

Spike recommendation for Wave 2 implementation: minimal GUI plugin (`gui-experimental` bundle) registering a `ComposerPill` with popover + `composer.setText("…")` proof on the pinned OpenCode web build before building the real voice surface.
