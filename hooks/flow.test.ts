import { expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as any

const reply = (body: string) =>
  [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/README.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
    { type: 'result', subtype: 'success', result: `(1) a\n(2) b\n(3) c\n\n<improved-prompt>\n${body}\n</improved-prompt>` },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n'

type Opts = {
  helperOut?: string; helperCode?: number; hang?: boolean; draft?: string; env?: Record<string, string>
  files?: string[]; dirs?: Record<string, string[]>; spawnDeny?: string; isGuardless?: boolean; links?: Record<string, string>
  forkAnswer?: string | string[]; forkReason?: 'answer' | 'error'
  fills?: ('no_composer' | 'dialog' | 'ok')[]; isCopied?: boolean; messages?: any[]; hasPane?: boolean; submitDrop?: string
}

const loginError = (text: string) => JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: text }) + '\n'
const EXPIRED = loginError('Failed to authenticate: OAuth session expired and could not be refreshed')

function world(on: any, opts: Opts) {
  const clock = mock.clock(on)
  const at = { surface: 'terminal' as Surface }
  const seen = {
    clock, at, engine: undefined as any, spawned: [] as any[], filled: [] as string[], toasts: [] as string[], agentRan: [] as string[],
    writes: [] as string[], opened: [] as any[], closed: [] as string[], submitted: [] as any[], logs: [] as string[], copies: [] as string[], fillTries: 0, written: new Map<string, string>(), views: [] as any[], forked: [] as any[], ran: [] as any[], pending: [] as (() => Promise<unknown>)[], reset() {
      seen.fillTries = 0
      for (const k of ['opened', 'closed', 'submitted', 'logs', 'copies', 'spawned', 'filled', 'toasts', 'agentRan', 'writes', 'views', 'forked', 'ran', 'pending'] as const) seen[k].length = 0
    },
  }
  const files = new Set(opts.files ?? ['/usr/local/bin/claude'])
  mock.env(on, { HOME: '/home/me', PATH: '/usr/local/bin:/usr/bin', CLAUDE_BETTER_RUNS_DIR: '/home/me/.claude/better/runs', ...opts.env })
  on('command.register', () => ({ value: {} }))
  on('tool.register', () => ({ value: {} }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.turns', () => ({ value: 3 }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('fs.stat', (_: any, e: any) => {
    const parts: string[] = []
    for (const p of e.path.split('/')) if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p)
    let real = `/${parts.join('/')}`
    for (const [from, to] of Object.entries(opts.links ?? {})) if (real === from || real.startsWith(`${from}/`)) real = to + real.slice(from.length)
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, ...(e.options?.resolve || e.resolve ? { realPath: real } : {}) } }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => ({ value: { version: '2.1.317', base: '2.1.317' } }))
  on('session.surface', () => ({ value: at.surface }))
  on('session.surfaces', () => ({ value: [at.surface] }))
  on('fs.exists', (_: any, e: any) => ({ value: files.has(e.path) }))
  on('fs.list', (_: any, e: any) => {
    const names = opts.dirs?.[e.path]
    if (!names) throw new Error(`ENOENT: ${e.path}`)
    return { value: names.map((name) => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }
  })
  const written = seen.written
  on('fs.write', (_: any, e: any) => (seen.writes.push(e.path), written.set(e.path, e.text), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (!written.has(e.path)) throw new Error(`ENOENT: ${e.path}`)
    return { value: written.get(e.path) }
  })
  on('tool.check', () => ({ decision: 'allow', reason: 'core decides' }))
  on('prompt.read', () => ({ value: { text: opts.draft ?? '', cursor: 0 } }))
  on('prompt.fill', (_: any, e: any) => {
    const how = opts.fills ? opts.fills[Math.min(seen.fillTries, opts.fills.length - 1)] : 'ok'
    seen.fillTries++
    if (how === 'ok') return (seen.filled.push(e.text), { isFilled: true })
    return { isFilled: false, refusal: how }
  })
  on('ui.copy', (_: any, e: any) => (seen.copies.push(e.text), { value: opts.isCopied ? { isCopied: true } : { isCopied: false, reason: 'no-clipboard' } }))
  on('ui.open', (_: any, e: any) => (seen.opened.push(e), { value: opts.hasPane && at.surface === 'desktop' ? { isPlaced: true } : { isPlaced: false, reason: 'no-surface' } }))
  on('ui.close', (_: any, e: any) => (seen.closed.push(e.id), { value: undefined }))
  on('prompt.submit', (_: any, e: any) => (opts.submitDrop ? { drop: opts.submitDrop } : (seen.submitted.push(e), { text: e.text })))
  on('ui.log', (_: any, e: any) => (seen.logs.push(e.text), { value: undefined }))
  on('session.messages', () => ({ value: opts.messages ?? [] }))
  on('ui.toast', (_: any, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.view', (_: any, e: any) => (seen.views.push(e), { value: at.surface === 'terminal' ? {} : { deny: 'no main view here' } }))
  if (opts.spawnDeny) on('agent.spawn', (_: any, e: any) => (seen.forked.push(e), { deny: opts.spawnDeny }))
  else if (opts.forkAnswer !== undefined) {
    const answers = [opts.forkAnswer].flat()
    on('agent.spawn', async (_: any, e: any) => {
      const agentId = `fork-${seen.forked.push(e)}`
      await seen.engine.turn.start({ agentId, turnId: 't', text: e.prompt })
      seen.pending.push(() => seen.engine.turn.complete({ agentId, turnId: 't', reason: opts.forkReason ?? 'answer', answer: answers[Math.min(seen.forked.length, answers.length) - 1], durationMs: 1, isAborted: false }))
      return { model: 'claude-opus-5-5' }
    })
  }
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId ?? 't' }))
  on('tool.call', { tool: 'Agent' }, (_: any, e: any) => (seen.agentRan.push(e.prompt), { result: 'subagent done' }))
  on('process.run', async (_: any, e: any) => {
    seen.ran.push(e.argv)
    if (seen.ran.length % 2 === 0) for (const end of seen.pending.splice(0)) await end()
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('process.spawn', async function* (_: any, e: any) {
    seen.spawned.push(e)
    if (!opts.isGuardless) written.set(e.env.CLAUDE_BETTER_GUARD_FILE, JSON.stringify({ isGuardLoaded: true }))
    if (opts.hang) {
      await new Promise(() => {})
    }
    if (opts.helperOut) yield { stream: 'stdout', text: opts.helperOut }
    if (opts.helperCode) yield { stream: 'stderr', text: 'boom: model unavailable\n' }
    return { value: { code: opts.helperCode ?? 0, signal: null } }
  })
  return seen
}

const lastRecord = (seen: ReturnType<typeof world>) => JSON.parse(seen.written.get(seen.writes.findLast((p) => p.endsWith('.json'))!)!)

async function eachSurface($: any, seen: ReturnType<typeof world>, run: (surface: Surface) => Promise<void>) {
  seen.engine = $
  for (const surface of SURFACES) {
    seen.at.surface = surface
    seen.reset()
    await $.session.start({ cwd: '/repo', surface, isInteractive: true })
    await run(surface)
  }
}

test('a /better brief is checked first, and the subagent starts with the checked brief', async ($, on) => {
  const seen = world(on, { helperOut: reply('Fix foo in src/foo.ts:12; done when `npm test` passes.') })
  await eachSurface($, seen, async () => {
    const r = await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix the bug we found in foo.' })
    expect(seen.spawned).toHaveLength(1)
    expect(seen.spawned[0].argv[0]).toBe('/usr/local/bin/claude')
    expect(seen.spawned[0].input).toContain('## Brief to check\n\nFix the bug we found in foo.')
    expect(seen.spawned[0].env.CLAUDE_BETTER_HELPER).toBe('1')
    expect(seen.spawned[0].env.CLAUDE_BETTER_GUARD_FILE).toMatch(/^\/home\/me\/.claude\/better\/runs\/.*-brief-.*\.json$/)
    expect(seen.agentRan).toEqual(['Fix foo in src/foo.ts:12; done when `npm test` passes.'])
    expect('deny' in r && r.deny).toBeFalsy()
  })
})

test('a failed brief check launches no subagent and keeps a run log', async ($, on) => {
  const seen = world(on, { helperCode: 1 })
  await eachSurface($, seen, async () => {
    const r = await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix it.' })
    expect(seen.agentRan).toEqual([])
    expect(JSON.stringify(r)).toContain("didn't start")
    expect(JSON.stringify(r)).not.toContain('model unavailable')
    expect(JSON.stringify(r)).toContain('/home/me/.claude/better/runs/')
    expect(seen.writes.some((p) => p.startsWith('/home/me/.claude/better/runs/'))).toBe(true)
  })
})

test('a reply with no marked brief launches no subagent', async ($, on) => {
  const seen = world(on, { helperOut: JSON.stringify({ type: 'result', subtype: 'success', result: 'I could not finish.' }) + '\n' })
  await eachSurface($, seen, async () => {
    await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix it.' })
    expect(seen.agentRan).toEqual([])
  })
})

test('an unmarked Agent prompt goes straight through, with no helper', async ($, on) => {
  const seen = world(on, {})
  await eachSurface($, seen, async () => {
    await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'Just do it.' })
    expect(seen.spawned).toHaveLength(0)
    expect(seen.agentRan).toEqual(['Just do it.'])
  })
})

