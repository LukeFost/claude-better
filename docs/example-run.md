# Example run

The `/better` run quoted in the README, copied from its run record (`2026-11-16T06-35-32-625Z-better-06c3f1d5.json`), with the machine-specific paths left out. Plugin 0.4.1, model `claude-opus-5-5`, exit code 0, 45.9 s.

The repo is a small fixture: `src/rate_limit.py`, `logs/ledger-429.log`, `tests/test_rate_limit.py`, a README and a `.gitignore`.

## Input

```text
/better bump the retries so the 429s stop
```

## Helper tool calls

- `ok git ls-files`
- `failed for f in .gitignore README.md logs/ledger-429.log src/rate_limit.py tests/test_rate_limit.py`
- `ok Read src/rate_limit.py`
- `ok Read logs/ledger-429.log`
- `ok Read README.md`
- `ok Read tests/test_rate_limit.py`
- `ok Read .gitignore`

The `for` loop was refused by the read-only guard; the helper then read the files one at a time.

## Output, as placed in the input box

```text
The ledger API keeps returning 429s and our client gives up. Fix it properly, not just by raising `MAX_RETRIES`.

What we have: `src/rate_limit.py` has `MAX_RETRIES = 5` and `backoff_seconds` (0.25s doubling, capped at 8s, no jitter). `logs/ledger-429.log` shows 6 attempts getting 429 in a row on 2026-11-02 and `GAVE_UP retries=5` at 10:00:17, 8s after the last 429, so we seem to sleep once more before quitting. The README says the API sends bursts of about 6 and we're "one short", but that rests on this one incident.

First, find the code that actually calls `MAX_RETRIES` and `backoff_seconds` (it isn't in this repo) and pull the raw 429 responses: headers (`Retry-After`, any `X-RateLimit-*`), timestamps for every incident you can find, and the ledger API's documented rate limit. Then tell me whether the real problem is too few retries, retry timing, or us sending requests too fast or with too much concurrency.

Then make the smallest change that fixes it:
- honor `Retry-After` when present
- exponential backoff with full jitter
- a cap on total retry time, not just retry count
- no sleep after the final failed attempt
- a client-side throttle only if the evidence shows we're going over the limit

Done means:
- `python3 -m pytest tests/` passes, with `tests/test_rate_limit.py` updated (it currently pins `MAX_RETRIES == 5`)
- a new test that replays the logged burst (6 429s, then a 200) against a fake server with an injected clock and succeeds within the time cap
- a test that `Retry-After` is honored
- a test that we don't sleep after giving up

After it ships, check the ledger logs to show `GAVE_UP` going down without total request volume going up. Tell me what you found in the raw responses, what you changed, and what you couldn't check.
```
