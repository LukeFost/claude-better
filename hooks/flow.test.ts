import { expect, mock, test } from 'claude-code/testing'

const reply = (body: string) =>
  [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/README.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
    { type: 'result', subtype: 'success', result: `(1) a\n(2) b\n(3) c\n\n<improved-prompt>\n${body}\n</improved-prompt>` },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n'

// Stands for the engine beneath the plugin. `spawned` records each helper launch.
function world(on: any, opts: { helperOut?: string; helperCode?: number; hang?: boolean; draft?: string; env?: Record<string, string> }) {
  const clock = mock.clock(on)
  const seen = { clock, spawned: [] as any[], filled: [] as string[], toasts: [] as string[], agentRan: [] as string[], writes: [] as string[] }
  mock.env(on, { HOME: '/home/me', ...(opts.env ?? {}) })
  on('command.register', () => ({ value: {} }))
  on('tool.register', () => ({ value: {} }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.turns', () => ({ value: 3 }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surface', () => ({ value: 'terminal' }))
  on('fs.write', (_: any, e: any) => (seen.writes.push(e.path), { value: undefined }))
  on('prompt.read', () => ({ value: { text: opts.draft ?? '', cursor: 0 } }))
  on('prompt.fill', (_: any, e: any) => (seen.filled.push(e.text), { isFilled: true }))
  on('ui.toast', (_: any, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('tool.call', { tool: 'Agent' }, (_: any, e: any) => (seen.agentRan.push(e.prompt), { result: 'subagent done' }))
  on('process.spawn', async function* (_: any, e: any) {
    seen.spawned.push(e)
    if (opts.hang) {
      await new Promise(() => {})
    }
    if (opts.helperOut) yield { stream: 'stdout', text: opts.helperOut }
    if (opts.helperCode) yield { stream: 'stderr', text: 'boom: model unavailable\n' }
    return { value: { code: opts.helperCode ?? 0, signal: null } }
  })
  return seen
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

test('a /better brief is checked first, and the subagent starts with the checked brief', async ($, on) => {
  const seen = world(on, { helperOut: reply('Fix foo in src/foo.ts:12; done when `npm test` passes.') })
  await start($)
  const r = await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix the bug we found in foo.' })
  expect(seen.spawned).toHaveLength(1)
  expect(seen.spawned[0].input).toContain('## Brief to check\n\nFix the bug we found in foo.')
  expect(seen.spawned[0].env).toEqual({ CLAUDE_BETTER_HELPER: '1' })
  expect(seen.agentRan).toEqual(['Fix foo in src/foo.ts:12; done when `npm test` passes.'])
  expect('deny' in r && r.deny).toBeFalsy()
})

test('a failed brief check launches no subagent and keeps a run log', async ($, on) => {
  const seen = world(on, { helperCode: 1 })
  await start($)
  const r = await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix it.' })
  expect(seen.agentRan).toEqual([])
  expect(JSON.stringify(r)).toContain("didn't start")
  expect(seen.writes.some((p) => p.startsWith('/home/me/.claude/better/runs/'))).toBe(true)
})

test('a reply with no marked brief launches no subagent', async ($, on) => {
  const seen = world(on, { helperOut: JSON.stringify({ type: 'result', subtype: 'success', result: 'I could not finish.' }) + '\n' })
  await start($)
  await $.tool.call({ tool: 'Agent', description: 'fix', prompt: '/better Fix it.' })
  expect(seen.agentRan).toEqual([])
})

test('an unmarked Agent prompt goes straight through, with no helper', async ($, on) => {
  const seen = world(on, {})
  await start($)
  await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'Just do it.' })
  expect(seen.spawned).toHaveLength(0)
  expect(seen.agentRan).toEqual(['Just do it.'])
})

test('the check_brief tool returns the checked brief, and an error on failure', async ($, on) => {
  const seen = world(on, { helperOut: reply('Checked brief.') })
  await start($)
  const ok = await $.tool.call({ tool: 'mcp__better__check_brief', brief: 'Rough brief.' } as any)
  expect('result' in ok && ok.result).toBe('Checked brief.')
  expect(seen.spawned[0].argv).toContain('--fork-session')
})

test("/better fills the box above the person's draft and sends nothing", async ($, on) => {
  const seen = world(on, { helperOut: reply('Deeper prompt.'), draft: 'my half-typed draft' })
  const clock = seen.clock
  await start($)
  await $.command.run({ command: 'better', args: 'make errors clearer' } as any)
  await clock.settle()
  expect(seen.spawned[0].input).toContain('## Prompt to deepen\n\nmake errors clearer')
  expect(seen.filled).toEqual(['Deeper prompt.\n\nmy half-typed draft'])
  expect(seen.agentRan).toEqual([])
})

test('/better-cancel stops the helper and nothing is filled or sent', async ($, on) => {
  const seen = world(on, { hang: true, draft: 'keep me' })
  const clock = seen.clock
  await start($)
  await $.command.run({ command: 'better', args: 'anything' } as any)
  await clock.settle()
  const again = await $.command.run({ command: 'better', args: 'second' } as any)
  expect(again.text).toContain('already running')
  const cancelled = await $.command.run({ command: 'better-cancel', args: '' } as any)
  expect(cancelled.text).toContain('cancelled')
  await clock.settle()
  expect(seen.filled).toEqual([])
  expect(seen.toasts.some((t) => t.includes('/better cancelled; nothing was sent'))).toBe(true)
})

test('inside the helper, the guard refuses writes and allows reads', async ($, on) => {
  world(on, { env: { CLAUDE_BETTER_HELPER: '1' } })
  await start($)
  const edit = await $.tool.check({ tool: 'Edit', input: { file_path: 'a', old_string: 'x', new_string: 'y' } } as any)
  expect(edit.decision).toBe('deny')
  const bashWrite = await $.tool.check({ tool: 'Bash', input: { command: 'touch zz' } } as any)
  expect(bashWrite.decision).toBe('deny')
  const read = await $.tool.check({ tool: 'Read', input: { file_path: 'README.md' } } as any)
  expect(read.decision).toBe('allow')
})
