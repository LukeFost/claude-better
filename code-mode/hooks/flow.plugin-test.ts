import { expect, mock, test } from 'claude-code/testing'

// Named .plugin-test.ts, not .test.ts: `claude plugin test .` at the repo root runs every *.test.ts under it
// against the full plugin. scripts/test-code-mode.mjs runs this file against its own plugin.

// What better-code-mode does differently from better. The flows the two share
// are tested once, in the full plugin's hooks/flow.test.ts.

const reply = (body: string) =>
  [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/README.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
    { type: 'result', subtype: 'success', result: `(1) a\n(2) b\n(3) c\n(4) d\n\n<improved-prompt>\n${body}\n</improved-prompt>` },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n'

const EXPIRED = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' }) + '\n'

function world(on: any, opts: { helperOut?: string; isGuardless?: boolean; env?: Record<string, string> } = {}) {
  const clock = mock.clock(on)
  const seen = { clock, commands: [] as string[], tools: [] as string[], spawned: [] as any[], forked: [] as any[], filled: [] as string[], toasts: [] as string[], written: new Map<string, string>() }
  mock.env(on, { HOME: '/home/me', PATH: '/usr/local/bin:/usr/bin', CLAUDE_BETTER_RUNS_DIR: '/home/me/.claude/better/runs', ...opts.env })
  on('command.register', (_: any, e: any) => (seen.commands.push(e.name), { value: {} }))
  on('tool.register', (_: any, e: any) => (seen.tools.push(e.name), { value: {} }))
  on('agent.spawn', (_: any, e: any) => (seen.forked.push(e), { deny: 'no fork in this test' }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.turns', () => ({ value: 3 }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => ({ value: { version: '2.1.326', base: '2.1.326' } }))
  on('session.surface', () => ({ value: 'terminal' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.messages', () => ({ value: [] }))
  on('fs.stat', (_: any, e: any) => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.exists', (_: any, e: any) => ({ value: e.path === '/usr/local/bin/claude' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_: any, e: any) => (seen.written.set(e.path, e.text), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (!seen.written.has(e.path)) throw new Error(`ENOENT: ${e.path}`)
    return { value: seen.written.get(e.path) }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_: any, e: any) => (seen.filled.push(e.text), { isFilled: true }))
  on('ui.toast', (_: any, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('process.spawn', async function* (_: any, e: any) {
    seen.spawned.push(e)
    if (!opts.isGuardless) seen.written.set(e.env.CLAUDE_BETTER_GUARD_FILE, JSON.stringify({ isGuardLoaded: true }))
    if (opts.helperOut) yield { stream: 'stdout', text: opts.helperOut }
    return { value: { code: 0, signal: null } }
  })
  return seen
}

test('it offers /better, /better-cancel and /better-back, and neither a tool nor /better-boomerang', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(seen.commands.toSorted()).toEqual(['better', 'better-back', 'better-cancel'])
  expect(seen.tools).toEqual([])
})

test('/better runs the helper under the guard module, not under this plugin, and fills the box', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.') })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'better', args: 'make errors clearer' } as any)
  await seen.clock.settle()
  const argv: string[] = seen.spawned[0].argv
  expect(argv[argv.indexOf('--plugin-dir') + 1]).toMatch(/\/guard$/)
  expect(argv.filter((a) => a === '--plugin-dir').length).toBe(1)
  expect(seen.spawned[0].env.CLAUDE_BETTER_HELPER).toBe('1')
  expect(seen.filled).toEqual(['Deeper prompt.'])
})

test('a helper whose guard never loaded is refused, and the error names the guard module', async ($, on) => {
  const seen = world(on, { helperOut: reply('Unguarded prompt.'), isGuardless: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'better', args: 'anything' } as any)
  await seen.clock.settle()
  expect(seen.filled).toEqual([])
  expect(seen.toasts.some((t) => t.includes("read-only guard didn't load") && t.includes('/guard/hooks/register.ts'))).toBe(true)
})

test('an expired CLI login starts no fork of the session: the error names the command that fixes it', async ($, on) => {
  const seen = world(on, { helperOut: EXPIRED })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'better', args: 'anything' } as any)
  await seen.clock.settle()
  expect(seen.forked).toEqual([])
  expect(seen.filled).toEqual([])
  expect(seen.toasts.some((t) => t.includes('claude auth login') && t.includes('OAuth session expired'))).toBe(true)
})

test("loaded inside the helper, this plugin writes no guard proof: only the guard module may vouch for the guard", async ($, on) => {
  const seen = world(on, { env: { CLAUDE_BETTER_HELPER: '1', CLAUDE_BETTER_GUARD_FILE: '/home/me/.claude/better/runs/r.json' } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  expect([...seen.written.keys()]).toEqual([])
  expect(seen.commands).toEqual([])
})
