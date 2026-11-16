// Plain Node test (the plugin runner allows no node: imports): node --test 'cursor/*.node-test.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planBrief } from './hook.ts'
import { isWorkspaceRoot, recordStop, runOnce, stoppedSince } from './stops.ts'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'

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

test('two copies of the hook share one helper run per call, and a dead holder is taken over', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'better-once-'))
  let runs = 0
  const work = async () => {
    runs++
    await new Promise((r) => setTimeout(r, 200))
    return 'checked'
  }
  const [a, b] = await Promise.all([runOnce('k', work, dir), runOnce('k', work, dir)])
  assert.deepEqual([a, b, runs], ['checked', 'checked', 1])
  writeFileSync(join(dir, 'dead.lock'), '999999') // a holder that no longer runs
  assert.equal(await runOnce('dead', async () => 'mine', dir, 5_000), 'mine')
})

test('a folder that holds the home folder is never a workspace: no brief check there, and a stop there cancels nothing', () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'better-top-')))
  const home = join(top, 'me')
  mkdirSync(home)
  const ws = join(home, 'proj')
  mkdirSync(ws)
  const plan = (roots: string[]) => planBrief({ tool_name: 'Task', tool_input: { prompt: '/better do it' }, workspace_roots: roots }, home)
  assert.ok('deny' in plan([top]))
  assert.ok('deny' in plan([home]))
  assert.deepEqual(plan([ws]), { brief: 'do it', cwd: ws })
  assert.deepEqual(plan([top, ws]), { brief: 'do it', cwd: ws })
  assert.equal(isWorkspaceRoot('/', ''), false)
  assert.equal(isWorkspaceRoot(ws, ''), true) // an empty HOME is not the current folder
  const dir = mkdtempSync(join(tmpdir(), 'better-stops-'))
  recordStop([top], dir, 1, home)
  recordStop([home], dir, 1, home)
  assert.equal(readdirSync(dir).length, 0)
  recordStop([ws], dir, 1, home)
  assert.equal(readdirSync(dir).length, 1)
})

test('a failed check is shared too: the other copy gets the same answer and no second run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'better-once-'))
  let runs = 0
  const work = async () => {
    runs++
    await new Promise((r) => setTimeout(r, 200))
    throw new Error('helper failed')
  }
  const onError = (e: Error) => `deny: ${e.message}`
  const [a, b] = await Promise.all([runOnce('f', work, dir, 5_000, onError), runOnce('f', work, dir, 5_000, onError)])
  assert.deepEqual([a, b, runs], ['deny: helper failed', 'deny: helper failed', 1])
  assert.equal(statSync(join(dir, 'f.out')).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), [])
})
