import { expect, mock, test } from 'claude-code/testing'

const RUNS = '/home/me/.claude/better/runs'
const rec = (i: number) => `2026-01-01T00-00-00-${String(i).padStart(3, '0')}Z-better-0000abcd.json`

type Opts = { list?: () => any[]; listThrows?: boolean; helperOut?: string; helperCode?: number; helperStderr?: string; rmCode?: number; rmThrows?: boolean; rmHang?: boolean }

function world(on: any, opts: Opts) {
  mock.clock(on)
  const seen = { spawned: [] as any[], rm: [] as string[][], written: new Map<string, string>() }
  mock.env(on, { HOME: '/home/me', PATH: '/usr/local/bin:/usr/bin' })
  on('command.register', () => ({ value: {} }))
  on('tool.register', () => ({ value: {} }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.turns', () => ({ value: 3 }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surface', () => ({ value: 'terminal' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('fs.exists', (_: any, e: any) => ({ value: e.path === '/usr/local/bin/claude' }))
  on('fs.stat', (_: any, e: any) => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', (_: any, e: any) => {
    if (opts.listThrows || e.path !== RUNS) throw new Error(`ENOENT: ${e.path}`)
    return { value: opts.list?.() ?? [] }
  })
  on('fs.write', (_: any, e: any) => (seen.written.set(e.path, e.text), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (!seen.written.has(e.path)) throw new Error(`ENOENT: ${e.path}`)
    return { value: seen.written.get(e.path) }
  })
  on('tool.check', () => ({ decision: 'allow', reason: 'core decides' }))
  on('process.spawn', async function* (_: any, e: any) {
    if (e.argv[0] === '/bin/rm') {
      seen.rm.push(e.argv)
      if (opts.rmThrows) throw new Error('spawn E2BIG')
      if (opts.rmHang) await new Promise(() => {})
      return { value: { code: opts.rmCode ?? 0, signal: null } }
    }
    seen.spawned.push(e)
    seen.written.set(e.env.CLAUDE_BETTER_GUARD_FILE, JSON.stringify({ isGuardLoaded: true }))
    if (opts.helperOut) yield { stream: 'stdout', text: opts.helperOut }
    if (opts.helperStderr) yield { stream: 'stderr', text: opts.helperStderr }
    return { value: { code: opts.helperCode ?? 0, signal: null } }
  })
  return seen
}

const ok = JSON.stringify({ type: 'result', subtype: 'success', result: '(1) a\n\n<improved-prompt>\nChecked.\n</improved-prompt>' }) + '\n'

test("a failed model call shows the model's error, not the exit code, and stderr stays in the record", async ($, on) => {
  const seen = world(on, { helperOut: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 overloaded' }) + '\n', helperCode: 1, helperStderr: 'STDERRCANARY\n' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
  const s = JSON.stringify(r)
  expect(s).toContain("model call failed: API Error: 529 overloaded")
  expect(s).not.toContain('STDERRCANARY')
  expect(s).not.toContain('exited with code')
  const log = [...seen.written.keys()].find((k) => k.startsWith(RUNS))!
  expect(seen.written.get(log)).toContain('STDERRCANARY')
})

test('the cap deletes only the oldest run records beyond 200, by exact path', async ($, on) => {
  const odd = ['-rf', 'a b.json', '../x.json', 'notes.txt', `${rec(0)}.bak`, ` ${rec(1)}`, '2026-01-01T00-00-00-000Z-better-0000ABCD.json']
  const seen = world(on, {
    helperOut: ok,
    list: () => [
      ...Array.from({ length: 205 }, (_, i) => ({ name: rec(i + 100), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
      { name: rec(1), kind: 'other', size: 0, mtimeMs: 0, isLink: true },
      { name: rec(2), kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      ...odd.map((name) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
    ],
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
  expect('result' in r && r.result).toBe('Checked.')
  expect(seen.rm).toHaveLength(1)
  expect(seen.rm[0]!.slice(0, 3)).toEqual(['/bin/rm', '-f', '--'])
  expect(seen.rm[0]!.slice(3)).toEqual([100, 101, 102, 103, 104].map((i) => `${RUNS}/${rec(i)}`))
})

for (const [n, o] of [['list throws', { listThrows: true }], ['rm cannot start', { rmThrows: true }], ['rm exits 1', { rmCode: 1 }]] as [string, Opts][]) {
  test(`a failed prune never fails the run: ${n}`, async ($, on) => {
    const seen = world(on, { helperOut: ok, list: () => Array.from({ length: 210 }, (_, i) => ({ name: rec(i), kind: 'file', size: 1, mtimeMs: 0, isLink: false })), ...o })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    const log = [...seen.written.keys()].find((k) => k.startsWith(RUNS))!
    expect('result' in r && r.result).toBe('Checked.')
    expect(JSON.parse(seen.written.get(log)!).pruneError).toBeTruthy()
  })
}
