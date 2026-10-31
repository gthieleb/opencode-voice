# A1 — Promote proven project agents to reusable OpenCode agents

## Goal
After successful MVP (T3/B) or at project completion (T5/D), **offer**, but do not automatically perform, promotion of successful `.opencode/agents/voice-*.md` profiles to user-global `~/.config/opencode/agents/<generic-name>.md` without the `voice-` prefix.

## Candidate mapping (review names with user)

| Current project agent | Candidate generic agent | Generalization |
| --- | --- | --- |
| `voice-cheap-coder` | `cheap-coder` | Repository-agnostic small implementation, bounded test loops |
| `voice-integration-debugger` | `integration-debugger` | General API, transport, integration and browser debugging |
| `voice-independent-reviewer` | `independent-reviewer` | Independent read-only review with security and regression checks |
| `voice-docs-fixtures` | `docs-writer` or `docs-fixtures` | Remove voice/Piper-specific instructions or keep it project-local |

## Eligibility and acceptance
- [ ] Agent demonstrated reliable task completion; attach accepted commits, test runs, model/cost/attempt evidence and any failures in `model-evidence.md`.
- [ ] Review agent prompt for project-specific paths, OpenCode voice tooling, fixtures, dependencies, privileges and pinned model IDs; generalize or decline promotion.
- [ ] Verify desired global name does not already exist; never overwrite an existing global or project agent without explicit user decision.
- [ ] Verify target model is available globally and does not silently inherit an expensive parent; use M0 discovery again if necessary.
- [ ] Confirm least-privilege permissions (especially reviewer read-only), applicable OpenCode version and frontmatter compatibility.
- [ ] Ask user to approve **each** proposed promotion and its destination/name; no automatic migration.
- [ ] On approval, copy adapted Markdown agent into global config; preserve original project agent and avoid breaking references in active tasks, scripts or documentation.
- [ ] Run `opencode agent list` plus a small controlled invocation of each promoted agent; confirm name resolution, scope, model and tools; log result.
- [ ] Document the promotion decision (approved/deferred/rejected), paths and any needed project-reference replacements. Do not remove `voice-*` project files by default.

## Safety and rollback
Promotion is not mandatory for OpenSpec completion. If validation fails, leave the global profile unused or revert only the newly created file; keep project profiles intact. Do not commit user-global configuration to the repository, expose credentials, or auto-enable premium models. Beware of generic name collisions with built-in agents.

## Go/No-Go report
For each candidate give: tasks passed/failed; cost and model; proposed generic filename; required prompt edits; permission changes; test result; action requested from user.

Official agent convention: project `.opencode/agents/`, global `~/.config/opencode/agents/`; filename becomes agent name. See https://opencode.ai/docs/agents/.
