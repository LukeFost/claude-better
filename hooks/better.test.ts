import { expect, test } from 'claude-code/testing'

import {
  BRIEF_MARK, KEEP_RUNS, StreamReader, buildBriefTask, buildHelperTask, handOverText, helperArgv, helperVerdict, parseMarkedPrompt, stageOf,
  chipLabel, isLoginFailure, staleRecords, toolLabel, toolLine, namedPaths, rootCandidates, promptFile, fillRefusal, runsDir,
} from './better'

test('the marked block is the prompt, and a missing or empty block is an error', () => {
  expect(parseMarkedPrompt('(1) a\n(4) b\n<improved-prompt>\nDo X with Y.\n</improved-prompt>')).toBe('Do X with Y.')
  expect(parseMarkedPrompt('see <improved-prompt> inline\n<improved-prompt>\nreal\n</improved-prompt>')).toBe('real')
  expect(() => parseMarkedPrompt('no block here')).toThrow(/no <improved-prompt>/)
  expect(() => parseMarkedPrompt('<improved-prompt>\n\n</improved-prompt>')).toThrow(/empty/)
})

test("the improved prompt goes above the person's draft, and the draft survives", () => {
  expect(handOverText('Improved.', '')).toBe('Improved.')
  expect(handOverText('Improved.', '  half-typed note ')).toBe('Improved.\n\nhalf-typed note')
})

test('the helper only reads: reads pass on to Claude Code, never allowed outright; writes are refused', () => {
  expect(helperVerdict('Read', undefined)).toEqual({ decision: 'pass' })
  expect(helperVerdict('Grep', undefined)).toEqual({ decision: 'pass' })
  expect(helperVerdict('Bash', true)).toEqual({ decision: 'pass' })
  expect(helperVerdict('Bash', undefined).decision).toBe('deny')
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Agent', 'mcp__claude_ai_Gmail__send_message', 'WebFetch']) {
    expect(helperVerdict(tool, true).decision).toBe('deny')
  }
})

test('the helper is a never-saved fork with read tools, and the task never rides in argv', () => {
  const argv = helperArgv({ claude: 'claude', sessionId: 'abc', model: 'claude-opus-5-5', pluginRoot: '/mods/better' })
  expect(argv).toContain('--fork-session')
  expect(argv[argv.indexOf('--resume') + 1]).toBe('abc')
  expect(argv).toContain('--no-session-persistence')
  expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('dontAsk')
  expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('')
  expect(argv[argv.indexOf('--plugin-dir') + 1]).toBe('/mods/better')
  expect(argv.slice(-2)).toEqual(['--tools', 'Read,Grep,Glob,Bash'])
  expect(helperArgv({ claude: 'claude', pluginRoot: '/m' })).not.toContain('--resume')
})

test('the tasks carry pi-better prompts and the request, and an empty request means the current task', () => {
  expect(buildHelperTask('make errors clearer')).toContain('## Prompt to deepen\n\nmake errors clearer')
  expect(buildHelperTask('')).toContain('deepen the task in progress in the conversation so far, including any feedback')
  expect(buildBriefTask('Fix foo.')).toContain('## Brief to check\n\nFix foo.')
  expect(buildBriefTask('x')).toContain('Give answers (1) to (3)')
  expect(BRIEF_MARK.test('/better Fix it')).toBe(true)
  expect(BRIEF_MARK.test('/betterment')).toBe(false)
})

test('the stream reader follows tools, the reply and the stage', () => {
  const r = new StreamReader('/repo', '/home/me')
  const lines = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cd /repo && cat /repo/README.md | head' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/home/me/x.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true }] } },
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '(1) pro\n(2) raw\n' } } },
  ]
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  r.push(text.slice(0, 50))
  r.push(text.slice(50))
  expect(r.tools.map((t) => `${t.state} ${t.label}`)).toEqual(['ok cat README.md (+1 more)', 'failed Read ~/x.md'])
  expect(stageOf(r.text).stage).toBe(2)
  r.push('not json from a hook\n')
  r.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'final <improved-prompt>' }))
  r.end()
  expect(r.reply).toBe('final <improved-prompt>')
  expect(r.resultError).toBeUndefined()
  const bad = new StreamReader('/', '')
  bad.push(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' }) + '\n')
  expect(bad.resultError).toBe('error_during_execution')
})

