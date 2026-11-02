# Cost-first model routing and escalation policy

Status: PLANNED, not benchmarked. This is project policy for agent assignment, **not** built-in OpenSpec automatic model scheduling. Actual provider/model IDs must be checked with `opencode models` before use. Record cost and success measurements in `model-evidence.md`.

## Tier definitions

| Tier | Candidate | Intended workload | Constraints |
| --- | --- | --- | --- |
| L0 | Qwen3 4B or 8B | Docs, fixture generation, inventories, trivial config | Must use narrowly scoped instructions; do not permit unsupervised integration changes |
| L1 | Qwen3-Coder-30B-A3B-Instruct | Small TS implementations, existing-test extensions, native UI styles | Preferred cheap coding default; verify tool-calling support on chosen runtime |
| L2 | Qwen3-Coder-Next or a measured equivalent | Client/SDK integration, cross-file refactors, Playwright audio failures | Escalate only from bounded evidence or complexity preclassification |
| L3 | Verified strong coding model (e.g. Claude Sonnet) | Architecture review, security, cross-layer debugging, final independent review | Review separately from implementation where feasible |
| L4 | Verified premium reasoning model (e.g. Claude Opus) | Critical unresolved security/architecture issues | Requires user approval before API-cost exposure |

Names are **candidate families, not guaranteed model IDs or cheapest current providers**. Benchmark local and hosted offerings on real repository tasks before pinning.

**L0/L1 next-iteration evaluation candidates (user-added 2026-11-02):**
| Candidate (user cost est., io per 1M) | Planned tier | Entry criterion (two-part smoke) | Evidence slot |
| --- | --- | --- | --- |
| Qwen2.5-7B-Instruct (~$0.04 / $0.10) | L0 candidate (better German, structured JSON, native tool calling) | (1) trivial reply without prompt-echo; (2) real tool task with verified tool call and exact output | `model-evidence.md` next-iteration section |
| Llama-3.2-3B-Instruct (~$0.02 / $0.02) | L0/L1 efficiency candidate (distilled, fast, native tool calling) | same; plus German/English mixed-term discipline check | same |

Do not confuse total parameters with memory footprint or price. Both are **NOT AVAILABLE** on enabled providers as of 2026-11-02 (huggingface catalog lacks both IDs; ollama-cloud quota still exhausted past its November 1 expected reset — recheck date unknown). Promotion requires recorded pass of the smoke, not cost figures alone.


## Task assignment matrix

| Existing task / gate | Default | Independent review | Escalate when |
| --- | --- | --- | --- |
| 1.1–1.3 source/test inventory and T0 | L0 | L1 spot-check | Can't find established entry points |
| 1.4–1.5 composer extension and icons | L1 | L3 architecture signoff (A) | Needs upstream patch / undocumented API |
| 2.1 shared STT interface | L1 | L2 | TUI compatibility breaks |
| 2.2 authenticated WebSocket transport | L2 | L3 security review | Auth/origin/session isolation unresolved |
| 2.3 browser capture / codecs | L1 | L2 | Browser compatibility or decoding fails |
| 2.4 native mic button | L1 | L2 | Composer API cannot inject |
| 2.5 draft/normalization and session routing | L2 | L3 | Possible premature submit/cross-session delivery |
| 2.6 user docs | L0 | L1 | Ambiguous operational behavior |
| 3.1 unit/integration tests | L1 | L2 | Persistent nondeterminism |
| 3.2 fixture generation | L0 | L1 | Pronunciation reference defects |
| 3.3–3.4 Playwright E2E + MCP audio | L2 | L3 only on repeated failure | Browser capture or MCP launch issue |
| 3.5 Piper/TTS artifact checks | L0 | L1 | Device/output mismatch |
| 3.6 WER/CER benchmark implementation | L1 | L2 | Metric or provenance ambiguity |
| 3.7 human evaluation coordination | L1 | User decides consent | Real audio retention request |
| 3.8 negative/security cases | L2 | L3 | Security defect |
| 3.9 CI wiring | L1 | L2 | Platform integration failures |
| 4.1–4.3 release documentation & PR | L1 | L3 final review | Unresolved release blocker |
| Gate A/B/C/D and T3/T5 | responsible tier | User go/no-go; L3 at release | Blocking or disputed acceptance |

