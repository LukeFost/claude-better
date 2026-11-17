# better: pi-better for Claude Code

`/better` is a Claude Code and Cursor plugin that rewrites your prompt from your own code and files, and leaves it in your input box unsent.

It reads what your prompt touches, then puts a deeper version above your draft. An agent can also have a subagent's brief checked against the repo before the subagent starts.

It is a port of [nicobailon/pi-better](https://github.com/nicobailon/pi-better) 0.2.0 by Nico Bailon (MIT, [`LICENSE.pi-better`](LICENSE.pi-better)). The idea and the prompts are his, used word for word: only the session-log path in [`helper.md`](https://github.com/nicobailon/pi-better/blob/v0.2.0/helper.md) and [`brief.md`](https://github.com/nicobailon/pi-better/blob/v0.2.0/brief.md) is changed (see `HELPER_MD` and `BRIEF_MD` in [`hooks/better.ts`](hooks/better.ts)). The port is MIT too ([`LICENSE`](LICENSE)). Version 0.4.7; changes are in [`CHANGELOG.md`](CHANGELOG.md).

## Install

You need Claude Code, signed in (tested on 2.1.326). Cursor also needs Node 23.6 or later, which runs the plugin's `.ts` files directly.

<table>
<tr><th>Claude Code (terminal or the desktop app's Code tab)</th><th>Cursor (desktop app or <code>cursor-agent</code>)</th></tr>
<tr><td>

```sh
claude plugin marketplace add LukeFost/claude-better
claude plugin install better@claude-better
```

</td><td>

```sh
git clone https://github.com/LukeFost/claude-better ~/.cursor/plugins/local/better
```

</td></tr>
<tr><td><code>cd</code> into your project and start <code>claude</code> (or open the project in the desktop app's Code tab), then type <code>/better &lt;your prompt&gt;</code>. Claude Code's own first-run screens (theme, renderer, browser tools) don't affect the plugin; if it asks whether you trust the folder, pick "Yes, I trust this folder" (the cursor starts on "No, exit"), since the helper reads only inside it. <code>claude plugin list</code> should show <code>better@claude-better</code> at 0.4.9. The desktop app loads plugins installed this way for its Code sessions; its plain chat does not run Claude Code plugins.</td>
<td>Skip the clone if the Claude Code plugin is installed: Cursor imports it. Reload Cursor, then type <code>/better &lt;your prompt&gt;</code>. See <a href="#cursor">Cursor</a>.</td></tr>
</table>

## Use: commands

While it works, a two-row strip (the *band*) above the input box shows what the helper is reading and a `cancel` button. Failed tools (a ✗ chip, or "2 failed" in the tool count) are normal: usually a Bash read the guard refused or a command that exited non-zero, and the helper reads the file another way. The result can be taller than your terminal, so scroll the input box to see all of it.

| Want | Do |
|---|---|
| Deepen a prompt | `/better <prompt>` |
| Deepen the task in progress, including your feedback so far | `/better` |
| Review, edit and send the result (desktop app) | the "/better draft" pane: `Send to thread`, `Edit`, `Put in input box`, `drop` |
| Stop it | `/better-cancel`, or press `cancel` in the band (click it in the desktop app; in the terminal, ctrl+x tab, then Enter) |
| Watch the research live, then come back | `/better-boomerang [prompt]`, then `Back with prompt` in the band or `/better-back`. Not in auto mode. |
| An agent checks a brief before a new thread or subagent | the `mcp__better__check_brief` tool, or an Agent prompt that starts with `/better ` |

![/better in a Claude Code terminal session: the band shows the helper reading the ledger fixture's files, then the deeper prompt lands in the input box](docs/better.gif)

## Why

Felix Rieseberg argues in [How to be more ambitious: A tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/) that most of us ask models for too little. One of his four kinds of ambition is depth: "Considering a task the way a field-leading expert would ... we go one level deeper and touch the underlying data, tools, and problems."

`/better` asks that for you. A read-only helper reads what your prompt touches, says what a top professional would do, from what raw material, with which methods, and what would prove the result right, then rewrites your prompt to ask for that. A real run on a small fixture repo (a retry module, a 429 log and two tests):

> **Before:** `/better bump the retries so the 429s stop`
>
> **After** (in the input box after 46 s and 7 tool calls, one of them refused; excerpt, full run in [`docs/example-run.md`](docs/example-run.md)):
>
> The ledger API keeps returning 429s and our client gives up. Fix it properly, not just by raising `MAX_RETRIES`.
>
> First, find the code that actually calls `MAX_RETRIES` and `backoff_seconds` (it isn't in this repo) and pull the raw 429 responses [...] Then tell me whether the real problem is too few retries, retry timing, or us sending requests too fast [...]
>
> Then make the smallest change that fixes it: honor `Retry-After` when present; exponential backoff with full jitter; a cap on total retry time, not just retry count; no sleep after the final failed attempt [...]
>
> Done means: `python3 -m pytest tests/` passes, with `tests/test_rate_limit.py` updated (it currently pins `MAX_RETRIES == 5`); a new test that replays the logged burst (6 429s, then a 200) against a fake server with an injected clock [...]

## When it helps and when it doesn't

From an A/B test of 7 real tasks, 2 runs each, graded blind ([`docs/ab-test.md`](docs/ab-test.md)):

- **On small, clear tasks, your original prompt is enough.** It passed 52 of 52 hidden checks in a median 22 s. The `/better` prompt passed 46 of 52 in 102 s.
- **Its gain is proof.** Executors given the `/better` prompt wrote and ran the tests, and replayed the logged failure. Blind graders scored that 4.5 of 5, against 2.5 for the original.
- **Its known failure is extra gates and scope.** Half its rewrites told the executor to stop and ask, or report before acting, and some asked for work nobody wanted. The example above does both: it asks for a report on code outside the repo before any fix, and for jitter nobody asked for. Read the rewrite before you send it, and cut what you don't want.

## How it maps from Pi

| pi-better | This plugin |
|---|---|
| A `pi --fork` helper process with read tools | A `claude -p --resume <session> --fork-session --no-session-persistence` helper. Tools: Read, Grep, Glob and Bash, with `--strict-mcp-config`, `dontAsk` and `--setting-sources ''`. The plugin's `tool.check` guard, loaded into the helper, refuses all but reads and Bash that Claude Code's read-only check passes; `dontAsk` still limits reads to the working folder. A run whose guard didn't load is refused. |
| Progress widget with a meter, tool chips and a clock | The same two rows, drawn in the band above the prompt |
| The prompt goes above your draft | The same, using `$.prompt.read` and `$.prompt.fill`. If the box can't take it after about 5 seconds of trying, the prompt goes on the clipboard, into a `.md` file beside the run record and into the chat, and waits for `/better-back`. |
| `/better-boomerang`: runs in the chat, then `navigateTree` back | A read-only fork subagent shown in the main view (`$.ui.view`). Back is one press or `/better-back`. The main conversation never sees the research. |
| A `/better` subagent brief is checked with brief.md, and a failure blocks the start | The same, on the `Agent` tool. A failure, a cancel or a reply with no marked brief refuses the call, so no subagent starts. |
| `pi.appendEntry` records | A JSON record per run in `~/.claude/better/runs/` (always there, even when `CLAUDE_CONFIG_DIR` points elsewhere) holding input, argv, exit code, whether the guard loaded, the last 3 stderr lines, tools, reply, result and, for `/better`, where the prompt went (`handover`). A dev checkout or `--plugin-dir` copy writes to `~/.claude/better/runs-dev` instead, and `CLAUDE_BETTER_RUNS_DIR` (absolute path) overrides both. Only the newest 200 are kept. No environment or credentials go in it. stderr stays in the record: errors shown to you or to an agent name the record instead. |

## Cursor

The same `/better` works in Cursor's agent, in the desktop app and in `cursor-agent`, as a Cursor plugin. It gives the agent three tools, `better`, `check_brief` and `better_wait`, plus a skill that tells it when to use them. They run the same read-only `claude -p` helper with the same guard, so it needs the `claude` CLI, signed in, and Node 23.6 or later.

Install it as under [Install](#install); two copies (the clone plus the imported Claude Code plugin) run every hook twice. A subagent prompt can also start with `/better `. For `cursor-agent`, add `--plugin-dir ~/.cursor/plugins/local/better`. To update, `git pull` in that folder; to remove, use Remove in Cursor's plugin settings or delete the folder.

How it differs from the Claude Code plugin:

- The helper can't fork the Cursor chat, so the agent passes what the chat established along with the prompt.
- The stages show on the tool card. When it's done, Cursor's prompt link offers the improved prompt in a "Create chat with prompt" dialog, and your clipboard is left alone. Click Create Chat to start a chat with it, or Cancel. In `cursor-agent`, or when the link refuses it (over 10,000 characters encoded, or text Cursor flags, such as `.env` paths), it goes on the clipboard only. Nothing is sent.
- Cancel with Cursor's stop button: the plugin's `stop` hook stops the helper and nothing is produced. Cursor tells the MCP server nothing, so the hook leaves a marker in `~/.claude/better/cursor-stops` that the server checks; a stop in the same workspace also cancels a run in another chat there.
- A subagent prompt that starts with `/better ` is checked by the plugin's `preToolUse` hook, which swaps in the checked brief, or refuses the start if the check fails.
- `cursor-agent` drops an MCP call after about 60 seconds, so there a run longer than 45 seconds first returns a job id, and the agent calls `better_wait` until the prompt arrives.
- There is no `/better-boomerang`.
- Run records go to `~/.claude/better/runs` with `"from": "cursor"`.
- If the plugin isn't loaded, Cursor has no `/better` command, and the agent may take `/better <prompt>` as a plain task and start on it. Check that Cursor lists the `better` tools before you rely on it.

## Limits

- **Esc does not cancel `/better`.** A plugin can't take the first Esc from the prompt box. Use `/better-cancel` or the band's `cancel` button. Esc does cancel an agent's brief check, because it interrupts the turn that is waiting on it.
- **`/better-boomerang` doesn't run in auto mode.** Auto mode refuses the fork, and the command says so. Switch the permission mode (the mode menu under the input box in the desktop app, shift+tab in the terminal), or use `/better`.
- **In the desktop app the fork can't be watched in the main view.** It runs in the background, and `Back with prompt` or `/better-back` puts its prompt in your input box.
- **On a desktop session's first message, the app may say "/better isn't a command here."** The app checks the command before the session has loaded the plugin; the command still runs. Later messages don't show it.
- **Desktop toasts stay until you close them or the next one replaces it.**
- **The draft pane is desktop only.** In the desktop app the improved prompt opens in a pane beside the chat, and only `Send to thread` submits it. The edit box is plain text: the formatted view is read-only, and Enter saves the edit while Shift+Enter adds a line. One draft is held at a time; a second `/better` replaces it, and the earlier one stays in its `.md` file. In the terminal the prompt goes in the input box as before.
- **If you leave the session while `/better` runs, the box can't take the prompt.** The desktop app only fills the box of a session that is on screen (the engine reports `no_composer`), and its clipboard is out of reach then too. `/better` tries for about 5 seconds, then saves the whole prompt as a `.md` file in `~/.claude/better/runs` (the toast has the full path), shows it in the chat, and keeps it. Back in the session, press `Put in input box` above the prompt or run `/better-back`. The same happens while a dialog is open over the box.
- **While a turn is running, Claude Code queues `/better`**, and it starts when the turn ends. Once it is running you can keep working; it is never blocked.
- **The return from boomerang is one press, not automatic.** A plugin can switch views only in answer to your input. The chat was never changed, and the fork's transcript stays in `/tasks`.
- **In auto mode, a `/better`-marked Agent call is refused after the check**, because Claude Code won't run a prompt that changed after approval. The agent then resends the checked brief, which the classifier reviews, and the unchecked brief never runs. To avoid the round trip, call `check_brief` first.
- **Each command leaves one line in the transcript** (`/better is reading ...`) that the model can read. The command itself shows as `/better` without your text; the text still reaches the helper (see the run record's `input`).
- **The helper runs the `claude` CLI.** It takes the first `claude` on PATH, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, then the desktop app's own engine, and names the one it used in the run record. With none, it says how to install one and starts nothing.
- **The CLI's login is separate from the app's.** The desktop app signs its sessions in itself, so the `claude` CLI's own login can expire while the app still works. When the helper's CLI fails for that reason, `/better` and `check_brief` run the same task as a read-only fork of your session instead, on the session's login, and you see a `/better brief check` agent in the chat. That fork is held to reads by the same guard, but it follows your session's permission rules for what it may read, not the CLI helper's working-folder limit, and the band shows no stages for it. If its reply comes back without the marked block, it is run once more. It needs `/bin/sleep` (macOS, Linux). If the fork can't start either (some permission modes refuse it), the error names the fix, `claude auth login` in a terminal, and an agent is told it may go on with the unchecked brief after telling you. In Cursor there is no session to fork, so you get the message only.
- **The helper reads the working folder, plus the repositories the conversation names.** Its `claude -p` refuses every read outside its folders. So that a session started without a project folder still gets a prompt built from the code, `/better` passes it (`--add-dir`) up to 4 git repositories whose paths appear in your prompt (looked at first) or the conversation: only ones under your home folder or on a named volume, and never a dot folder or `Library`. A brief check (`check_brief`, or an Agent prompt starting with `/better`) gets no extra folder, because an agent writes the brief and could name any path in it. The run record lists them as `addDirs`. `git` commands stay refused in those extra folders, so the helper reads files there. If a read is still refused, the toast counts it.
- **The helper can read any file in those folders, `.env` files included.** What it quotes from them goes into your input box and the run record (readable only by you). Run it from a folder without secrets if that matters.
- **The helper loads none of your settings files.** No allow rule, yours or the repo's, can widen what it may do, even if its guard failed to load. The cost: your settings' hooks (a secret-output hook, say) and deny rules don't run inside the helper, and it can't read outside its folders (the working folder, plus the repositories described below for `/better`). Plugins still load.
- The helper uses the chat's model. Its tool list differs from the chat's, so the prompt cache only partly carries over.

## Develop

```sh
claude plugin validate .
claude plugin test .     # 60 tests; the flows run on the terminal and desktop surfaces
node --test 'cursor/*.node-test.ts'   # the Cursor hooks and helper (plain Node)
npx -y oxlint@1.90.0 --deny-warnings  # .oxlintrc.json; no package.json needed
tsc -p .                 # once Claude Code has laid .claude-plugin/types
```

## Remove

```sh
claude plugin uninstall better@claude-better && claude plugin marketplace remove claude-better
```

To work on it locally: `claude --plugin-dir <your clone>`. Editing the plugin while `/better` is running reloads it and stops that run.
