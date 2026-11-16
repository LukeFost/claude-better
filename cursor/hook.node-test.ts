// Plain Node test (the plugin runner allows no node: imports): node --test 'cursor/*.node-test.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planBrief } from './hook.ts'
import { recordStop, stoppedSince } from './stops.ts'

test("Cursor's stop button: a stop marker cancels runs in that workspace that began before it, and nothing else", () => {
  const dir = mkdtempSync(join(tmpdir(), 'better-stops-'))
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'better-ws-')))
  const t0 = 1_000_000
  assert.equal(stoppedSince(ws, t0, dir, t0), false)
  recordStop([ws], dir, t0 + 5_000)
  assert.equal(stoppedSince(ws, t0, dir, t0 + 6_000), true) // a run started before the stop
  assert.equal(stoppedSince(join(ws, 'src'), t0, dir, t0 + 6_000), true) // a folder inside the workspace
  assert.equal(stoppedSince(ws, t0 + 7_000, dir, t0 + 8_000), false) // a run started after the stop
  assert.equal(stoppedSince('/elsewhere', t0, dir, t0 + 6_000), false) // another workspace
  recordStop([], dir, t0) // no roots: no marker
  recordStop(undefined, dir, t0)
  assert.equal(readdirSync(dir).length, 1)
  assert.equal(stoppedSince(ws, t0, dir, t0 + 5_000 + 11 * 60_000), false) // old markers are dropped
  assert.equal(readdirSync(dir).length, 0)
})

test('a subagent prompt marked "/better " is checked before the subagent starts; others pass untouched', () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'better-ws-')))
  const call = (tool_name: string, prompt: unknown, roots: unknown = [ws]) => planBrief({ tool_name, tool_input: { prompt, description: 'd' }, workspace_roots: roots }, '/nonexistent-home')
  assert.deepEqual(call('Task', '/better Report MAX_RETRIES in src/rate_limit.py.'), { brief: 'Report MAX_RETRIES in src/rate_limit.py.', cwd: ws })
  assert.deepEqual(call('Task', '  /better\nmulti\nline'), { brief: 'multi\nline', cwd: ws })
  assert.deepEqual(call('Task', 'Report MAX_RETRIES.'), { pass: true })
  assert.deepEqual(call('Task', '/betterment plan'), { pass: true })
  assert.deepEqual(call('Shell', '/better ls'), { pass: true })
  assert.deepEqual(call('Task', undefined), { pass: true })
  assert.ok('deny' in (call('Task', '/better ') as object))
  assert.ok('deny' in (call('Task', '/better do it', ['/']) as object)) // never the filesystem root
  assert.ok('deny' in (call('Task', '/better do it', []) as object))
})
