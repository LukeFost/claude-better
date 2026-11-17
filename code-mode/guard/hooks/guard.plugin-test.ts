import { expect, mock, test } from 'claude-code/testing'

// Named .plugin-test.ts, not .test.ts: `claude plugin test .` at the repo root runs every *.test.ts under it
// against the full plugin. scripts/test-code-mode.mjs runs this file against its own plugin.

function world(on: any, env: Record<string, string>) {
  const writes: string[] = []
  mock.env(on, { HOME: '/home/me', ...env })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('fs.write', (_: any, e: any) => (writes.push(e.path), { value: undefined }))
  on('tool.check', () => ({ decision: 'allow', reason: 'core decides' }))
  return writes
}

test('inside the helper, the guard writes its proof, refuses writes and leaves reads to Claude Code', async ($, on) => {
  const writes = world(on, { CLAUDE_BETTER_HELPER: '1', CLAUDE_BETTER_GUARD_FILE: '/home/me/.claude/better/runs/r.json' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  expect(writes).toEqual(['/home/me/.claude/better/runs/r.json'])
  expect((await $.tool.check({ tool: 'Edit', input: { file_path: 'a', old_string: 'x', new_string: 'y' } } as any)).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'touch zz' } } as any)).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Agent', input: { prompt: 'go' } } as any)).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/repo/a.md' } } as any)).reason).toBe('core decides')
})

test('outside the helper, the guard writes nothing and refuses nothing', async ($, on) => {
  const writes = world(on, { CLAUDE_BETTER_GUARD_FILE: '/home/me/.claude/better/runs/r.json' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(writes).toEqual([])
  expect((await $.tool.check({ tool: 'Edit', input: { file_path: 'a', old_string: 'x', new_string: 'y' } } as any)).reason).toBe('core decides')
})
