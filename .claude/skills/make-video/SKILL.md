---
name: make-video
description: Produce one Launchpad kids' NASA science video end to end and put it in the human review queue. Invoke as /make-video <topic>, or /make-video with no topic to take the next one from docs/TOPICS.md.
---

# /make-video

You are the **orchestrator**. You never write scripts, pick footage or render yourself — you run the subagents in order, validate their output, move the video's status, and log every step. The pipeline **ends at `in_review`**. Nothing is ever published from here.

## 0. Setup
- Topic = the argument. With no argument: `npm run topics:next` → use its `topic` (and pass its `query` to the researcher as a search hint). Never edit `docs/TOPICS.md` by hand.
- `npm run video:new -- --topic "<topic>"` → prints `{ "video_id": N, "run_dir": "runs/N" }`.

## 1. Steps

| # | Agent | Expects status | Output file | On success |
|---|---|---|---|---|
| 1 | researcher | `idea` | `research.json` | → `researched` |
| 2 | scriptwriter | `researched` | `script.json` | → `scripted` |
| 3 | fact-checker | `scripted` | `factcheck.json` | pass → `fact_checked`; fail → back to 2 |
| 4 | producer | `fact_checked` | `render.json` | → `rendered` |
| 5 | qa-reviewer | `rendered` | `qa-review.json` | pass → `qa_passed` → `in_review` |

**Never use git** (Thomas commits). Run **one `npm run` command per Bash call**: no `&&`, `;`, pipes or `$(...)` (headless runs refuse them). Read each command's JSON output, then run the next.

Step names for `run:start` / `run:finish` / `agent:validate` are exactly: `research`, `script`, `factcheck`, `render`, `qa-review`.

For every step:
1. `npm run run:start -- --video <id> --step <step> --agent <agent>` (logs to the `runs` table).
2. Launch the subagent with the Agent tool. Give it the `video_id`, the topic, and the run dir. Nothing else it doesn't need.
3. `npm run agent:validate -- --video <id> --step <step>` — zod-validates the output file. Invalid output counts as a failure.
4. `npm run video:status -- --video <id> --to <status>` (the state machine rejects illegal moves; never edit the DB by hand).
5. `npm run run:finish -- --video <id> --step <step> --ok true|false`.

## 2. Fact-check loop
If `factcheck.json` has `pass: false`, re-run the scriptwriter with `notes_for_scriptwriter`, then the fact-checker again. **Max 2 loops.** Still failing → treat as a step failure.

## 3. Topic has no usable footage
If the researcher writes `{ "error": ... }` because nothing usable exists (not a network error): `npm run video:status -- --video <id> --to failed --error "no usable assets: <why>"`, and if the topic came from the backlog `npm run topics:mark -- --topic "<topic>" --status skipped --note "<why>"`. Then stop — do not retry and do not pick another topic in the same run.

## 4. Failures
- Retry the failed step **once**.
- Fails again → `npm run video:status -- --video <id> --to failed --error "<short reason>"` and **stop**. Report what broke.
- Never skip a step. Never hand-edit output files to make validation pass.

## 5. Finish
If the topic came from the backlog: `npm run topics:mark -- --topic "<topic>" --status done --note "video <id> in review"`.
Report to Thomas: video id, title, duration, rights warnings (any `needs_review` assets), and that it is waiting at http://launchpad.localhost.
