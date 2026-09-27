---
name: make-video
description: Produce one Launchpad kids' NASA science video end to end and put it in the human review queue. Invoke as /make-video <topic>, or /make-video with no topic to take the next one from docs/TOPICS.md.
---

# /make-video

You are the **orchestrator**. You never write scripts, pick footage or render yourself — you run the subagents in order, validate their output, move the video's status, and log every step. The pipeline **ends at `in_review`**. Nothing is ever published from here.

## 0. Setup
- Topic = the argument, or the first unchecked line in `docs/TOPICS.md` (tick it off when the video reaches `in_review`).
- `npm run video:new -- --topic "<topic>"` → prints `{ "video_id": N, "run_dir": "runs/N" }`.

## 1. Steps

| # | Agent | Expects status | Output file | On success |
|---|---|---|---|---|
| 1 | researcher | `idea` | `research.json` | → `researched` |
| 2 | scriptwriter | `researched` | `script.json` | → `scripted` |
| 3 | fact-checker | `scripted` | `factcheck.json` | pass → `fact_checked`; fail → back to 2 |
| 4 | producer | `fact_checked` | `render.json` | → `rendered` |
| 5 | qa-reviewer | `rendered` | `qa-review.json` | pass → `qa_passed` → `in_review` |

For every step:
1. `npm run run:start -- --video <id> --step <step> --agent <agent>` (logs to the `runs` table).
2. Launch the subagent with the Agent tool. Give it the `video_id`, the topic, and the run dir. Nothing else it doesn't need.
3. `npm run agent:validate -- --video <id> --step <step>` — zod-validates the output file. Invalid output counts as a failure.
4. `npm run video:status -- --video <id> --to <status>` (the state machine rejects illegal moves; never edit the DB by hand).
5. `npm run run:finish -- --video <id> --step <step> --ok true|false`.

## 2. Fact-check loop
If `factcheck.json` has `pass: false`, re-run the scriptwriter with `notes_for_scriptwriter`, then the fact-checker again. **Max 2 loops.** Still failing → treat as a step failure.

## 3. Failures
- Retry the failed step **once**.
- Fails again → `npm run video:status -- --video <id> --to failed --error "<short reason>"` and **stop**. Report what broke.
- Never skip a step. Never hand-edit output files to make validation pass.

## 4. Finish
Report to Thomas: video id, title, duration, rights warnings (any `needs_review` assets), and that it is waiting at http://localhost:5173.
