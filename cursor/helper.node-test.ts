import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pruneRuns, runHelper } from './helper.ts'
import { KEEP_RUNS } from '../hooks/better.ts'

function fakeClaude(script: string): { home: string; restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'better-home-'))
  const bin = mkdtempSync(join(tmpdir(), 'better-bin-'))
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat >/dev/null\n${script}\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  const saved = { HOME: process.env.HOME, PATH: process.env.PATH }
  process.env.HOME = home
  process.env.PATH = `${bin}:${saved.PATH}`
  return { home, restore: () => Object.assign(process.env, saved) }
}

test("a failed model call shows the model's error, not the exit code, and stderr stays out of it", async () => {
  const fake = fakeClaude(`echo '{"type":"result","subtype":"success","is_error":true,"result":"API Error: 529 overloaded"}'\necho STDERRCANARY >&2\nexit 1`)
  try {
    const out = await runHelper({ kind: 'better', input: 'x', cwd: fake.home })
    assert.equal(out.ok, false)
    assert.match(!out.ok ? out.error : '', /model call failed: API Error: 529 overloaded/)
    assert.doesNotMatch(!out.ok ? out.error : '', /STDERRCANARY/)
  } finally {
    fake.restore()
  }
})

test('the runs folder keeps only the newest records and leaves other files alone', async () => {
  const fake = fakeClaude('exit 0')
  try {
    const runs = join(fake.home, '.claude/better/runs')
    mkdirSync(runs, { recursive: true })
    for (let i = 0; i < KEEP_RUNS + 50; i++) writeFileSync(join(runs, `2020-01-01T00-00-00-${String(i).padStart(3, '0')}Z-better-0000abcd.json`), '{}')
    writeFileSync(join(runs, 'keep-me.txt'), 'x')
    await runHelper({ kind: 'better', input: 'x', cwd: fake.home })
    const records = readdirSync(runs).filter((n) => n.endsWith('.json'))
    assert.equal(records.length, KEEP_RUNS)
    assert.ok(!records.includes('2020-01-01T00-00-00-000Z-better-0000abcd.json'))
    assert.ok(existsSync(join(runs, 'keep-me.txt')))
    pruneRuns(join(fake.home, 'missing'))
  } finally {
    fake.restore()
  }
})