test('a compound command is labelled as more than its first part, and a refusal keeps its reason', () => {
  expect(toolLabel('Bash', { command: 'cat README.md' }, '/w', '/h')).toBe('cat README.md')
  expect(toolLabel('Bash', { command: "cat README.md; sed 's/=.*//' .env" }, '/w', '/h')).toBe('cat README.md (+1 more)')
  expect(toolLabel('Bash', { command: 'cd /w && cat a | head -5' }, '/w', '/h')).toBe('cat a (+1 more)')
  expect(toolLabel('Bash', { command: 'cat a\nsed b c & wait' }, '/w', '/h')).toBe('cat a (+2 more)')
  expect(toolLabel('Bash', { command: 'npm test 2>&1 | tail -5' }, '/w', '/h')).toBe('npm test 2>&1 (+1 more)')
  expect(toolLabel('Bash', { command: 'ls foo 2>&1' }, '/w', '/h')).toBe('ls foo 2>&1')
  expect(toolLabel('Bash', { command: 'cmd &>/dev/null' }, '/w', '/h')).toBe('cmd &>/dev/null')
  expect(toolLabel('Bash', { command: 'a >&2' }, '/w', '/h')).toBe('a >&2')
  expect(toolLabel('Bash', { command: 'a |& b' }, '/w', '/h')).toBe('a (+1 more)')
  const r = new StreamReader('/w', '/h')
  r.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat a; sed x b' } }] } }) + '\n')
  r.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'Permission to use Bash denied:\nnot read-only' }] }] } }) + '\n')
  expect(r.tools.map(toolLine)).toEqual(['failed cat a (+1 more): Permission to use Bash denied: not read-only'])
})

test('a long chained command keeps its "(+N more)" in the band chip', () => {
  expect(chipLabel('git log --oneline -5 (+1 more)')).toBe('git log --oneline… (+1 more)')
  expect(chipLabel('git status')).toBe('git status')
  expect(chipLabel('grep -rn helperVerdict hooks/register.tsx')).toBe('grep -rn helperVerdict hook…')
  expect(chipLabel('grep -rn helperVerdict hooks/register.tsx (+3 more)').endsWith('… (+3 more)')).toBe(true)
  expect(chipLabel('grep -rn helperVerdict hooks/register.tsx (+3 more)').length).toBe(28)
})

test('only the oldest run records beyond the cap are stale, and nothing else in the folder', () => {
  const names = Array.from({ length: KEEP_RUNS + 3 }, (_, i) => `2026-11-16T04-29-18-${String(i).padStart(3, '0')}Z-${i % 2 ? 'brief' : 'better'}-0000abcd.json`)
  const stale = staleRecords(names.toReversed().concat(['notes.txt', 'other.json', 'x-better-1.json']))
  expect(stale).toEqual(names.slice(0, 3))
  expect(staleRecords(names.slice(0, 5))).toEqual([])
})

test("a login failure of the helper's CLI is told apart from every other failure", () => {
  for (const said of [
    'Failed to authenticate: OAuth session expired and could not be refreshed', 'Not logged in · Please run /login', 'Failed to authenticate. API Error: 401 Invalid bearer token',
    'Invalid API key · Fix external API key', 'OAuth token revoked · Please run /login', 'OAuth session expired',
    'Authentication required · Sign in again to continue', 'Login expired · Please run /login', 'Login reached its time limit · Please run /login', 'Session expired. Please run /login to sign in again.',
    'OAuth refresh token is no longer valid; run /login to re-authenticate', 'API Error: 401 Invalid API key · Please run /login',
  ]) expect(isLoginFailure(said)).toBe(true)
  for (const said of ['API Error: 529 Overloaded', 'error_max_turns', 'The reply has no <improved-prompt> block.', 'Credit balance is too low',
    'API Error: 403 {"type":"permission_error","message":"OAuth authentication is currently not allowed for this organization."}', 'Your account does not have access to Claude Code. Please run /login.',
  ]) expect(isLoginFailure(said)).toBe(false)
})

