# OpenCode project agents — discovery-first installation

Four portable agent prompts reside in `.opencode/agents/`. They intentionally omit `model:` to avoid inventing available provider/model IDs. Consequently **running them before configuring model overrides may use the primary expensive model**. M0 must bind them to real IDs first.

## First-run inventory

```sh
opencode --version
opencode models
opencode agent list
```

Compare `/models` in the working project; inspect project-level and user-level OpenCode configuration without printing secrets. The available catalog may not equal accessible models. Check tool calling, inference costs, context limit, available GPU/VRAM and runtime version.

## Binding models

For each file in `.opencode/agents/`, add a frontmatter `model: provider/model-id` **only when actually available and tested**. User-supplied models (e.g. a local Qwen 27B or Qwen Coder endpoint) are candidates, not defaults. Existing agent names/configuration must not be overwritten. With a changed OpenCode V2 schema, adapt file frontmatter/permissions to the actual installed version. Run `opencode agent list` and a controlled read-only invocation to verify it is loaded.

## Suggested responsibility boundaries

| Agent | Tier | Work | Restrictions |
| --- | --- | --- | --- |
| voice-docs-fixtures | L0 | Docs, spec, synthetic fixture script plans | No shell/changes outside docs without grant |
| voice-cheap-coder | L1 | Small code changes and targeted tests | Narrow 1–2 file tasks, test every change |
| voice-integration-debugger | L2 | Browser/WebSocket/SDK, audio-in-container failures | Logs-first, no unnecessary architecture rewrites |
| voice-independent-reviewer | L3 | Security, contracts, session isolation, releases | Read-only, independent of implementer |

Each task needs acceptance test, allowed file scope, max attempts and escalation notes. For 2 unsuccessful bounded attempts, present evidence before tier promotion. Premium L4 requires explicit user approval. The project MUST preserve existing TUI pipeline.

## Reuse beyond the voice project

At T3/B or T5/D run optional **A1 agent-promotion review** per [`agent-promotion.md`](agent-promotion.md). Do not rename or install globally without user approval. Project `voice-*` agents remain available until dependent tasks are complete.