## Execution policy

1. Use L0/L1 for bounded tasks with one or two file targets and exact acceptance criteria. Avoid huge repository context on cheap models.
2. Before editing, capture failing/relevant tests; after editing, run targeted checks. Run the mandatory T0–T5 gates irrespective of model tier. Never let a model claim success without command output and evidence.
3. Permit **at most two bounded implementation attempts** at a tier for a failing task; then hand off a concise failure packet (task ID, affected files, git diff, commands, logs, suspected cause, rollback status). No infinite retry loops.
4. Security-sensitive decisions, auth, origin/session isolation, microphone privacy and patching OpenCode require L3 review even if implementation came from L1/L2.
5. Any L4 invocation needs explicit user consent and a stated spending cap. No automatic premium escalation.
6. Different reviewer from implementer at B/D whenever practical. Do not interpret a passing test as a substitute for security review.
7. Record actual model, provider, input/output tokens if exposed, cost estimate, attempts, elapsed time, test results and whether escalation was necessary. If unavailable, write `UNKNOWN`, not zero.
8. Evaluate **cost per accepted task**, not just cost per million tokens. Compare low-tier model against an L2 baseline on at least 5 representative tasks before automating default routing.
9. Initial assignment is advisory; OpenSpec artifacts do not switch models automatically. For execution, use OpenCode configured subagents and explicit delegation. Verify the installed OpenCode version's configuration schema (V1 `agent` versus V2 `agents`) before writing config.

## Go / no-go checkpoints

- Gate A: user sees chosen tier map, high-risk task ownership, spending ceiling and model IDs; approve any new external paid model or OpenCode patch.
- Gate B / T3: E2E verified; publish attempts and escalation counts plus cost information where available.
- Gate C / T4: preserve WER/CER and human audio results independent of implementation model; change models if inexpensive code breaks benchmark reliability.
- Gate D / T5: independent L3 review, green required tests and explicit user signoff. L4 never required merely for a normal release.

## Source references

- https://opencode.ai/docs/de/agents/ (per-agent model configuration and subagents)
- https://dev.opencode.ai/v2/docs/agents/ (V2 agents schema; version-specific)
- https://github.com/QwenLM/Qwen3-Coder (model sizes and intended use)
- https://openspec.dev/docs/project-config (workflow rules, no native model scheduling)

## Discovery-first agent configuration (M0)

**Do not commit guessed model IDs.** The provided `.opencode/agents/*.md` are portable role templates without a `model:` override; until discovery they inherit the primary model and must not be described as cost-restricted. First execute `opencode models`, `opencode agent list`, check `/models`, and verify the effective provider/model in a smoke invocation. Model catalog visibility is not proof of usable credentials or reliable tool calling.

When actual models exist, assign `model: provider/model-id` in the YAML frontmatter of each local agent or scoped OpenCode config **after** checking installed OpenCode syntax. Map `voice-docs-fixtures` to L0, `voice-cheap-coder` to L1, `voice-integration-debugger` to L2, `voice-independent-reviewer` to L3. Optionally add a higher-tier emergency agent only with approval. Offer alternatives if an expected tier is absent: a tested cheaper available model, local provider (if resources support it), or a smaller scoped agent with stricter permissions and acceptance tests. Do not auto-enable paid providers.

Trial each proposed model against one read-only repo survey, one constrained coding task, test interpretation and tool-calling. Record success, edits, retries, prompt/context size, tokens/cost if provider reports, and elapsed time. Choose **cost per accepted task** over nominal input-token price. Fail-closed when expensive model selection is ambiguous. Recheck mappings when provider or OpenCode configuration changes. Before each subagent invocation communicate the selected model/tier; independently review cross-session submission and network security.