test('the check_brief tool returns the checked brief, and an error on failure', async ($, on) => {
  const seen = world(on, { helperOut: reply('Checked brief.') })
  await eachSurface($, seen, async () => {
    const ok = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect('result' in ok && ok.result).toBe('Checked brief.')
    expect(seen.spawned[0].argv).toContain('--fork-session')
  })
})

test("/better fills the box above the person's draft and sends nothing", async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), draft: 'my half-typed draft' })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'make errors clearer' } as any)
    await seen.clock.settle()
    expect(seen.spawned[0].input).toContain('## Prompt to deepen\n\nmake errors clearer')
    expect(seen.filled).toEqual(['Deeper prompt.\n\nmy half-typed draft'])
    expect(seen.agentRan).toEqual([])
  })
})

test('/better-cancel stops the helper and nothing is filled or sent', async ($, on) => {
  const seen = world(on, { hang: true, draft: 'keep me' })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'anything' } as any)
    await seen.clock.settle()
    const again = await $.command.run({ command: 'better', args: 'second' } as any)
    expect(again.text).toContain('already running')
    const cancelled = await $.command.run({ command: 'better-cancel', args: '' } as any)
    expect(cancelled.text).toContain('cancelled')
    await seen.clock.settle()
    expect(seen.filled).toEqual([])
    expect(seen.toasts.some((t) => t.includes('/better cancelled; nothing was sent'))).toBe(true)
  })
})

