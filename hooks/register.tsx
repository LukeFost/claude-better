import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BetterBoomerang, BetterRun } from '../types'
import {
  BRIEF_MARK, GUARD_ENV, HELPER_ENV, isInside, outsideFolder, HELPER_TIMEOUT_MS, NO_CLAUDE, StreamReader, buildBriefTask, buildHelperTask, claudeCandidates, clock,
  desktopEngineDir, handOverText, helperArgv, helperExitError, helperVerdict, parseMarkedPrompt, stageOf,
} from './better'

const runA = atom({ plugin: 'better', key: 'run' } as const, null as BetterRun | null)
const briefsA = atom({ plugin: 'better', key: 'briefs' } as const, 0)
const boomA = atom({ plugin: 'better', key: 'boomerang' } as const, null as BetterBoomerang | null)
// Every /better-boomerang fork started, kept in an atom too so a module reload doesn't unguard a fork still running.
const forksA = atom({ plugin: 'better', key: 'forks' } as const, [] as string[])
const tickA = atom({ plugin: 'better', key: 'tick' } as const, 0)

const TOOL = 'check_brief'
const TOOL_NAME = `mcp__better__${TOOL}`

type Outcome =
  | { ok: true; checked: string; log: string }
  | { ok: false; cancelled: boolean; error: string; log: string }

type HelperRequest = { kind: 'better' | 'brief'; input: string; task: string; cwd?: string; signal: AbortSignal; onProgress?: (r: StreamReader) => void }

