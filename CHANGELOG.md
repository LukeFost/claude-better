# Changelog

Notable changes to this plugin are recorded here. Versions before 0.4.2 are in the git history only.

## [Unreleased]

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

[Unreleased]: https://github.com/LukeFost/claude-better/compare/v0.4.5...HEAD
[0.4.5]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.5
[0.4.4]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.4
[0.4.3]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.3
[0.4.2]: https://github.com/LukeFost/claude-better/releases/tag/v0.4.2
