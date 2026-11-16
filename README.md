# better: pi-better for Claude Code

**This is a port of [nicobailon/pi-better](https://github.com/nicobailon/pi-better) by Nico Bailon** (0.2.0, MIT, see [`LICENSE.pi-better`](LICENSE.pi-better)). The idea and the prompts are his; they are used word for word, and only the session-log path in them is Claude Code's. The Claude Code port is MIT too ([`LICENSE`](LICENSE)).

`/better` puts a deeper version of your prompt in your input box. It builds it from your own code, files and logs, and never sends anything. An agent can also have a subagent's brief checked against the repo before the subagent starts.

## Why

Felix Rieseberg, who works on Claude at Anthropic, argues in [How to be more ambitious: A tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/) that most of us ask models for too little. One of his four kinds of ambition is depth: "Considering a task the way a field-leading expert would ... we go one level deeper and touch the underlying data, tools, and problems."

`/better` asks that question for you. A read-only helper reads what your prompt touches, says what a top professional would do, what raw material they would start from, which methods they would use and what would prove the result right, and then rewrites your prompt to ask for that.

A real run on a small fixture repo (a retry module, a 429 log and two tests):

> **Before:** `/better bump the retries so the 429s stop`

> **After** (put in the input box after 46 s and 7 reads; excerpt):
>
> The ledger API keeps returning 429s and our client gives up. Fix it properly, not just by raising `MAX_RETRIES`.
>
> What we have: `src/rate_limit.py` has `MAX_RETRIES = 5` and `backoff_seconds` (0.25s doubling, capped at 8s, no jitter). `logs/ledger-429.log` shows 6 attempts getting 429 in a row on 2026-11-02 and `GAVE_UP retries=5` at 10:00:17, 8s after the last 429, so we seem to sleep once more before quitting. [...]
>
> Then make the smallest change that fixes it: honor `Retry-After` when present; exponential backoff with full jitter; a cap on total retry time, not just retry count; no sleep after the final failed attempt [...]
>
> Done means: `python3 -m pytest tests/` passes, with `tests/test_rate_limit.py` updated (it currently pins `MAX_RETRIES == 5`); a new test that replays the logged burst (6 429s, then a 200) against a fake server with an injected clock [...]

## Install

```sh
claude plugin marketplace add LukeFost/claude-better
claude plugin install better@claude-better
```

Start a new Claude Code session, then type `/better <your prompt>`.

## Use

| Want | Do |
|---|---|
| Deepen a prompt | `/better <prompt>` |
| Deepen the task in progress, including your feedback so far | `/better` |
| Stop it | `/better-cancel`, or press `cancel` in the band above the prompt (ctrl+x tab, then Enter) |
| Watch the research live, then come back | `/better-boomerang [prompt]`, then `Back with prompt` in the band or `/better-back` |
| An agent checks a brief before a new thread or subagent | the `mcp__better__check_brief` tool, or an Agent prompt that starts with `/better ` |

## How it maps from Pi

| pi-better | This mod |
|---|---|
| A `pi --fork` helper process with read tools | A `claude -p --resume <session> --fork-session --no-session-persistence` helper. Its tools are Read, Grep, Glob and Bash, with `--strict-mcp-config` and `dontAsk`. The mod loads into the helper (`CLAUDE_BETTER_HELPER=1`) and its `tool.check` guard allows only reads, plus Bash that Claude Code's own read-only check passes. |
| Progress widget with a meter, tool chips and a clock | The same two rows, drawn in the band above the prompt |
| The prompt goes above your draft | The same, using `$.prompt.read` and `$.prompt.fill`. If the box can't take it, the prompt goes on the clipboard. |
| `/better-boomerang`: runs in the chat, then `navigateTree` back | A read-only fork subagent shown in the main view (`$.ui.view`). Back is one press or `/better-back`. The main conversation never sees the research. |
| A `/better` subagent brief is checked with brief.md, and a failure blocks the start | The same, on the `Agent` tool. A failure, a cancel or a reply with no marked brief refuses the call, so no subagent starts. |
| `pi.appendEntry` records | A JSON record per run in `~/.claude/better/runs/` holding input, argv, exit code, the last 3 stderr lines, tools, reply and result. No environment or credentials go in it. |

## Limits

- **Esc does not cancel `/better`.** A mod can't take the first Esc from the prompt box. Use `/better-cancel` or the band's `cancel` button. Esc does cancel an agent's brief check, because it interrupts the turn that is waiting on it.
- **While a turn is running, Claude Code queues `/better`**, and it starts when the turn ends. Once it is running you can keep working; it is never blocked.
- **The return from boomerang is one press, not automatic.** `$.ui.view({})` only switches views in answer to your own input, so the mod can't jump back when the fork finishes. Pi rewinds the chat; here the chat was never changed. The fork's transcript stays in `/tasks`.
- **In auto mode, a `/better`-marked Agent call is refused after the check**, because Claude Code won't run a prompt that changed after approval. The agent then resends the checked brief, which the classifier reviews, and the unchecked brief never runs. To avoid the round trip, call `check_brief` first.
- **Each command leaves one line in the transcript** (`/better is reading ...`), which the model can read. Pi's custom entries leave none.
- **The helper starts `claude` from PATH.** If it isn't on PATH, the check fails loudly and nothing starts.
- The helper uses the chat's model. Its tool list differs from the chat's, so the prompt cache only partly carries over.

## Develop

```sh
claude plugin validate .
claude plugin test .     # 14 tests
tsc -p .                 # once Claude Code has laid .claude-plugin/types
```

## Remove

```sh
claude plugin uninstall better@claude-better && claude plugin marketplace remove claude-better
```

To work on it locally: `claude --plugin-dir <your clone>`. Editing the mod while `/better` is running reloads it and stops that run.
