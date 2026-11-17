---
name: better
description: Deepens a prompt, or checks a subagent brief, with the better plugin's read-only helper, then hands the improved text back without acting on it. Use when the user types /better (with or without a prompt), asks to "better" or deepen a prompt, or starts a subagent prompt with "/better ". Not for carrying out the prompt.
---

# /better

The `better` MCP tools run a read-only helper that reads the code a prompt touches and rewrites the prompt into a deeper version. You never carry the result out.

## /better [prompt]

1. Call the `better` tool once:
   - `prompt`: the user's prompt, word for word. If they gave none, the task in progress in their words, with their feedback on work already done.
   - `context`: a few lines on what this chat established that the repo alone won't show (decisions, file paths, errors, constraints). Facts from this chat only, no plan of your own. Leave it out on a first message.
   - `cwd`: the workspace folder.
2. In `cursor-agent`, a run that takes longer than 45 seconds returns "still reading (job ...)" first. Then call `better_wait` with that job id, again and again, until it returns the result or an error. A run takes 1 to 3 minutes; don't stop polling early or say it is stuck.
3. When it returns, show the improved prompt once in a fenced block and repeat the tool's one line on where it went (Cursor's "Create chat with prompt" dialog, or the clipboard). Then stop. Don't start the work, edit files or run anything for it.
4. If it fails, show its message as it is and stop. Don't deepen the prompt yourself instead.

## Subagent briefs ("/better " at the start)

Before starting a subagent whose prompt starts with `/better `, call `check_brief` with the brief (without the mark), `cwd`, and `context` only if the brief points at things this chat decided. If it says it is still reading, call `better_wait` the same way until it returns. Start the subagent with the returned brief verbatim. If the check fails, don't start the subagent; say why. If you start one with the mark anyway, the plugin's hook checks the brief first and swaps in the checked one, or refuses the start.

## Notes

- Cancel with Cursor's stop button: the plugin's stop hook stops the helper and nothing is produced.
- The helper needs the `claude` CLI, signed in.
- If the `better` tools are missing, say that the better MCP server is off or not loaded (Customize > MCPs > better: turn it on, or Reload) and stop. Don't investigate further or deepen the prompt yourself.
