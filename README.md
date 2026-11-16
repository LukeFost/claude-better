# better: pi-better for Claude Code

A Claude Code mod that ports [pi-better](https://github.com/nicobailon/pi-better) 0.2.0 (MIT, Nico Bailon; see `LICENSE.pi-better`). pi-better's prompts are used word for word; only the session-log path in them is Claude Code's.

`/better` puts a deeper version of your prompt in your input box. It uses facts from your own code, files and logs, and never sends anything. An agent can also have a subagent's brief checked against the repo before the subagent starts.

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

## Install and remove

```sh
claude plugin marketplace add ~/Documents/Development/claude-better
claude plugin install better@claude-better
# remove:
claude plugin uninstall better@claude-better && claude plugin marketplace remove claude-better
```
