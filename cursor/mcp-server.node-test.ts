import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const REPLY = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '(1) a\n<improved-prompt>\nDEEP PROMPT\n</improved-prompt>' }] } })
const RESULT = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '(1) a\n<improved-prompt>\nDEEP PROMPT\n</improved-prompt>' })

function server(seconds: number) {
  const home = mkdtempSync(join(tmpdir(), 'better-home-'))
  const bin = mkdtempSync(join(tmpdir(), 'better-bin-'))
  const work = join(home, 'project')
  mkdirSync(work)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat >/dev/null\necho '{"isGuardLoaded":true}' > "$CLAUDE_BETTER_GUARD_FILE"\nsleep ${seconds}\nprintf '%s\\n' '${REPLY}' '${RESULT}'\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, BETTER_MCP_WAIT_MS: '300' }
  for (const k of ['VSCODE_PID', 'VSCODE_IPC_HOOK', 'CURSOR_TRACE_ID']) delete env[k]
  const child = spawn(process.execPath, [new URL('./mcp-server.ts', import.meta.url).pathname], { cwd: work, env, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map<number, (r: any) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line)
    if (msg.id !== undefined) waiting.get(msg.id)?.(msg.result)
  })
  let next = 1
  const request = (method: string, params: unknown) => new Promise<any>((done) => {
    const id = next++
    waiting.set(id, done)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  return { request, close: () => (child.kill(), [home, bin].forEach((d) => rmSync(d, { recursive: true, force: true }))) }
}

const text = (r: any): string => r.content[0].text

test('a run longer than the wait returns a job id, and better_wait returns the prompt', async () => {
  const s = server(1)
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    const first = await s.request('tools/call', { name: 'better', arguments: { prompt: 'bump the retries' } })
    const job = /still reading \(job (\w+)\)/.exec(text(first))?.[1]
    assert.ok(job, text(first))
    let out = await s.request('tools/call', { name: 'better_wait', arguments: { job } })
    while (/still reading/.test(text(out))) out = await s.request('tools/call', { name: 'better_wait', arguments: { job } })
    assert.equal(out.isError, undefined)
    assert.match(text(out), /<improved-prompt>\nDEEP PROMPT\n<\/improved-prompt>/)
    const again = await s.request('tools/call', { name: 'better_wait', arguments: { job } })
    assert.equal(again.isError, true)
  } finally {
    s.close()
  }
})

test('a run shorter than the wait returns the prompt in one call', async () => {
  const s = server(0)
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    const out = await s.request('tools/call', { name: 'check_brief', arguments: { brief: 'Raise MAX_RETRIES.' } })
    assert.equal(text(out), 'DEEP PROMPT')
  } finally {
    s.close()
  }
})
