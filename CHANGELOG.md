# Changelog

Notable changes to this plugin are recorded here. Versions before 0.4.2 are in the git history only.

## [Unreleased]

## [0.5.1] - 2026-11-17

### Changed

- The draft pane's controls take two short lines above the prompt instead of four (one line when the pane is wide enough): `Send to thread` and `Edit`, then the quieter `input box` and `drop`. A status line shows only when there is news ("Edited by you", or that it is sending), and while sending the buttons are hidden.
- In the edit view the hint and `Done` sit above the text box, so they stay on screen for a long prompt.
- The row above the prompt for a kept prompt now says "/better's draft is waiting" with `drop`, the same words as the pane.
- Two toasts that repeated the screen are gone: the one on opening the pane (it still shows when the new draft replaced an earlier one) and "The draft was sent to the thread".

## [0.5.0] - 2026-11-17

### Added

- In the desktop app, `/better` now opens its improved prompt in a pane beside the chat, "/better draft", instead of filling the input box. The pane shows the prompt as formatted text with four buttons: `Send to thread` submits it as your next message, `Edit` swaps it for a text box (Enter saves the edit, Shift+Enter adds a line), `Put in input box` does what `/better` did before, and `drop` discards it. Nothing is sent until you press `Send to thread`. If Claude is busy, the message goes when the running turn ends, and the pane says it is sending.
- The draft is also saved as a `.md` file beside its run record. If you close the pane, a `Show draft` button above the prompt, or `/better-back`, opens it again.
- Run records gain three `handover` results: `pane` (shown in the pane), `sent` and `dropped`, plus `viaPane` and `isEdited` on whatever the pane did.

### Changed

- The terminal, and a desktop session that is not on screen, keep the old behaviour: the prompt goes in the input box, or is kept as in 0.4.8.

## [0.4.9] - 2026-11-17

### Added

- A `/better` run record now says where the prompt went, as `handover`: `filled` (in the input box, with the number of tries), `kept` (the box refused it; with the refusal, whether the clipboard took it and the `.md` path), or `filled_later` (put in the box afterwards with `Put in input box` or `/better-back`).

### Changed

- Only an installed copy of the plugin writes to `~/.claude/better/runs`. A dev checkout or any `--plugin-dir` copy writes to `~/.claude/better/runs-dev`, with its own cap of 200, so test and eval runs no longer push real use out of the cap. On 2026-11-17, 159 of the 200 records were test runs.
- `CLAUDE_BETTER_RUNS_DIR` (an absolute path) sends the records anywhere else, for an eval that runs the installed copy. Cursor honours it too.

## [0.4.8] - 2026-11-17

### Fixed

- `/better` no longer loses the improved prompt when the input box can't take it. In the desktop app the box refuses (`no_composer`) while the session isn't on screen, for example when you switched to another session during the run, and the clipboard refuses for the same reason; the old toast then pointed at a JSON run record. Now the fill is tried for about 5 seconds, and if it still fails the whole prompt is saved as a plain `.md` file beside the run record (full path in the toast), shown in the chat, and kept: a "Put in input box" button above the prompt, or `/better-back`, fills it once you are back. Nothing is sent.
- The helper can read the project when the session runs somewhere else. Its `claude -p` denies every read outside its working folder, so a session with no project folder (or one started elsewhere) got a prompt built from the conversation alone. The helper now also gets, read-only, up to 4 git repositories that the prompt or the conversation names by path. Only repositories under your home folder or on a named volume qualify, never a dot folder or `Library`, and paths in your own prompt are looked at first. Brief checks get no extra folder, since an agent writes the brief. The guard is unchanged: writes and commands that are not read-only are still refused, which includes `git` in those extra folders.
- When reads outside the helper's folders are still refused, the toast says how many, and the helper is told to say so at the top of its reply.

### Changed

- `/better-back` also fills a waiting `/better` prompt, not only a `/better-boomerang` one.
- Run records list the extra folders as `addDirs`. A saved `.md` prompt is pruned with its run record.

## [0.4.7] - 2026-11-17

### Fixed

- A login failure is now read from the CLI's own `authentication_failed` mark on the failed turn, not only from the words of its message, so a reworded message no longer blocks the check. The wording match stays as a backup.

## [0.4.6] - 2026-11-17

### Fixed

- A logged-out CLI started from the desktop app says "Authentication required · Sign in again to continue", which 0.4.5 did not read as a login failure, so the check still blocked. That wording, and the CLI's other expired-login messages, now take the session fork.

## [0.4.5] - 2026-11-17

### Fixed

- When the session fork that stands in for the helper replies without a marked block, it is run once more before the check fails. A second unusable reply still blocks the work.

## [0.4.4] - 2026-11-17

### Fixed

- An expired or missing login of the `claude` CLI no longer blocks `/better` or `check_brief`. The desktop app keeps its own login, so the CLI's can expire while the app works; the check then failed with "OAuth session expired and could not be refreshed" until you ran `claude auth login`. Now the same task runs as a read-only fork of your session, on the session's login.
- If that fork can't start either, the error says what expired and the command to run, and an agent may go on with the unchecked brief after telling you. Every other failure still blocks the work. Cursor gets the same message.

## [0.4.3] - 2026-11-16

### Fixed

- Cursor: `/better` in `cursor-agent` no longer fails with "MCP error -32001: Request timed out" when the helper takes over a minute. A run longer than 45 seconds returns a job id, and the new `better_wait` tool returns the result.

### Changed

- README: requirements, where to start `claude`, what the band is, a "When it helps and when it doesn't" section from an A/B test ([`docs/ab-test.md`](docs/ab-test.md)), and the full example run ([`docs/example-run.md`](docs/example-run.md)).

## [0.4.2] - 2026-11-16

### Fixed

- When the helper's model call fails, the message shows the model's error instead of "exited with code 1".
- A band chip for a compound command shows the first command and "(+N more)", and a failed tool keeps why it failed in the run record.
- `2>&1`, `>&2` and `&>` are no longer read as command separators in tool labels.

### Changed

- Run records in `~/.claude/better/runs` are capped at the newest 200.
- Cursor: the improved prompt goes on the clipboard only when Cursor's "Create chat with prompt" dialog can't take it.

[Unreleased]: https://github.com/LukeFost/claude-better/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/LukeFost/claude-better/releases/tag/v0.5.1
[0.5.0]: https://github.com/LukeFost/claude-better/releases/tag/v0.5.0
[0.4.9]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.9
[0.4.8]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.8
[0.4.7]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.7
[0.4.6]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.6
[0.4.5]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.5
[0.4.4]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.4
[0.4.3]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.3
[0.4.2]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.2
