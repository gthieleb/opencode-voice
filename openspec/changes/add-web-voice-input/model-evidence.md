# Model performance / cost evidence

Status: **M0 MEASURED (smoke level), tasks NOT RUN**. Populate per-task rows only after real agent runs.

## M0 — Model & agent discovery (2026-10-31, OpenCode CLI v2.2.5)

### Environment inventory

- `opencode --version` → v2.2.5
- User config `~/.config/opencode/opencode.jsonc`: default/small model `huggingface/Qwen/Qwen3.8-27B`; configured providers: `ollama-cloud` (glm-5.3, deepseek-v4.1-flash:1017), `huggingface`; user-level agents built-in only (`build`, `plan`, `general`, `explore`) — no project agents existed, nothing overwritten.
- `opencode agent list` does not exist as a subcommand in v2.2.5 (generic help printed). Agent availability verified via smoke invocation instead (see below).

### Availability probe results (`opencode run --model <id> "reply OK"`)

| Candidate ID (spec tier) | Result |
| --- | --- |
| huggingface/Qwen/Qwen3-8B (L0) | ✔ OK, tool-calling verified (read-only package.json task) |
| zai/glm-4.5-flash (L0/L1) | ✔ OK, tool-calling verified (returned exact `scripts.test` = `node --test`) |
| huggingface/Qwen/Qwen3-Coder-30B-A3B-Instruct (spec L1 default) | ✗ "not supported by any provider you have enabled" |
| huggingface/Qwen/Qwen2.5-Coder-32B-Instruct | ✗ server-side tool-call parser not enabled ("auto tool choice requires --enable-auto-tool-choice") → unusable as subagent |
| huggingface/Qwen/Qwen3-Coder-Next (spec L2 candidate) | ✗ provider not enabled |
| huggingface/Qwen/Qwen3.8-27B (user's default) | ✔ OK (correct ID is `huggingface/Qwen/Qwen3.8-27B`, not `huggingface/Qwen3.8-27B` or unprefixed) |
| huggingface/Qwen/Qwen3-VL-30B-A3B-Instruct | ✔ OK (multimodal candidate for screenshot work) |
| huggingface/zai-org/GLM-5.3-Flash | ✔ OK |
| huggingface/zai-org/GLM-4.7-Flash (L1) | ✔ OK, tool-call ✔ ("scripts.test") |
| huggingface/meta-llama/Llama-3.1-8B-Instruct (user probe 2026-10-31) | ✗ **REJECTED for agent routing**: 3 probes — trivial reply ✔; package.json tool task ✗ (0 tool calls, hallucinated `project.json` + fabricated "edit function" answer); context-tail echo/timeout artifacts. L0 stays Qwen3-8B. |
| ollama-cloud/* | ✗ monthly usage limit reached (Stand 31.10.) — **provider decision (M0): ollama-cloud re-enters repertoire from 1. 11. (quota reset)**, then backup/upgrade route for L2/L3 |
| alibaba-token-plan/* (any) | ✗ "Access to model denied" — **user decision (2026-10-31): alibaba provider entirely excluded, may not be used for any task.** |

### Provider policy (M0, user decisions 2026-10-31)

- Allowed providers: **`huggingface`** and **`opencode-go` (session mainline)** only; user decision — **no alibaba/no zai native (zai/)**.
- `huggingface/zai-org/*` counts as **huggingface** (HF-hosted) and remains permitted.
- **No ollama-cloud tasks before 1. 11. 2026** (quota exhausted); from 1. 11. again available as backup/upgrade route for L2/L3.

### Next-iteration evaluation candidates (added 2026-11-02, user request)

| Candidate | Status on enabled providers (huggingface only) | Evaluation gate before promotion |
| --- | --- | --- |
| Qwen2.5-7B-Instruct (user cost est. ~$0.04/$0.10 per 1M io) | ✖ not in huggingface catalog (only `Qwen2.5-Coder-32B` = known broken tool parser); path: ollama model tag or HF catalog availability — **must pass the same two-part smoke before any L0 family promotion** (a ok-prompt + a tool task like `package.json scripts.test`) | tool-call ✔ + no context echo |
| Llama-3.2-3B-Instruct (user cost est. ~$0.02/$0.02 per 1M io) | ✖ not in catalog (only nvidia/meta 3.2-11b/90b vision variants); Llama-3.1-8B already **rejected** on tool-calling quality (see above) — 3.2-3B is more likely to be able to call tools but MUST be verified, not assumed | same two-part smoke; additionally: mixed German/English echo discipline |

Both candidates stay **EVALUATION-ONLY** until the two-part smoke passes. Known prerequisite friction:
- ollama-cloud quota still exhausted after 2026-11-01 calendar change → user-side throttle; recheck date unknown (not the 1st).
- Neither model currently selectable via huggingface; adding a provider model override is a user-config change with its own approval, NOT something agents do silently.

If either passes, its natural landing spot is **L0 (docs/fixtures)** in model-routing.md — not automatic; promotion needs Gate A-level user confirmation recorded here.

### M0 tier assignment (bound into `.opencode/agents/*.md` frontmatter)

| Agent | Tier | Bound model ID | Evidence |
| --- | --- | --- | --- |
| voice-docs-fixtures | L0 | `huggingface/Qwen/Qwen3-8B` | smoke ✔, tool-call ✔, `bash: deny`, `edit: deny` |
| voice-cheap-coder | L1 | `huggingface/zai-org/GLM-4.7-Flash` | smoke ✔, tool-call ✔; replaces unavailable spec-default `Qwen3-Coder-30B-A3B-Instruct` |
| voice-integration-debugger | L2 | `huggingface/Qwen/Qwen3.8-27B` | smoke ✔ (27B general), backup `huggingface/zai-org/GLM-5.3-Flash` |
| voice-independent-reviewer | L3 | `huggingface/zai-org/GLM-5.3-Flash` | smoke ✔; `edit: deny`, `bash: ask`; strongest verified available |

- Smoke invocation of bound agent: `opencode run --agent voice-docs-fixtures …` executed with visible header `voice-docs-fixtures · Qwen/Qwen3-8B` and successful tool use ✔.
- Missing capability: no verified local/cheap **coder** model (toolcalling) — L1 duty shifts to `huggingface/zai-org/GLM-4.7-Flash`; if quality fails at Gate A/B, user can enable a provider (ollama credits from 1.11. / local) rather than silently expanding access (per spec).
- Cost guardrails: L4 (e.g. anthropic/claude-opus-*) catalog viewable but NOT enabled/invoked; any L4 requires explicit user approval at Gate B/D.
- Cost per task: cost metering unavailable in CLI output so far → recorded as UNKNOWN, attempts counted instead.

### Per-task evidence (M0 binding only; NOT RUN elsewhere)

| Task | Assigned model ID | Provider | Attempts | Input tokens | Output tokens | Estimated cost | Tests | Escalation | Reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M0 discovery/binding | Qwen3-8B, glm-4.5-flash, Qwen3.8-27B, GLM-5.3-Flash | huggingface / zai | 12 probes | UNKNOWN | UNKNOWN | UNKNOWN (free-tier smoke) | tool-call smokes pass | NONE | UNASSIGNED |
| T0 baseline | NOT RUN | UNKNOWN | 0 | UNKNOWN | UNKNOWN | UNKNOWN | NOT RUN | NONE | UNASSIGNED |
| T1 transport | NOT RUN | UNKNOWN | 0 | UNKNOWN | UNKNOWN | UNKNOWN | NOT RUN | NONE | UNASSIGNED |
| T2 browser | NOT RUN | UNKNOWN | 0 | UNKNOWN | UNKNOWN | UNKNOWN | NOT RUN | NONE | UNASSIGNED |
| T3 MVP | NOT RUN | UNKNOWN | 0 | UNKNOWN | UNKNOWN | UNKNOWN | NOT RUN | NONE | UNASSIGNED |
| T4 speech | NOT RUN | UNKNOWN | 0 | UNKNOWN | UNKNOWN | UNKNOWN | NOT RUN | NONE | UNASSIGNED |
| T5 release | NOT RUN | UNKNOWN | 0 | UNKNOWN | UNKNOWN | UNKNOWN | NOT RUN | NONE | UNASSIGNED |

Use `model-routing.md` to interpret tier labels. Record failed attempts; do not count task completion without executed tests.
