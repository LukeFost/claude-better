---
name: better
description: Deepens a prompt, or checks a subagent brief, with a read-only Claude Code helper, then hands back the improved text without acting on it. Use when the user types /better (with or without a prompt), asks to "better" or deepen a prompt, or starts a subagent prompt with "/better ". Not for carrying out the prompt.
---

# /better

A read-only helper (`claude -p` with the claude-better guard) reads the code a prompt touches and rewrites it into a deeper version: what a top professional would do, the rawest material, the methods and tools, and what would prove the result right. You never carry the prompt out.

## /better [prompt]

1. Write the helper's input. The helper can't see this chat, so it needs:
   - The user's prompt, word for word. If they gave none, write the task in progress, in their words where you can, and their feedback on work already done.
   - Then a section `## What this chat established`, a few lines on the decisions, file paths, errors and constraints the prompt relies on that the repo alone won't show. Only facts from this chat; no plan of your own.
2. Run the helper from the workspace root, input on stdin, and wait. It usually takes one to three minutes; if the shell tool takes a time limit, give it 20 minutes. It needs network and writes its run record to `~/.claude/better/runs`, so run it outside the sandbox if asked.

   ```sh
   node ~/.cursor/skills/better/run-helper.ts better --cwd "$PWD" <<'BETTER_EOF'
   <the input from step 1>
   BETTER_EOF
   ```

3. On exit 0, stdout is the improved prompt. Copy it to the clipboard (`pbcopy` on macOS), then show it to the user in one fenced block, followed by one line saying it is on the clipboard to paste, edit and send. Stop there: do not start the work, edit files or run anything else for it.
4. On exit 1, show the stderr line as it is and stop. Do not deepen the prompt yourself instead; the point is the helper's read of the repo.

## Subagent briefs ("/better " at the start)

When the user (or you) start a subagent prompt with `/better `, check the brief first:

1. Run `node ~/.cursor/skills/better/run-helper.ts brief --cwd "$PWD"` with the brief, minus the `/better ` mark, on stdin. Add a `## What this chat established` section only if the brief points at things this chat decided.
2. On exit 0, start the subagent with stdout as its prompt, verbatim.
3. On exit 1, don't start the subagent; show the error.

## Notes

- Cancel: stop the shell command. Stopping the script stops the helper, and nothing is sent.
- The helper needs the `claude` CLI, signed in. The script finds it on PATH, `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`, and says how to install it if missing.
- The helper only reads, and only inside `--cwd`. If its guard fails to load, the result is refused.
- `/better-boomerang` doesn't exist here; this is the plain `/better`.