test("the band's cancel button stops the helper", async ($, on) => {
  const seen = world(on, { hang: true })
  await eachSurface($, seen, async (surface) => {
    await $.command.run({ command: 'better', args: 'anything' } as any)
    await seen.clock.settle()
    const ui = await $.ui.mount({ plugin: 'better', surface, ...BAND })
    expect(await ui.find({ type: 'Button', key: 'cancel' })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await seen.clock.settle()
    await ui.unmount()
    expect(seen.filled).toEqual([])
    expect(seen.toasts.some((t) => t.includes('/better cancelled; nothing was sent'))).toBe(true)
  })
})

test('auto mode refusing the fork says how to go on, and nothing starts', async ($, on) => {
  const seen = world(on, { spawnDeny: 'The server-side auto mode classifier gave no verdict for Agent: the request that produced this action did not ask for one.' })
  await eachSurface($, seen, async () => {
    const r = await $.command.run({ command: 'better-boomerang', args: 'x' } as any)
    expect(r.text).toContain("can't start its fork in auto mode")
    expect(seen.views).toEqual([])
  })
})

test("the helper's claude is found off PATH, as a Dock-launched app has it", async ($, on) => {
  const seen = world(on, { helperOut: reply('Checked.'), env: { PATH: '/usr/bin:/bin' }, files: ['/home/me/.local/bin/claude'] })
  await eachSurface($, seen, async () => {
    await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect(seen.spawned[0].argv[0]).toBe('/home/me/.local/bin/claude')
  })
})

test("with no CLI anywhere, the desktop app's own engine runs the helper", async ($, on) => {
  const engine = '/home/me/Library/Application Support/Claude/claude-code/2.1.317'
  const seen = world(on, {
    helperOut: reply('Checked.'), env: { PATH: '/usr/bin:/bin' },
    files: [`${engine}/91184d3d9ba3/claude.app/Contents/MacOS/claude`], dirs: { [engine]: ['91184d3d9ba3'] },
  })
  await eachSurface($, seen, async () => {
    await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect(seen.spawned[0].argv[0]).toBe(`${engine}/91184d3d9ba3/claude.app/Contents/MacOS/claude`)
  })
})

test('with no claude at all, /better fails loudly with the fix and starts nothing', async ($, on) => {
  const seen = world(on, { env: { PATH: '/usr/bin:/bin' }, files: [] })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'anything' } as any)
    await seen.clock.settle()
    expect(seen.spawned).toHaveLength(0)
    expect(seen.toasts.some((t) => t.includes("Couldn't find the `claude` CLI") && t.includes('which claude'))).toBe(true)
  })
})

