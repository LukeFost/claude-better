# Does `/better` make the work better? An A/B test (2026-11-16)

A trimmed copy of the maintainer's test report. The harness, the private task and the raw transcripts are not published.

## Method

- 7 real tasks, each with a terse prompt and a hidden check script written before any run.
  - 4 on small fixture repos: ledger retries, ledger tests, CSV totals, a repo with a planted prompt-injection note.
  - 2 on this repo at `46bbccd`: cap the run records, show the model's real error.
  - 1 on a private TypeScript app: a real bug fix, with its test held out.
- Each task ran twice per arm. The executor was `claude -p` with Sonnet 5.5 in a fresh copy of the repo, identical for every arm.
- Arms:
  - **O:** the original prompt.
  - **B:** the real `/better` output (plugin at `46bbccd`, guard loaded, no chat to fork).
  - **I:** a question-first variant. The helper asks up to 3 questions and a simulated requester answers them.
  - **C:** B with two extra paragraphs in the helper prompt (don't add work or stop-and-ask steps; one simple command per Bash call).
- Blind grading: a separate model saw each pair of results as X and Y, never the prompts or arm names, and picked the one that better served the requester's real goal.
- The win rule was fixed before any run.

## Results

| Arm | Hidden checks passed | Blind wins-losses vs O | Median time | Cost |
|---|---|---|---|---|
| O | 52/52 | | 22 s | $1.56 |
| B | 46/52 | 8-6 | 102 s | $5.29 |
| I | 48/52 | 11-3 | 72 s | $4.06 |
| C | 48/52 | 5-9 | 67 s | $5.45 |

The blind graders scored evidence (tests or proof shown) 2.5 of 5 for O and about 4.5 for every rewrite arm. They scored scope (no unasked changes) 4.9 for O and 2.2 for B.

## What it shows

- **On small, clear tasks the original prompt was enough.** O passed every check in about a fifth of B's time.
- **`/better`'s gain is proof.** Its executors wrote the tests, showed them failing and then passing, and replayed the logged failure. The graders broke near-ties on this.
- **Its known failure is added gates and scope.**
  - 7 of 14 B prompts told the executor to stop and ask, or report before acting. Executors obeyed: one B run on the CSV task changed nothing.
  - B prompts asked for work nobody wanted. On the ledger task, added jitter and `Retry-After` pushed the worst-case wait past the check's 60 s limit. On the model-error task, the bigger design leaked stderr into the message, which the task forbade.
- **Harm:** none. No arm's executor followed the planted injection note.

## Limits

Small tasks with terse prompts, 2 repeats, Sonnet 5.5 only, no chat context, a model as the simulated requester and model graders. The fixture tasks were written by the same person who built `/better`.
