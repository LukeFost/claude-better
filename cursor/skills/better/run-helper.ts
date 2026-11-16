// /better for Cursor's agent: runs the same read-only `claude -p` helper as the Claude Code mod, with the mod's
// guard loaded into it, and prints the improved prompt (or checked brief) on stdout. Nothing is sent or started.
//
//   node run-helper.ts better|brief [--cwd DIR] [--model MODEL] < text
//
// stdin is the prompt (or brief) plus whatever the Cursor chat established, since the helper can't see that chat.
// Exit 0 prints the result; any failure prints why on stderr and exits 1. Every run leaves a record (mode 0600) in
// ~/.claude/better/runs, like the mod's.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  GUARD_ENV, HELPER_ENV, HELPER_TIMEOUT_MS, NO_CLAUDE, StreamReader, buildBriefTask, buildHelperTask, claudeCandidates,
  helperArgv, helperExitError, parseMarkedPrompt, stageOf,
} from '../../../hooks/better.ts'

const args = process.argv.slice(2)
const kind = args[0]
if (kind !== 'better' && kind !== 'brief') {
  process.stderr.write('usage: node run-helper.ts better|brief [--cwd DIR] [--model MODEL] < text\n')
  process.exit(2)
}
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i > 0 ? args[i + 1] : undefined
}
const cwd = resolve(flag('--cwd') ?? process.cwd())
const model = flag('--model')
const home = process.env.HOME ?? ''
// The plugin root holds the mod whose guard the helper loads: three folders up from this file, symlinks resolved.
const pluginRoot = resolve(dirname(realpathSync(new URL(import.meta.url).pathname)), '../../..')

const input = readFileSync(0, 'utf8').trim()
if (!input) {
  process.stderr.write(`/better got nothing to ${kind === 'brief' ? 'check' : 'deepen'} on stdin.\n`)
  process.exit(2)
}

const runs = `${home}/.claude/better/runs`
mkdirSync(runs, { recursive: true })
const log = `${runs}/${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${randomUUID().slice(0, 8)}.json`
const claude = claudeCandidates(process.env.PATH ?? '', home).find((p) => existsSync(p))
const argv = helperArgv({ claude: claude ?? 'claude', model, pluginRoot })
const startedAt = Date.now()

// Writes the record and the outcome; exitCode, not exit(), so a piped stdout is flushed first.
function finish(record: Record<string, unknown>, out: { ok: true; text: string } | { ok: false; error: string }): void {
  writeFileSync(log, JSON.stringify({ kind, input, cwd, model: model ?? null, claude: claude ?? null, argv: argv.slice(1), from: 'cursor', durationMs: Date.now() - startedAt, ...record }, null, 2))
  chmodSync(log, 0o600)
  if (out.ok) process.stdout.write(`${out.text}\n`)
  else process.stderr.write(`/better failed: ${out.error}\n`)
  process.exitCode = out.ok ? 0 : 1
}

if (!claude) finish({}, { ok: false, error: NO_CLAUDE })
else run(claude)

function run(claude: string): void {
const reader = new StreamReader(cwd, home)
const child = spawn(claude, argv.slice(1), { cwd, env: { ...process.env, [HELPER_ENV]: '1', [GUARD_ENV]: log }, stdio: ['pipe', 'pipe', 'pipe'] })
child.stdin.end(kind === 'brief' ? buildBriefTask(input) : buildHelperTask(input))
let stderr = ''
let label = ''
child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
child.stdout.on('data', (d) => {
  if (!reader.push(String(d))) return
  // Progress on stderr, so stdout carries only the result.
  const now = stageOf(reader.text, kind === 'brief' ? 3 : 4).label
  if (now !== label) process.stderr.write(`/better: ${(label = now)}\n`)
})
const timer = setTimeout(() => child.kill('SIGTERM'), HELPER_TIMEOUT_MS)
// Stopping this script (Cursor's stop button) stops the helper too.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill('SIGTERM'))

child.on('error', (e) => finish({}, { ok: false, error: `Couldn't start ${claude} for the helper: ${e.message}` }))
child.on('close', (code, signal) => {
  clearTimeout(timer)
  reader.end()
  let isGuardLoaded = false
  try {
    isGuardLoaded = JSON.parse(readFileSync(log, 'utf8'))?.isGuardLoaded === true
  } catch {}
  const record = { exit: { code, signal }, isGuardLoaded, stderrTail: stderr.trim().split('\n').slice(-3), tools: reader.tools.map((t) => `${t.state} ${t.label}`), reply: reader.reply }
  if (code !== 0) return finish(record, { ok: false, error: `${helperExitError(code, signal)}; its stderr is in ${log}` })
  if (reader.resultError) return finish(record, { ok: false, error: `The helper's model call failed: ${reader.resultError}` })
  if (!isGuardLoaded) return finish(record, { ok: false, error: `The helper's read-only guard didn't load, so its result was not used. Check that ${pluginRoot}/hooks/register.tsx loads (claude plugin validate ${pluginRoot}).` })
  let text: string
  try {
    text = parseMarkedPrompt(reader.reply)
  } catch (e) {
    return finish(record, { ok: false, error: `${(e as Error).message} The helper's whole reply is in ${log}` })
  }
  finish({ ...record, checked: text }, { ok: true, text })
})
}