test('paths named in text are found, ~ expanded, most-named first', () => {
  const found = namedPaths(['see ~/code/shop/a.ts, /etc/hosts. Also "https://x.dev/a/b" and src/rel/path', 'cd /home/me/code/shop/a.ts; cat ~/code/../.ssh/id'], '/home/me')
  expect(found[0]).toBe('/home/me/code/shop/a.ts')
  expect(found).toContain('/etc/hosts')
  expect(found.some((p) => p.includes('x.dev') || p.includes('rel') || p.includes('..'))).toBe(false)
})

test('only folders under home (not dot folders or Library) or a named volume can become read folders', () => {
  expect(rootCandidates('/home/me/code/shop/src/a.ts', '/home/me')).toEqual(['/home/me/code/shop/src/a.ts', '/home/me/code/shop/src', '/home/me/code/shop', '/home/me/code'])
  expect(rootCandidates('/Volumes/Wizard/wt/a', '/home/me')).toEqual(['/Volumes/Wizard/wt/a', '/Volumes/Wizard/wt'])
  for (const p of ['/home/me', '/home/me/.ssh/config', '/home/me/Library/App/x', '/home/me/library/Developer/x', '/home/me/LIBRARY/x', '/etc/hosts', '/home/meow/x', '/Volumes/Wizard', '/Volumes/Wizard/.claude/x']) expect(rootCandidates(p, '/home/me')).toEqual([])
  expect(rootCandidates('/home/me/code/shop/.git/config', '/home/me')).toEqual(['/home/me/code/shop', '/home/me/code'])
  expect(rootCandidates('/home/me/code/shop/.github/ci.yml', '/home/me')).toEqual(['/home/me/code/shop', '/home/me/code'])
  expect(rootCandidates('/Volumes/Backup/Users/me/.ssh/id', '/home/me')).toEqual(['/Volumes/Backup/Users/me', '/Volumes/Backup/Users'])
  expect(rootCandidates('/x/y', '/')).toEqual([])
})

const stem = (i: number) => `2026-01-01T00-00-00-00${i}Z-better-0000abcd`

test('the saved prompt sits beside its run record and is pruned with it', () => {
  expect(promptFile('/r/2026-01-01T00-00-00-000Z-better-0000abcd.json')).toBe('/r/2026-01-01T00-00-00-000Z-better-0000abcd.md')
  expect(staleRecords([`${stem(1)}.json`, `${stem(1)}.md`, `${stem(2)}.json`, `${stem(3)}.md`], 2)).toEqual([`${stem(1)}.json`, `${stem(1)}.md`])
  expect(fillRefusal('no_composer')).toContain("isn't on screen")
})

test('only an installed copy writes to runs; a checkout, a --plugin-dir copy or an override goes elsewhere', () => {
  expect(runsDir('/home/me', '/home/me/.claude/plugins/cache/claude-better/better/0.4.9')).toBe('/home/me/.claude/better/runs')
  expect(runsDir('/home/me', '/home/me/code/claude-better')).toBe('/home/me/.claude/better/runs-dev')
  expect(runsDir('/home/me', '/tmp/x/plugins/cached/better')).toBe('/home/me/.claude/better/runs-dev')
  expect(runsDir('/home/me', '/home/me/.claude/plugins/cache/claude-better/better/0.4.9', '/tmp/eval/runs/')).toBe('/tmp/eval/runs')
  expect(runsDir('/home/me', '/home/me/code/claude-better', 'relative')).toBe('/home/me/.claude/better/runs-dev')
})