// The helper's `claude`, as an absolute path: the first on PATH, else a usual install spot, else the engine the
// desktop app runs this session on. A Dock-launched app may not have the shell's PATH.
async function findClaude($: EngineInterface, home: string): Promise<string | undefined> {
  for (const path of claudeCandidates((await $.env.get('PATH')) ?? '', home)) {
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  const dir = desktopEngineDir(home, (await $.session.version()).version)
  for (const build of await $.fs.list(dir).catch(() => [])) {
    const path = `${dir}/${build.name}/claude.app/Contents/MacOS/claude`
    if (build.kind === 'dir' && (await $.fs.exists(path).catch(() => false))) return path
  }
  return undefined
}

// Runs one helper: a headless, read-only `claude -p` on a never-saved fork of this session. Every run leaves a
// record in ~/.claude/better/runs, so a failure can be read afterwards (no environment or credentials in it).
async function runHelper($: EngineInterface, req: HelperRequest): Promise<Outcome> {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = req.cwd ?? (await $.session.cwd())
  const startedAt = await $.clock.now()
  const id = crypto.randomUUID().slice(0, 8)
  const log = `${home}/.claude/better/runs/${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${req.kind}-${id}.json`
  const sessionId = (await $.session.turns()) > 0 ? await $.session.id() : undefined
  const model = await $.session.model()
  const claude = await findClaude($, home)
  const argv = helperArgv({ claude: claude ?? 'claude', sessionId, model, pluginRoot: $.plugin.root })
  const reader = new StreamReader(cwd, home)
  const stop = new AbortController()
  const onAbort = () => stop.abort(req.signal.reason ?? 'cancelled')
  if (req.signal.aborted) onAbort()
  else req.signal.addEventListener('abort', onAbort, { once: true })
  const timer = $.clock.after(HELPER_TIMEOUT_MS, () => stop.abort('timeout'))
  const stopped = new Promise<'stopped'>((resolve) => {
    if (stop.signal.aborted) resolve('stopped')
    else stop.signal.addEventListener('abort', () => resolve('stopped'), { once: true })
  })

  let stderr = ''
  let exit: { code: number | null; signal: string | null } | undefined
  let error: string | undefined
  let cancelled = false
  let checked: string | undefined
  try {
    if (!claude) throw new Error(NO_CLAUDE)
    // The helper's guard writes the run record's first version when it loads (see session.start).
    const child = $.process.spawn({ argv, cwd, env: { [HELPER_ENV]: '1', [GUARD_ENV]: log }, input: req.task })
    for (;;) {
      const pending = child.next()
      pending.catch(() => {})
      const step = await Promise.race([pending, stopped])
      if (step === 'stopped') {
        // Leaving the stream kills the child.
        void child.return(undefined as never).catch(() => {})
        break
      }
      if (step.done) {
        exit = step.value
        break
      }
      if (step.value.stream === 'stderr') stderr = (stderr + step.value.text).slice(-4000)
      else if (reader.push(step.value.text)) req.onProgress?.(reader)
    }
    if (reader.end()) req.onProgress?.(reader)
    if (stop.signal.aborted) {
      cancelled = stop.signal.reason !== 'timeout'
      error = cancelled ? 'cancelled' : `The helper timed out after ${HELPER_TIMEOUT_MS / 60_000} minutes`
    } else if (exit && exit.code !== 0) error = `${helperExitError(exit.code, exit.signal)}; its stderr is in ${log}`
    else if (reader.resultError) error = `The helper's model call failed: ${reader.resultError}`
    else if (!reader.reply.trim()) error = 'The helper finished without replying'
    else {
      try {
        checked = parseMarkedPrompt(reader.reply)
      } catch (e) {
        error = `${(e as Error).message} The helper's whole reply is in ${log}`
      }
    }
  } catch (e) {
    error = claude ? `Couldn't start ${claude} for the helper: ${(e as Error).message}` : NO_CLAUDE
  } finally {
    timer.cancel()
    req.signal.removeEventListener('abort', onAbort)
  }
  // Fail closed: a helper whose guard never loaded ran unguarded, so its result is not used.
  const isGuarded = await $.fs.read(log).then((t) => JSON.parse(t)?.isGuardLoaded === true).catch(() => false)
  if (exit && !isGuarded && !error) {
    checked = undefined
    error = `The helper's read-only guard didn't load, so its result was not used. Check that ${$.plugin.root}/hooks/register.tsx loads (claude plugin validate), then try again.`
  }
  const durationMs = (await $.clock.now()) - startedAt
  const record = {
    kind: req.kind, input: req.input, cwd, sessionId, model, claude: claude ?? null, argv: argv.slice(1), durationMs, exit, cancelled, isGuardLoaded: isGuarded,
    error, stderrTail: stderr.trim().split('\n').slice(-3), tools: reader.tools.map((t) => `${t.state} ${t.label}`),
    reply: reader.reply, checked,
  }
  await $.fs.write(log, JSON.stringify(record, null, 2)).catch(() => {})
  return checked !== undefined && !error ? { ok: true, checked, log } : { ok: false, cancelled, error: error ?? 'unknown failure', log }
}

// The improved prompt goes in the box above anything typed meanwhile; nothing is sent.
async function handOver($: EngineInterface, improved: string, surface?: 'terminal' | 'desktop' | 'vscode' | 'mobile'): Promise<void> {
  const box = await $.prompt.read()
  const filled = await $.prompt.fill({ text: handOverText(improved, box.text), mode: 'replace' })
  if (filled.isFilled) {
    $.ui.toast(`The improved prompt is in your input box${box.text.trim() ? ", above the draft you'd typed" : ''}. Edit it, then press Enter to send.`, { timeoutMs: 8000 })
    return
  }
  const copied = await $.ui.copy({ text: improved, ...(surface ? { surface } : {}) })
  $.ui.toast(`The input box couldn't take the prompt (${filled.refusal ?? 'refused'}); ${copied.isCopied ? 'it is on your clipboard' : 'see the run log in ~/.claude/better/runs'}. Nothing was sent.`, { timeoutMs: 12000 })
}

// Module state: a reload starts it over, and the reload kills any helper child with the old module.
// forks: every /better-boomerang fork this module started. A fork stays guarded for its whole life, after Back too.
const S: { isHelper: boolean; current?: AbortController; ticker?: { cancel: () => void }; forks: Set<string> } = { isHelper: false, forks: new Set() }

function startTicker($: EngineInterface): void {
  S.ticker ??= $.clock.every(1000, () => void update($, tickA, (n) => (n ?? 0) + 1))
}

async function stopTickerIfIdle($: EngineInterface): Promise<void> {
  if ((await read($, runA)) || (await read($, briefsA)) || (await read($, boomA))?.status === 'running') return
  S.ticker?.cancel()
  S.ticker = undefined
}

async function back($: EngineInterface, surface?: 'terminal' | 'desktop' | 'vscode' | 'mobile'): Promise<string | undefined> {
  const boom = await read($, boomA)
  if (!boom?.improved) return 'No /better-boomerang prompt is waiting.'
  const viewed = await $.ui.view({})
  // The desktop app has no main view to switch, so a fork it never showed leaves nothing to switch back from.
  if (viewed.deny && boom.isViewed !== false) return `Couldn't switch back to the main conversation: ${viewed.deny}`
  await handOver($, boom.improved, surface)
  await update($, boomA, () => null)
  return undefined
}

// The folder check_brief may point the helper at: the session's own (its cwd or project root) or one inside it,
// compared as real paths. Anything else is refused, since the helper reads everything under its cwd.
async function briefCwd($: EngineInterface, asked: string | undefined): Promise<{ cwd?: string } | { deny: string }> {
  if (asked === undefined || !asked.trim()) return {}
  const base = await $.session.cwd()
  const real = async (p: string) => (await $.fs.stat(p, { resolve: true }).catch(() => undefined))?.realPath
  const roots = [...new Set((await Promise.all([base, await $.session.root()].map(real))).filter((r): r is string => !!r))]
  const abs = asked.startsWith('/') || /^[A-Za-z]:[\\/]/.test(asked) ? asked : `${base}/${asked}`
  const target = await real(abs)
  if (!target) return { deny: `cwd ${asked} doesn't exist, so the brief is unchecked; do not start the work with it.` }
  return isInside(target, roots) ? { cwd: target } : { deny: `${outsideFolder(asked, roots)} Do not start the work with the unchecked brief.` }
}

async function checkBrief($: EngineInterface, brief: string, cwd: string | undefined, signal: AbortSignal): Promise<Outcome> {
  await update($, briefsA, (n) => (n ?? 0) + 1)
  startTicker($)
  try {
    return await runHelper($, { kind: 'brief', input: brief, task: buildBriefTask(brief), cwd, signal })
  } finally {
    await update($, briefsA, (n) => Math.max(0, (n ?? 1) - 1))
    await stopTickerIfIdle($)
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    S.isHelper = (await $.env.get('CLAUDE_BETTER_HELPER')) === '1'
    if (S.isHelper) {
      // The proof the parent waits for: written before the helper's first turn, so it means tool.check is in place.
      const proof = await $.env.get('CLAUDE_BETTER_GUARD_FILE')
      if (proof) await $.fs.write(proof, JSON.stringify({ isGuardLoaded: true }))
      return next(e)
    }
    const started = await next(e)
    await $.command.register({ name: 'better', description: 'Deepen a prompt (or the current task) with a read-only helper in the background, then put the improved prompt in your input box', argumentHint: '[prompt]' })
    await $.command.register({ name: 'better-cancel', description: 'Stop the /better helper that is running; nothing is sent' })
    await $.command.register({ name: 'better-boomerang', description: 'Watch a read-only fork of this chat deepen a prompt (or the current task), then come back with it in your input box', argumentHint: '[prompt]' })
    await $.command.register({ name: 'better-back', description: 'Leave the /better-boomerang fork and put its improved prompt in your input box' })
    await $.tool.register({
      name: TOOL,
      isDeferred: false,
      description: [
        'Check a brief before you hand it to a subagent, a teammate or a new session that starts with none of this conversation.',
        "A read-only helper on a copy of this chat reads the brief cold, checks it against the repo, and fixes only what would trip the receiver up: references only this conversation explains, wrong or stale paths, symbols, commands and versions, and a missing done-check. It keeps the brief's goal, scope, order and length and adds no work.",
        'Returns the checked brief, to use as the task verbatim. If it fails or is cancelled it returns an error: do not start the work with the unchecked brief.',
        'Shortcut: start an Agent prompt with "/better " and the brief is checked the same way before the subagent starts. In auto mode Claude Code refuses a prompt changed after it was approved, so there call this tool first and send its result as the prompt.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          brief: { type: 'string', description: 'The brief as you would send it.' },
          cwd: { type: 'string', description: 'Where the receiver will work, if not this session\'s folder: a folder inside it. Anything outside it is refused.' },
        },
        required: ['brief'],
        additionalProperties: false,
      },
    })
    return started
  })

  // The helper's own guard (inside the helper process), and the boomerang fork's (in this one).
  on('tool.check', async ($, e, next) => {
    if (!S.isHelper && !(e.agentId !== undefined && (S.forks.has(e.agentId) || ((await read($, forksA)) ?? []).includes(e.agentId)))) return next(e)
    const verdict = helperVerdict(e.tool, e.isReadOnly)
    // A read goes on to Claude Code's own checks (dontAsk's folder scope, deny rules, other hooks); never allowed here.
    return verdict.decision === 'pass' ? next(e) : { decision: 'deny', reason: verdict.reason }
  }).catch(async ($, e, next) => {
    const isFork = e.agentId !== undefined && (S.forks.has(e.agentId) || ((await read($, forksA).catch(() => [] as string[])) ?? []).includes(e.agentId))
    return S.isHelper || isFork ? { decision: 'deny', reason: "/better's guard failed, so the call is refused" } : next(e)
  })

  // ---- /better ----
  on('command.run', { command: 'better' }, async ($, e) => {
    if (S.isHelper) return { text: '/better is off inside its own helper.' }
    const prompt = e.args.trim()
    if (!prompt && (await $.session.turns()) === 0) return { text: '/better has no task to deepen yet; give it a prompt: /better <prompt>' }
    if (S.current) return { text: '/better is already running; /better-cancel (or the Cancel button above the prompt) stops it.' }
    const run = new AbortController()
    S.current = run
    const startedAt = await $.clock.now()
    await update($, runA, () => ({ id: crypto.randomUUID(), startedAt, stage: 0, label: 'Reading your code and files', tools: [] }))
    startTicker($)
    const surface = (await $.session.surface()) ?? undefined
    void (async () => {
      try {
        const out = await runHelper($, {
          kind: 'better', input: prompt, task: buildHelperTask(prompt), signal: run.signal,
          onProgress: (r) => {
            const { stage, label } = stageOf(r.text)
            void update($, runA, (v) => (v ? { ...v, stage, label, tools: r.tools.map((t) => ({ ...t })) } : v))
          },
        })
        if (out.ok) await handOver($, out.checked, surface)
        else if (out.cancelled) $.ui.toast('/better cancelled; nothing was sent')
        else $.ui.toast(`/better failed: ${out.error}`, { timeoutMs: 15000 })
      } catch (err) {
        $.ui.toast(`/better failed: ${(err as Error).message}`, { timeoutMs: 15000 })
      } finally {
        if (S.current === run) S.current = undefined
        await update($, runA, () => null)
        await stopTickerIfIdle($)
      }
    })()
    return { text: `/better is reading ${prompt ? 'for your prompt' : 'for the task in progress'} in the background; keep working. The result goes in your input box, never sent.`, isTextDisplayOnly: true }
  })

  on('command.run', { command: 'better-cancel' }, async () => {
    if (!S.current) return { text: 'No /better is running.', isTextDisplayOnly: true }
    S.current.abort('cancelled')
    return { text: '/better cancelled; nothing was sent.', isTextDisplayOnly: true }
  })

  // ---- /better-boomerang: a fork of this chat in the main view, then back with the prompt ----
  on('command.run', { command: 'better-boomerang' }, async ($, e) => {
    if (S.isHelper) return { text: '/better-boomerang is off inside its own helper.' }
    const prompt = e.args.trim()
    if (!prompt && (await $.session.turns()) === 0) return { text: '/better-boomerang has no task to deepen yet; give it a prompt: /better-boomerang <prompt>' }
    if ((await read($, boomA))?.status === 'running') return { text: '/better-boomerang is already running; wait for it to finish.' }
    const spawned = await $.agent.spawn({ subagentType: 'fork', prompt: buildHelperTask(prompt), description: '/better-boomerang' })
    if (!spawned.agentId) {
      const deny = 'deny' in spawned && spawned.deny ? spawned.deny : 'no agent started'
      // Auto mode only starts an agent the model asked for, so a command's fork is refused there.
      if (/auto mode/i.test(deny)) return { text: "/better-boomerang can't start its fork in auto mode, which only starts an agent the model asks for. Switch to another permission mode (the mode menu under the input box in the desktop app, shift+tab in the terminal) and run it again, or use /better, which needs no fork." }
      return { text: `/better-boomerang couldn't start its fork: ${deny}` }
    }
    S.forks.add(spawned.agentId)
    await update($, forksA, (ids) => [...(ids ?? []), spawned.agentId!])
    await update($, boomA, () => ({ agentId: spawned.agentId!, startedAt: Date.now(), status: 'running' }))
    startTicker($)
    const viewed = await $.ui.view({ agentId: spawned.agentId })
    if (viewed.deny) await update($, boomA, (v) => (v ? { ...v, isViewed: false } : v))
    const how = viewed.deny ? `It runs in the background; its row in this chat shows when it's done (${viewed.deny}).` : 'You are watching it now.'
    return { text: `/better-boomerang is researching in a read-only fork of this chat. ${how} When it's done, press "Back with prompt" above the prompt (or /better-back).`, isTextDisplayOnly: true }
  })

  on('turn.complete', async ($, e, next) => {
    const boom = e.agentId !== undefined ? await read($, boomA) : null
    if (!boom || e.agentId !== boom.agentId) return next(e)
    let improved: string | undefined
    try {
      improved = parseMarkedPrompt(e.answer)
    } catch (err) {
      $.ui.toast(`/better-boomerang failed: ${(err as Error).message} Its reply stays in the fork's transcript.`, { timeoutMs: 15000 })
    }
    await update($, boomA, () => (improved ? { ...boom, status: 'ready' as const, improved } : null))
    if (improved) $.ui.toast('/better-boomerang is done: press "Back with prompt" above the prompt, or /better-back.', { timeoutMs: 10000 })
    await stopTickerIfIdle($)
    return next(e)
  })

  on('command.run', { command: 'better-back' }, async ($) => {
    const said = await back($, (await $.session.surface()) ?? undefined)
    return { text: said ?? 'Back in the main conversation; the improved prompt is in your input box.', isTextDisplayOnly: true }
  })

  // ---- Agent use: the callable tool, and "/better" at the start of an Agent prompt ----
  on('tool.call', { tool: TOOL_NAME }, async ($, e, next) => {
    const input = e as unknown as { brief?: unknown; cwd?: unknown }
    if (typeof input.brief !== 'string' || !input.brief.trim()) return { deny: 'check_brief needs the brief.' }
    const where = await briefCwd($, typeof input.cwd === 'string' ? input.cwd : undefined)
    if ('deny' in where) return { deny: where.deny }
    const out = await checkBrief($, input.brief.trim(), where.cwd, next.signal)
    if (out.ok) return { result: out.checked }
    return { deny: out.cancelled ? '/better was cancelled, so the brief is unchecked; do not start the work with it.' : `/better couldn't check this brief, so do not start the work with it: ${out.error} (run log: ${out.log})` }
  }).catch(() => ({ deny: "/better's brief check failed, so the brief is unchecked; do not start the work with it." }))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (S.isHelper || typeof e.prompt !== 'string' || !BRIEF_MARK.test(e.prompt)) return next(e)
    const brief = e.prompt.replace(BRIEF_MARK, '').trim()
    if (!brief) return { deny: 'A /better subagent brief needs the brief after /better.' }
    const out = await checkBrief($, brief, undefined, next.signal)
    if (!out.ok) return { deny: out.cancelled ? "/better was cancelled, so the subagent didn't start." : `/better couldn't check this subagent brief, so the subagent didn't start: ${out.error}` }
    return next({ ...e, prompt: out.checked })
  }).catch(($, e, next) => (next.called ? next(e) : typeof e.prompt === 'string' && BRIEF_MARK.test(e.prompt) ? { deny: "/better's brief check failed, so the subagent didn't start." } : next(e)))

  // ---- The band above the prompt ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (S.isHelper) return next(e)
    const run = await read($, runA)
    const briefs = await read($, briefsA)
    const boom = await read($, boomA)
    if (!run && !briefs && !boom) return next(e)
    await read($, tickA)
    const now = Date.now()
    const width = Math.max(30, e.props.bodyColumns ?? 80)
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = []
    if (run) {
      const cells = [0, 1, 2, 3, 4, 5].map((i) => (i <= run.stage ? '▰' : '▱')).join('')
      const failed = run.tools.filter((t) => t.state === 'failed').length
      const count = `${run.tools.length} tool${run.tools.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`
      let trail = ''
      for (let i = run.tools.length - 1; i >= 0; i--) {
        const t = run.tools[i]!
        const chip = `${t.state === 'running' ? '•' : t.state === 'ok' ? '✓' : '✗'} ${t.label.length > 28 ? `${t.label.slice(0, 27)}…` : t.label}`
        if ((chip + '  ' + trail).length > width - count.length - 6) break
        trail = trail ? `${chip}  ${trail}` : chip
      }
      rows.push(
        <Box key="run" flexDirection="column">
          <Box>
            <Text color="claude">{cells}  {run.label}</Text>
            <Text dimColor>  {clock(now - run.startedAt)} · </Text>
            <Button key="cancel" plain label="cancel" onPress={() => S.current?.abort('cancelled')} />
          </Box>
          <Text dimColor>   {trail || 'no tools yet'}   {count}</Text>
        </Box>,
      )
    }
    if (briefs) rows.push(<Text key="briefs" dimColor>/better is checking {briefs} subagent brief{briefs === 1 ? '' : 's'}</Text>)
    if (boom) {
      rows.push(
        boom.status === 'running'
          ? <Text key="boom" dimColor>/better-boomerang is researching in a fork · {clock(now - boom.startedAt)}</Text>
          : (
            <Box key="boom">
              <Text color="claude">/better-boomerang is done  </Text>
              <Button key="back" variant="primary" label="Back with prompt" onPress={async () => {
                const said = await back($, e.surface)
                if (said) $.ui.toast(said)
              }} />
            </Box>
          ),
      )
    }
    return <Box flexDirection="column">{rows}</Box>
  })
}