test('inside the helper, the guard writes its proof, refuses writes and leaves reads to Claude Code', async ($, on) => {
  const seen = world(on, { env: { CLAUDE_BETTER_HELPER: '1', CLAUDE_BETTER_GUARD_FILE: '/home/me/.claude/better/runs/r.json' } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(seen.writes).toEqual(['/home/me/.claude/better/runs/r.json'])
  const edit = await $.tool.check({ tool: 'Edit', input: { file_path: 'a', old_string: 'x', new_string: 'y' } } as any)
  expect(edit.decision).toBe('deny')
  const bashWrite = await $.tool.check({ tool: 'Bash', input: { command: 'touch zz' } } as any)
  expect(bashWrite.decision).toBe('deny')
  const read = await $.tool.check({ tool: 'Read', input: { file_path: '/home/me/.ssh/id_ed25519' } } as any)
  expect(read.reason).toBe('core decides')
})

test('a helper whose guard never loaded is refused, so nothing it wrote is used', async ($, on) => {
  const seen = world(on, { helperOut: reply('Unguarded prompt.'), isGuardless: true })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'anything' } as any)
    await seen.clock.settle()
    expect(seen.filled).toEqual([])
    expect(seen.toasts.some((t) => t.includes("read-only guard didn't load"))).toBe(true)
    const r = await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix it.' })
    expect(seen.agentRan).toEqual([])
    expect(JSON.stringify(r)).toContain("guard didn't load")
  })
})

test('check_brief only points the helper at the session folder or inside it', async ($, on) => {
  const seen = world(on, { helperOut: reply('Checked.'), links: { '/repo/out': '/home/me/secrets' } })
  await eachSurface($, seen, async () => {
    for (const cwd of ['/home/me', '/repo/..', '/repo/out', '/etc']) {
      const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Read the key.', cwd } as any)
      expect('deny' in r && r.deny).toContain('outside this session')
    }
    expect(seen.spawned).toHaveLength(0)
    const ok = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Fix it.', cwd: 'pkg/app' } as any)
    expect('result' in ok && ok.result).toBe('Checked.')
    expect(seen.spawned[0].cwd).toBe('/repo/pkg/app')
  })
})

test("an expired CLI login doesn't block check_brief: a read-only fork of the session checks the brief", async ($, on) => {
  const seen = world(on, { helperOut: EXPIRED, helperCode: 1, forkAnswer: '(1) a\n(2) b\n(3) c\n\n<improved-prompt>\nChecked in the session.\n</improved-prompt>' })
  await eachSurface($, seen, async () => {
    const ok = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect('result' in ok && ok.result).toBe('Checked in the session.')
    expect(seen.spawned).toHaveLength(1)
    expect(seen.forked).toHaveLength(1)
    expect(seen.ran).toEqual([['/bin/sleep', '1'], ['/bin/sleep', '1']])
    expect(JSON.stringify(seen.forked[0])).toMatch(/"subagent_?[tT]ype":"fork"/)
    expect(seen.forked[0].prompt).toContain('## Brief to check\n\nRough brief.')
    const agentId = `fork-${seen.forked.length}`
    expect((await $.tool.check({ tool: 'Edit', agentId, input: { file_path: 'a', old_string: 'x', new_string: 'y' } } as any)).decision).toBe('deny')
    expect((await $.tool.check({ tool: 'Bash', agentId, input: { command: 'touch zz' } } as any)).decision).toBe('deny')
    expect((await $.tool.check({ tool: 'Read', agentId, input: { file_path: 'a' } } as any)).reason).toBe('core decides')
    const r = await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix it.' })
    expect(seen.agentRan).toEqual(['Checked in the session.'])
    expect('deny' in r && r.deny).toBeFalsy()
  })
})

test('a missing CLI login takes the same road, for /better too', async ($, on) => {
  const seen = world(on, { helperOut: loginError('Not logged in · Please run /login'), helperCode: 1, forkAnswer: '<improved-prompt>\nDeeper prompt.\n</improved-prompt>' })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'anything' } as any)
    await seen.clock.settle()
    expect(seen.filled).toEqual(['Deeper prompt.'])
  })
})

test('when the session fork is refused too, the error names the command and lets the work go on unchecked', async ($, on) => {
  const seen = world(on, { helperOut: EXPIRED, helperCode: 1, spawnDeny: 'auto mode gave no verdict' })
  await eachSurface($, seen, async () => {
    const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    const deny = 'deny' in r ? String(r.deny) : ''
    expect(deny).toContain('`claude auth login`')
    expect(deny).toContain('you may start the work with the unchecked brief')
    expect(deny).toContain('auto mode gave no verdict')
    expect(deny).not.toContain('do not start')
    const a = await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix it.' })
    expect(seen.agentRan).toEqual([])
    expect(JSON.stringify(a)).toContain('`claude auth login`')
    expect(JSON.stringify(a)).toContain('without the /better prefix')
    await $.command.run({ command: 'better', args: 'anything' } as any)
    await seen.clock.settle()
    expect(seen.toasts.some((t) => t.includes('`claude auth login`'))).toBe(true)
    expect(seen.filled).toEqual([])
  })
})

