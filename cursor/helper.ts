import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  CLI_LOGIN, GUARD_ENV, HELPER_ENV, HELPER_TIMEOUT_MS, NO_CLAUDE, isLoginFailure, StreamReader, buildBriefTask, buildHelperTask, claudeCandidates,
  helperArgv, helperExitError, KEEP_RUNS, parseMarkedPrompt, stageOf, staleRecords, toolLine,
} from '../hooks/better.ts'

export type Kind = 'better' | 'brief'
export type Outcome = { ok: true; text: string; log: string } | { ok: false; cancelled: boolean; isLogin?: boolean; error: string; log: string }

export const PLUGIN_ROOT = resolve(dirname(realpathSync(new URL(import.meta.url).pathname)), '..')

export function pruneRuns(dir: string, keep = KEEP_RUNS - 1): void {
  try {
    for (const name of staleRecords(readdirSync(dir), keep)) {
      try {
        unlinkSync(`${dir}/${name}`)
      } catch {}
    }
  } catch {}
}

export function runHelper(req: {
  kind: Kind; input: string; cwd: string; model?: string; signal?: AbortSignal
  onStage?: (stage: number, total: number, label: string) => void
}): Promise<Outcome> {
  const home = process.env.HOME ?? ''
  const runs = `${home}/.claude/better/runs`
  mkdirSync(runs, { recursive: true })
  pruneRuns(runs)
  const log = `${runs}/${new Date().toISOString().replace(/[:.]/g, '-')}-${req.kind}-${randomUUID().slice(0, 8)}.json`
  const claude = claudeCandidates(process.env.PATH ?? '', home).find((p) => existsSync(p))
  const argv = helperArgv({ claude: claude ?? 'claude', model: req.model, pluginRoot: PLUGIN_ROOT })
  const startedAt = Date.now()
  const questions = req.kind === 'brief' ? 3 : 4

  const settle = (record: Record<string, unknown>, out: Outcome): Outcome => {
    const error = out.ok ? undefined : out.error
    writeFileSync(log, JSON.stringify({ kind: req.kind, input: req.input, cwd: req.cwd, model: req.model ?? null, claude: claude ?? null, argv: argv.slice(1), from: 'cursor', durationMs: Date.now() - startedAt, error, ...record }, null, 2))
    chmodSync(log, 0o600)
    return out
  }
  if (!claude) return Promise.resolve(settle({}, { ok: false, cancelled: false, error: NO_CLAUDE, log }))
  if (req.signal?.aborted) return Promise.resolve(settle({ cancelled: true }, { ok: false, cancelled: true, error: 'cancelled', log }))

  return new Promise((done) => {
    const reader = new StreamReader(req.cwd, home)
    const child = spawn(claude, argv.slice(1), { cwd: req.cwd, env: { ...process.env, [HELPER_ENV]: '1', [GUARD_ENV]: log }, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.end(req.kind === 'brief' ? buildBriefTask(req.input) : buildHelperTask(req.input))
    let stderr = ''
    let stage = -1
    let stopped: 'cancelled' | 'timeout' | undefined
    const stop = (why: 'cancelled' | 'timeout') => {
      stopped ??= why
      child.kill('SIGTERM')
    }
    const onAbort = () => stop('cancelled')
    req.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => stop('timeout'), HELPER_TIMEOUT_MS)
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
    child.stdout.on('data', (d) => {
      if (!reader.push(String(d))) return
      const now = stageOf(reader.text, questions)
      if (now.stage !== stage) req.onStage?.((stage = now.stage), questions + 1, now.label)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      done(settle({}, { ok: false, cancelled: false, error: `Couldn't start ${claude} for the helper: ${e.message}`, log }))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
      reader.end()
      let isGuardLoaded = false
      try {
        isGuardLoaded = JSON.parse(readFileSync(log, 'utf8'))?.isGuardLoaded === true
      } catch {}
      const record = { exit: { code, signal }, cancelled: stopped === 'cancelled', isGuardLoaded, stderrTail: stderr.trim().split('\n').slice(-3), tools: reader.tools.map(toolLine), reply: reader.reply }
      const fail = (error: string, cancelled = false) => done(settle(record, { ok: false, cancelled, error, log }))
      if (stopped === 'cancelled') return fail('cancelled', true)
      if (stopped === 'timeout') return fail(`The helper timed out after ${HELPER_TIMEOUT_MS / 60_000} minutes`)
      if (reader.resultError && (reader.authFailed || isLoginFailure(reader.resultError))) return done(settle({ ...record, cliError: reader.resultError }, { ok: false, cancelled: false, isLogin: true, error: `${CLI_LOGIN} (The CLI said: ${reader.resultError})`, log }))
      if (reader.resultError) return fail(`The helper's model call failed: ${reader.resultError}`)
      if (code !== 0) return fail(`${helperExitError(code, signal)}; its stderr is in ${log}`)
      if (!isGuardLoaded) return fail(`The helper's read-only guard didn't load, so its result was not used. Check that ${PLUGIN_ROOT}/hooks/register.tsx loads (claude plugin validate ${PLUGIN_ROOT}).`)
      let text: string
      try {
        text = parseMarkedPrompt(reader.reply)
      } catch (e) {
        return fail(`${(e as Error).message} The helper's whole reply is in ${log}`)
      }
      done(settle({ ...record, checked: text }, { ok: true, text, log }))
    })
  })
}
