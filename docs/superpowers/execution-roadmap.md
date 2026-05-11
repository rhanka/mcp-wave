# Execution roadmap — operating mode

**Updated 2026-05-11.** Replaces the previous "pause-after-each-task" rhythm.

## Operating mode

- **User-facing milestones**: 4 total across the 82-task plan. The user gets pinged only at these checkpoints to *test the product*.
- **Code review**: I run it myself between sub-phases via `superpowers:requesting-code-review` / dispatched code-reviewer subagents. User does not review code.
- **TDD discipline**: enforced per-task as the plan specifies. Each task ends with a green `npm run check` and an atomic commit.
- **Execution model**: subagent-driven for mechanical/parallel-friendly batches, inline for tightly-coupled wiring or interactive steps (cloud auth, etc.).

## Milestones (= user validation checkpoints)

### M1 — Read-only MCP locally usable (end of Part A)

**What the user will validate**: plug the stdio MCP into Claude Desktop, ask 2–3 real read questions:
- "Show my Wave businesses"
- "List my unpaid invoices"
- "What's my P&L for last month?"

Phases inside M1:
| Phase | Tasks | Execution | Code review after |
|---|---|---|---|
| A.0 Bootstrap | A1–A5 | inline ✓ done | n/a |
| A.1 Lib basics | A6–A10 | inline ✓ done | (single batch, reviewed at end of A.2) |
| **A.2 Domain (pure)** | A11–A17 | **subagent-driven** | yes |
| A.3 Wave client + auth | A18–A24 | inline (tightly coupled, codegen) | yes |
| A.4 MCP scaffolding | A25–A28 | inline | yes |
| A.5 Read tools | A29–A40 | subagent-driven (12 parallel-friendly tools) | yes |
| A.6 Entrypoints | A41–A44 (now A43–A44) | inline | yes |
| **M1 validation** | — | **user** | — |

Tag at M1 close: `v0.1.0-part-a`.

### M2 — Full v1 functionality locally (end of Part B)

**What the user will validate**: issue a real invoice via stdio.
- "Issue my Acme invoice for November, 23 hours" → DRAFT shown → "send it" → email sent
- "Split my PayrollProvider Nov-15 remittance: 3200 federal, 1620 quebec" → multi-line transaction posted

Phases inside M2:
| Phase | Tasks | Execution | Code review after |
|---|---|---|---|
| B.0 Mutation scaffolding | B1–B2 | inline | n/a |
| B.1 Write CRUD tools | B3–B12 | subagent-driven | yes |
| B.2 Domain helpers | B13–B14 | inline (small, shared with B.3) | yes |
| B.3 Workflow composites | B15–B17 | subagent-driven | yes |
| B.4 HTTP transport | B18–B22 | inline (wiring) | yes |
| B.5 Wrap-up | B23–B30 | inline | yes |
| **M2 validation** | — | **user** | — |

Tag: `v0.2.0-part-b`.

### M3 — Deployed to GCP test environment

**What the user will validate**: hit the Cloud Run URL with curl, see /healthz green; connect Claude over Streamable HTTP and ask a read question against the live API.

Phases:
| Phase | Tasks | Execution |
|---|---|---|
| C.0 Image | C1–C2 | inline |
| C.1 Deploy script lib | C3–C5 | inline |
| C.2 Build + GCP deploy | C6–C7 | inline (user provides GCP_PROJECT and `gcloud auth login`) |
| C.9 First deploy | C12 (runbook) | **user-assisted inline** |
| **M3 validation** | — | **user** |

### M4 — Production on Scaleway

**What the user will validate**: daily use. Final commit/tag is the cutover moment.

| Phase | Tasks | Execution |
|---|---|---|
| C.2 Scaleway deploy | C8 | inline (user: `scw init`) |
| C.3 Secrets / promote / logs | C9–C11 | inline |
| C.4 Runbooks | C13–C14 | doc |
| C.5 CI + cost + README | C15–C17 | inline |
| **M4 validation + tag v1.0.0** | C18 | **user** |

## What I do between user-touchpoints

For each sub-phase:

1. **Dispatch / execute** the tasks per the plan.
2. After all tasks in the sub-phase commit cleanly with `npm run check` green:
   - Run `superpowers:requesting-code-review` on the diff since last review (dispatch a `code-reviewer` subagent).
   - Apply findings (fix or document why I disagree, per `superpowers:receiving-code-review`).
   - Push another commit if changes were applied.
3. Move to the next sub-phase.
4. At milestone close: run `npm run check` + `npm run coverage`, post a one-message summary to the user with what to test and how.

## Things I will NOT ping you for

- Task-level "is this OK?" questions.
- Lint/typecheck/test fixups.
- Choice of subagent vs inline (I decide per phase).
- Code review feedback (I handle the loop).
- Renaming/restructuring decisions inside the agreed plan.

## Things I WILL ping you for

- The four milestone validations above.
- Anything that requires you to interact with a service (Wave token, gcloud login, scw init).
- A discovery that materially invalidates the spec (like the moneyTransactionSplit one).
- A choice the spec didn't anticipate that I can't unblock alone.

## Where we are right now

A1–A10 done (Phase A.0 + A.1). 31 unit tests green. `npm run check` clean.

**Next**: Phase A.2 (Tasks A11–A17) — domain layer, dispatched to subagents. Then code review. Then A.3.