test('a session fork that ran and failed is not a checked brief, and still blocks the work', async ($, on) => {
  const seen = world(on, { helperOut: EXPIRED, helperCode: 1, forkAnswer: '', forkReason: 'error' })
  await eachSurface($, seen, async () => {
    const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect('result' in r && r.result).toBeFalsy()
    expect('deny' in r && String(r.deny)).toContain('`claude auth login`')
    expect('deny' in r && String(r.deny)).toContain('do not start the work with it')
  })
})

test('a failure that is not a login problem starts no session fork and still blocks the work', async ($, on) => {
  const seen = world(on, { helperOut: loginError('API Error: 529 Overloaded'), helperCode: 1, forkAnswer: '<improved-prompt>\nNever used.\n</improved-prompt>' })
  await eachSurface($, seen, async () => {
    const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect(seen.forked).toHaveLength(0)
    expect('deny' in r && String(r.deny)).toContain('do not start the work with it')
  })
})

const UNMARKED = '(1) a\n<improved-prompt>\nLost its end.\n</improked-prompt>'

test('a session fork whose reply has no marked block is run once more', async ($, on) => {
  const seen = world(on, { helperOut: EXPIRED, helperCode: 1, forkAnswer: [UNMARKED, '<improved-prompt>\nSecond try.\n</improved-prompt>'] })
  await eachSurface($, seen, async () => {
    const ok = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect('result' in ok && ok.result).toBe('Second try.')
    expect(seen.forked).toHaveLength(2)
  })
})

test('a session fork that is unusable twice is not run a third time, and blocks the work', async ($, on) => {
  const twice = world(on, { helperOut: EXPIRED, helperCode: 1, forkAnswer: UNMARKED })
  await eachSurface($, twice, async () => {
    const r = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect(twice.forked).toHaveLength(2)
    expect('deny' in r && String(r.deny)).toContain('do not start the work with it')
    expect('deny' in r && String(r.deny)).toContain('unusable twice')
  })
})

test("a logged-out CLI started from the desktop app ('Authentication required') takes the session fork too", async ($, on) => {
  const seen = world(on, { helperOut: loginError('Authentication required · Sign in again to continue'), helperCode: 1, forkAnswer: '<improved-prompt>\nChecked while logged out.\n</improved-prompt>' })
  await eachSurface($, seen, async () => {
    const ok = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect('result' in ok && ok.result).toBe('Checked while logged out.')
    expect(seen.forked).toHaveLength(1)
  })
})

test("the CLI's own authentication_failed mark takes the session fork, whatever words come with it", async ($, on) => {
  const out = JSON.stringify({ type: 'assistant', error: 'authentication_failed', is_api_error_message: true, message: { content: [{ type: 'text', text: 'Some wording nobody has seen yet' }] } }) + '\n' + loginError('Some wording nobody has seen yet')
  const seen = world(on, { helperOut: out, helperCode: 1, forkAnswer: '<improved-prompt>\nChecked by the mark.\n</improved-prompt>' })
  await eachSurface($, seen, async () => {
    const ok = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
    expect('result' in ok && ok.result).toBe('Checked by the mark.')
    expect(seen.forked).toHaveLength(1)
  })
})

test('a box that is briefly away is tried again, and the prompt lands once it is back', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), fills: ['no_composer', 'dialog', 'ok'] })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'x' } as any)
    await seen.clock.settle()
    expect(seen.fillTries).toBe(3)
    expect(seen.filled).toEqual(['Deeper prompt.'])
    expect(lastRecord(seen).handover).toEqual({ result: 'filled', tries: 3 })
    expect(seen.copies).toEqual([])
    expect(seen.toasts.at(-1)).toContain('is in your input box')
  })
})

test('when the box and the clipboard both refuse, the whole prompt is saved as a .md file, shown in the chat and kept for a retry', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt,\nsecond line.'), fills: ['no_composer'] })
  await eachSurface($, seen, async (surface) => {
    await $.command.run({ command: 'better', args: 'x' } as any)
    await seen.clock.settle()
    expect(seen.fillTries).toBe(6)
    expect(seen.filled).toEqual([])
    const md = seen.writes.find((p) => p.endsWith('.md'))!
    expect(md).toMatch(/^\/home\/me\/.claude\/better\/runs\/.*-better-[0-9a-f]{8}\.md$/)
    expect(seen.written.get(md)).toBe('Deeper prompt,\nsecond line.\n')
    expect(seen.logs.join('\n')).toContain('Deeper prompt,\nsecond line.')
    const toast = seen.toasts.at(-1)!
    expect(toast).toContain(md)
    expect(toast).toContain("The input box couldn't take the prompt")
    expect(toast).toContain('Nothing was sent')
    expect(toast).not.toContain('clipboard')
    expect(lastRecord(seen).handover).toEqual({ result: 'kept', tries: 6, isCopied: false, savedTo: md })
    expect(lastRecord(seen).checked).toBe('Deeper prompt,\nsecond line.')
    expect(seen.agentRan).toEqual([])
    const ui = await $.ui.mount({ plugin: 'better', surface, ...BAND })
    expect(await ui.find({ type: 'Button', key: 'put' })).toBeDefined()
    await ui.press({ key: 'drop' })
    await seen.clock.settle()
  })
})

test('the waiting prompt goes in the box from the band button or /better-back once the box is back', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), fills: ['no_composer', 'no_composer', 'no_composer', 'no_composer', 'no_composer', 'no_composer', 'no_composer', 'ok'], isCopied: true })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'x' } as any)
    await seen.clock.settle()
    expect(seen.copies).toEqual(['Deeper prompt.'])
    expect(seen.toasts.at(-1)).toContain('on your clipboard')
    const still = await $.command.run({ command: 'better-back', args: '' } as any)
    expect(still.text).toContain("still couldn't take")
    expect(seen.filled).toEqual([])
    const back = await $.command.run({ command: 'better-back', args: '' } as any)
    expect(back.text).toContain('is in your input box')
    expect(lastRecord(seen).handover).toEqual({ result: 'filled_later', tries: 1 })
    expect(seen.filled).toEqual(['Deeper prompt.'])
    expect((await $.command.run({ command: 'better-back', args: '' } as any)).text).toContain('No /better draft is waiting')
  })
})

test('the helper may read the repos the conversation names outside the session folder, and nothing else', async ($, on) => {
  const seen = world(on, {
    helperOut: reply('Deeper prompt.'),
    files: ['/usr/local/bin/claude', '/home/me/code/shop/.git', '/home/me/.ssh/.git', '/home/me/Library/x/.git', '/home/me/.git', '/etc/.git', '/repo/sub/.git'],
    messages: [
      { role: 'user', text: 'look at ~/code/shop/src/cart.ts and /etc/hosts and ~/.ssh/config and ~/notes/todo.md', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Bash', input: { command: 'cd /home/me/code/shop && ls /home/me/Library/x/y /repo/sub/a' } }] },
    ],
  })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'speed up CI' } as any)
    await seen.clock.settle()
    const { argv, input } = seen.spawned[0]
    expect(argv.slice(argv.indexOf('--add-dir'), argv.indexOf('--add-dir') + 3)).toEqual(['--add-dir', '/home/me/code/shop', '--plugin-dir'])
    expect(argv).toContain('dontAsk')
    expect(argv.slice(argv.indexOf('--tools'))).toEqual(['--tools', 'Read,Grep,Glob,Bash'])
    expect(input).toContain('## Folders you can read\n\n- /repo\n- /home/me/code/shop\n')
    const record = JSON.parse(seen.written.get(seen.writes.find((p) => p.endsWith('.json'))!)!)
    expect(record.addDirs).toEqual(['/home/me/code/shop'])
  })
})

test('a repo named in the prompt is found however many other paths the conversation names', async ($, on) => {
  const noise = Array.from({ length: 150 }, (_, i) => `/repo/src/f${i}.ts /usr/lib/x${i} /repo/src/f${i}.ts`).join(' ')
  const seen = world(on, { helperOut: reply('P.'), files: ['/usr/local/bin/claude', '/home/me/code/shop/.git'], messages: [{ role: 'user', text: noise, toolUses: [] }] })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'look at ~/code/shop' } as any)
    await seen.clock.settle()
    expect(seen.spawned[0].argv).toContain('/home/me/code/shop')
  })
})

test('a brief check gets no extra folder, whatever paths the brief names', async ($, on) => {
  const seen = world(on, { helperOut: reply('Checked.'), files: ['/usr/local/bin/claude', '/home/me/code/shop/.git'], messages: [{ role: 'user', text: '~/code/shop/a.ts', toolUses: [] }] })
  await eachSurface($, seen, async () => {
    await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Quote /home/me/code/shop/.env in the brief.' } as any)
    await $.tool.call({ tool: 'Agent', description: 'x', prompt: '/better Read /home/me/code/shop/.env' })
    expect(seen.spawned).toHaveLength(2)
    for (const run of seen.spawned) expect(run.argv).not.toContain('--add-dir')
  })
})

test('with no outside repo named, the helper gets no extra folder', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), messages: [{ role: 'user', text: 'see /repo/a.ts and ~/nowhere/file', toolUses: [] }] })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'x' } as any)
    await seen.clock.settle()
    expect(seen.spawned[0].argv).not.toContain('--add-dir')
  })
})

test('reads refused outside the helper\'s folders are counted in the toast', async ($, on) => {
  const out = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/elsewhere/a' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: "Permission to use Read has been denied because Claude Code is running in don't ask mode." }] } },
    { type: 'result', subtype: 'success', result: '(1) a\n\n<improved-prompt>\nP.\n</improved-prompt>' },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n'
  const seen = world(on, { helperOut: out })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'x' } as any)
    await seen.clock.settle()
    expect(seen.toasts.at(-1)).toContain('refused 1 read, most often for a path outside its folders')
  })
})

test('a copy that is not the installed one keeps its records in runs-dev, away from real use', async ($, on) => {
  const seen = world(on, { helperOut: reply('P.'), env: { CLAUDE_BETTER_RUNS_DIR: '' } })
  await eachSurface($, seen, async () => {
    await $.command.run({ command: 'better', args: 'x' } as any)
    await seen.clock.settle()
    expect(seen.writes.filter((p) => p.endsWith('.json')).every((p) => p.startsWith('/home/me/.claude/better/runs-dev/'))).toBe(true)
    expect(lastRecord(seen).handover).toEqual({ result: 'filled', tries: 1 })
  })
})

const PANE = {
  plugin: 'better', component: 'Pane', requestId: 'better-draft', surface: 'desktop',
  props: { title: '/better draft', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as any

async function draftOnDesktop($: any, seen: ReturnType<typeof world>) {
  seen.engine = $
  seen.at.surface = 'desktop'
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'better', args: 'x' } as any)
  await seen.clock.settle()
}

test('on desktop the improved prompt opens in a draft pane, saved beside its record, and nothing is filled or sent', async ($, on) => {
  const seen = world(on, { helperOut: reply('# Deeper prompt\n\n- one'), hasPane: true })
  await draftOnDesktop($, seen)
  expect(seen.opened).toEqual([{ id: 'better-draft', title: '/better draft' }])
  expect(seen.filled).toEqual([])
  expect(seen.submitted).toEqual([])
  const md = seen.writes.find((p) => p.endsWith('.md'))!
  expect(seen.written.get(md)).toBe('# Deeper prompt\n\n- one\n')
  expect(lastRecord(seen).handover).toEqual({ result: 'pane', tries: 0, savedTo: md })
  expect(seen.toasts.filter((t) => /pane/.test(t))).toEqual([])
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# Deeper prompt\n\n- one')
  expect(await ui.find({ type: 'Button', key: 'send' })).toBeDefined()
  await ui.unmount()
})

test('a pane that cannot be placed, or a terminal, falls back to the input box', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.') })
  await eachSurface($, seen, async (surface) => {
    await $.command.run({ command: 'better', args: 'x' } as any)
    await seen.clock.settle()
    expect(seen.filled).toEqual(['Deeper prompt.'])
    expect(seen.opened).toHaveLength(surface === 'desktop' ? 1 : 0)
    expect(seen.closed).toEqual(surface === 'desktop' ? ['better-draft'] : [])
    expect(lastRecord(seen).handover).toEqual({ result: 'filled', tries: 1 })
  })
})

test('Edit shows the prompt in a text box; Enter saves the edit without sending, and Send to thread submits the edited text once', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), hasPane: true })
  await draftOnDesktop($, seen)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'edit-it' })
  expect((await ui.find({ type: 'Input', key: 'edit' }))?.props.value).toBe('Deeper prompt.')
  expect(await ui.find({ type: 'Text', text: /Shift\+Enter adds a line/ })).toBeDefined()
  await ui.input({ key: 'edit', text: 'Deeper prompt.\n\nMy line.', kind: 'change' })
  expect(seen.submitted).toEqual([])
  await ui.input({ key: 'edit', text: 'Deeper prompt.\n\nMy line.', kind: 'submit' })
  expect(seen.submitted).toEqual([])
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Deeper prompt.\n\nMy line.')
  expect(await ui.find({ type: 'Text', text: /Edited by you/ })).toBeDefined()
  await ui.press({ key: 'send' })
  expect(seen.submitted.map((e) => [e.text, e.origin?.asUser])).toEqual([['Deeper prompt.\n\nMy line.', true]])
  expect(seen.closed).toEqual(['better-draft'])
  expect(lastRecord(seen).handover).toEqual({ result: 'sent', tries: 0, viaPane: true, isEdited: true })
  expect(seen.toasts.filter((t) => /sent to the thread/.test(t))).toEqual([])
  await ui.press({ key: 'send' }).catch(() => {})
  expect(seen.submitted).toHaveLength(1)
  await ui.unmount()
})

test('Done keeps what was typed, and discard edit drops it', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), hasPane: true })
  await draftOnDesktop($, seen)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'edit-it' })
  await ui.input({ key: 'edit', text: 'Thrown away.', kind: 'change' })
  await ui.press({ key: 'undo' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Deeper prompt.')
  await ui.press({ key: 'edit-it' })
  await ui.input({ key: 'edit', text: 'Kept.', kind: 'change' })
  await ui.press({ key: 'done' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Kept.')
  expect(seen.submitted).toEqual([])
  await ui.unmount()
})

test('a refused send keeps the draft in the pane and says nothing was sent', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), hasPane: true, submitDrop: 'a Stop stands' })
  await draftOnDesktop($, seen)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'send' })
  expect(seen.toasts.at(-1)).toContain('a Stop stands')
  expect(seen.toasts.at(-1)).toContain('nothing was sent')
  expect(seen.closed).toEqual([])
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Deeper prompt.')
  await ui.unmount()
})

test('Put in input box and drop both close the pane; neither sends', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), hasPane: true })
  await draftOnDesktop($, seen)
  let ui = await $.ui.mount(PANE)
  await ui.press({ key: 'box' })
  expect(seen.filled).toEqual(['Deeper prompt.'])
  expect(lastRecord(seen).handover).toEqual({ result: 'filled', tries: 1, viaPane: true })
  await ui.unmount()
  await $.command.run({ command: 'better', args: 'y' } as any)
  await seen.clock.settle()
  ui = await $.ui.mount(PANE)
  await ui.press({ key: 'drop' })
  expect(lastRecord(seen).handover).toEqual({ result: 'dropped', tries: 0, viaPane: true })
  expect(seen.toasts.at(-1)).toContain('nothing was sent')
  expect(seen.closed).toEqual(['better-draft', 'better-draft'])
  expect(seen.submitted).toEqual([])
  expect((await ui.find({ type: 'Text', text: /No \/better draft/ }))).toBeDefined()
  await ui.unmount()
})

test('/better-back reopens the draft pane with the draft still in it, and sends nothing', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), hasPane: true })
  await draftOnDesktop($, seen)
  const said = await $.command.run({ command: 'better-back', args: '' } as any)
  expect(said.text).toContain('pane is open')
  expect(seen.opened.at(-1)).toEqual({ id: 'better-draft', title: '/better draft', focus: true })
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Deeper prompt.')
  expect(seen.submitted).toEqual([])
  expect(seen.filled).toEqual([])
  await ui.unmount()
})

test('a draft whose pane the person closed shows a Show draft row; pressing it reopens the pane and sends nothing', async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), hasPane: true })
  // No test can play the person's close, so the stored draft is read back as that close leaves it.
  let isHidden = false
  on('state.get', async (_: any, e: any, next: any) => {
    const got = await next(e)
    const draft = got?.value?.value
    return isHidden && e.key === 'draft' && draft ? { value: { ...got.value, value: { ...draft, isHidden: true } } } : got
  })
  await draftOnDesktop($, seen)
  let band = await $.ui.mount({ plugin: 'better', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Button', key: 'show' })).toBeUndefined()
  await band.unmount()
  isHidden = true
  band = await $.ui.mount({ plugin: 'better', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: /draft is waiting/ })).toBeDefined()
  await band.press({ key: 'show' })
  expect(seen.opened.at(-1)).toEqual({ id: 'better-draft', title: '/better draft', focus: true })
  isHidden = false
  await band.redraw()
  expect(await band.find({ type: 'Button', key: 'show' })).toBeUndefined()
  expect(seen.submitted).toEqual([])
  expect(seen.filled).toEqual([])
  await band.unmount()
})
