import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Handover } from './better'

import type { BetterBoomerang, BetterDraft, BetterRun, BetterWaiting } from '../types'
import {
  BRIEF_MARK, CLI_LOGIN, DRAFT_PANE, editRows, FILL_TRIES, runsDir, GUARD_ENV, MAX_READ_DIRS, fillRefusal, isOutsideRefusal, namedPaths, promptFile, readNote, rootCandidates, HELPER_ENV, isInside, isLoginFailure, outsideFolder, HELPER_TIMEOUT_MS, NO_CLAUDE, StreamReader, buildBriefTask, buildHelperTask, claudeCandidates, clock,
  desktopEngineDir, handOverText, WAIT_ARGV, helperArgv, helperExitError, helperVerdict, KEEP_RUNS, chipLabel, parseMarkedPrompt, stageOf, staleRecords, toolLine,
} from './better'

const runA = atom({ plugin: 'better', key: 'run' } as const, null as BetterRun | null)
const briefsA = atom({ plugin: 'better', key: 'briefs' } as const, 0)
const boomA = atom({ plugin: 'better', key: 'boomerang' } as const, null as BetterBoomerang | null)
const forksA = atom({ plugin: 'better', key: 'forks' } as const, [] as string[])
const waitingA = atom({ plugin: 'better', key: 'waiting' } as const, null as BetterWaiting | null)
const draftA = atom({ plugin: 'better', key: 'draft' } as const, null as BetterDraft | null)
const tickA = atom({ plugin: 'better', key: 'tick' } as const, 0)

const TOOL = 'check_brief'
const TOOL_NAME = `mcp__better__${TOOL}`

type Outcome =
  | { ok: true; checked: string; log: string; refused: number }
  | { ok: false; cancelled: boolean; isLogin?: boolean; error: string; log: string }

type HelperRequest = { kind: 'better' | 'brief'; input: string; task: string; cwd?: string; signal: AbortSignal; onProgress?: (r: StreamReader) => void }

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

async function readDirs($: EngineInterface, input: string, cwd: string, home: string): Promise<string[]> {
  const said: string[] = []
  const messages = await $.session.messages().catch(() => [])
  if (Array.isArray(messages)) {
    for (const m of messages.slice(-300)) {
      said.push(m.text ?? '')
      for (const use of m.toolUses ?? []) for (const v of Object.values(use.input ?? {})) if (typeof v === 'string') said.push(v)
    }
  }
  const realHome = (await $.fs.stat(home, { resolve: true }).catch(() => undefined))?.realPath ?? home
  const isRepo = new Map<string, boolean>()
  const roots: string[] = []
  let checked = 0
  for (const path of [...namedPaths([input], home), ...namedPaths(said, home)]) {
    if (roots.length >= MAX_READ_DIRS || checked >= 200) break
    const candidates = isInside(path, [cwd]) ? [] : rootCandidates(path, home)
    if (!candidates.length) continue
    checked++
    for (const dir of candidates) {
      let hit = isRepo.get(dir)
      if (hit === undefined) isRepo.set(dir, (hit = await $.fs.exists(`${dir}/.git`).catch(() => false)))
      if (!hit) continue
      const real = (await $.fs.stat(dir, { resolve: true }).catch(() => undefined))?.realPath
      if (real && rootCandidates(real, realHome)[0] === real && !isInside(real, [cwd]) && !roots.includes(real)) roots.push(real)
      break
    }
  }
  return roots
}

type ForkEnd = { reason: string; answer: string }

async function runInSession($: EngineInterface, req: HelperRequest): Promise<{ agentId?: string; reply?: string; checked?: string; error?: string; cancelled?: boolean; isUnmarked?: boolean }> {
  if (req.signal.aborted) return { error: 'cancelled', cancelled: true }
  S.spawning++
  S.tasks.set(req.task, undefined)
  let id: string | undefined
  try {
    const spawned = await $.agent.spawn({ subagentType: 'fork', prompt: req.task, description: req.kind === 'brief' ? '/better brief check' : '/better', ...(req.cwd ? { cwd: req.cwd } : {}) })
    if ('deny' in spawned && spawned.deny) return { error: `Claude Code refused to start it (${spawned.deny})` }
    id = spawned.agentId ?? S.tasks.get(req.task)
    if (!id) return { error: 'Claude Code started no agent' }
    const agentId = id
    S.forks.add(agentId)
    await update($, forksA, (ids) => [...new Set([...(ids ?? []), agentId])])
    S.mine.add(agentId)
  } catch (e) {
    return { agentId: id, error: `it couldn't start (${(e as Error).message})` }
  } finally {
    S.tasks.delete(req.task)
    if (!--S.spawning) for (const other of S.ended.keys()) if (!S.mine.has(other)) S.ended.delete(other)
  }
  const agentId = id
  try {
    const deadline = (await $.clock.now()) + HELPER_TIMEOUT_MS
    let end: ForkEnd | undefined
    while (!(end = S.ended.get(agentId))) {
      if (req.signal.aborted) return { agentId, error: 'cancelled', cancelled: true }
      if ((await $.clock.now()) > deadline) return { agentId, error: `it timed out after ${HELPER_TIMEOUT_MS / 60_000} minutes` }
      await $.process.run(WAIT_ARGV)
    }
    if (end.reason !== 'answer') return { agentId, reply: end.answer, error: `it ended without an answer (${end.reason})` }
    try {
      return { agentId, reply: end.answer, checked: parseMarkedPrompt(end.answer) }
    } catch (e) {
      return { agentId, reply: end.answer, isUnmarked: true, error: `its reply was unusable twice (${(e as Error).message})` }
    }
  } catch (e) {
    return { agentId, error: `/better couldn't wait for it (${(e as Error).message})` }
  } finally {
    S.mine.delete(agentId)
    S.ended.delete(agentId)
  }
}

async function runHelper($: EngineInterface, req: HelperRequest): Promise<Outcome> {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = req.cwd ?? (await $.session.cwd())
  const startedAt = await $.clock.now()
  const id = crypto.randomUUID().slice(0, 8)
  const runs = runsDir(home, $.plugin.root, await $.env.get('CLAUDE_BETTER_RUNS_DIR'))
  const log = `${runs}/${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${req.kind}-${id}.json`
  const sessionId = (await $.session.turns()) > 0 ? await $.session.id() : undefined
  const model = await $.session.model()
  const claude = await findClaude($, home)
  const addDirs = req.kind === 'better' ? await readDirs($, req.input, cwd, home).catch(() => [] as string[]) : []
  const argv = helperArgv({ claude: claude ?? 'claude', sessionId, model, pluginRoot: $.plugin.root, addDirs })
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
    const child = $.process.spawn({ argv, cwd, env: { [HELPER_ENV]: '1', [GUARD_ENV]: log }, input: `${req.task}\n\n${readNote(cwd, addDirs)}` })
    for (;;) {
      const pending = child.next()
      pending.catch(() => {})
      const step = await Promise.race([pending, stopped])
      if (step === 'stopped') {
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
    } else if (reader.resultError) error = `The helper's model call failed: ${reader.resultError}`
    else if (exit && exit.code !== 0) error = `${helperExitError(exit.code, exit.signal)}; its stderr is in ${log}`
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
  const isGuarded = await $.fs.read(log).then((t) => JSON.parse(t)?.isGuardLoaded === true).catch(() => false)
  if (exit && !isGuarded && !error) {
    checked = undefined
    error = `The helper's read-only guard didn't load, so its result was not used. Check that ${$.plugin.root}/hooks/register.tsx loads (claude plugin validate), then try again.`
  }
  let inSession: Awaited<ReturnType<typeof runInSession>> | undefined
  const isLogin = !cancelled && !!reader.resultError && (reader.authFailed || isLoginFailure(reader.resultError))
  if (isLogin) {
    inSession = await runInSession($, req)
    if (inSession.isUnmarked) inSession = await runInSession($, req)
    checked = inSession.checked
    cancelled = inSession.cancelled === true
    error = checked !== undefined ? undefined : cancelled ? 'cancelled' : `${CLI_LOGIN} (The CLI said: ${reader.resultError}) /better then tried a read-only fork of this session instead, and ${inSession.error}.`
  }
  const durationMs = (await $.clock.now()) - startedAt
  const record = {
    kind: req.kind, input: req.input, cwd, sessionId, model, claude: claude ?? null, addDirs, argv: argv.slice(1), durationMs, exit, cancelled, isGuardLoaded: isGuarded,
    error, stderrTail: stderr.trim().split('\n').slice(-3), tools: reader.tools.map(toolLine),
    reply: reader.reply, checked, ...(inSession ? { cliError: reader.resultError, inSession: { agentId: inSession.agentId, error: inSession.error, reply: inSession.reply } } : {}),
  }
  const pruneError = await pruneRuns($, runs)
  await $.fs.write(log, JSON.stringify(pruneError ? { ...record, pruneError } : record, null, 2)).catch(() => {})
  const refused = reader.tools.filter((t) => t.state === 'failed' && isOutsideRefusal(t.why)).length
  return checked !== undefined && !error ? { ok: true, checked, log, refused } : { ok: false, cancelled, isLogin: isLogin && !cancelled && !inSession?.agentId, error: error ?? 'unknown failure', log }
}

async function pruneRuns($: EngineInterface, dir: string): Promise<string | undefined> {
  try {
    const stale = staleRecords((await $.fs.list(dir)).filter((e) => e.kind === 'file').map((e) => e.name), KEEP_RUNS)
    if (!stale.length || !dir.startsWith('/')) return undefined
    for (let i = 0; i < stale.length; i += 500) {
      const child = $.process.spawn({ argv: ['/bin/rm', '-f', '--', ...stale.slice(i, i + 500).map((n) => `${dir}/${n}`)], cwd: dir })
      for (;;) {
        const step = await child.next()
        if (!step.done) continue
        if (step.value.code !== 0) return `rm exited with code ${step.value.code}`
        break
      }
    }
    return undefined
  } catch (e) {
    return (e as Error).message
  }
}

type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

async function noteHandover($: EngineInterface, log: string | undefined, handover: Handover): Promise<void> {
  if (!log) return
  try {
    await $.fs.write(log, JSON.stringify({ ...JSON.parse(await $.fs.read(log)), handover }, null, 2))
  } catch {}
}

async function handOver($: EngineInterface, improved: string, opts: { surface?: Surface; saveTo?: string; log?: string; note?: string; isRetry?: boolean; extra?: Partial<Handover> } = {}): Promise<boolean> {
  let draft = ''
  let refusal: string | undefined
  let tries = 0
  for (let i = 0; i < (opts.isRetry ? 1 : FILL_TRIES); i++) {
    tries++
    if (i) await $.process.run(WAIT_ARGV).catch(() => {})
    draft = (await $.prompt.read()).text
    const filled = await $.prompt.fill({ text: handOverText(improved, draft), mode: 'replace' })
    if (filled.isFilled) {
      await update($, waitingA, () => null)
      await noteHandover($, opts.log, { result: opts.isRetry ? 'filled_later' : 'filled', tries, ...opts.extra })
      $.ui.toast(`The improved prompt is in your input box${draft.trim() ? ", above the draft you'd typed" : ''}. Edit it, then press Enter to send.${opts.note ?? ''}`, { timeoutMs: 8000 })
      return true
    }
    refusal = filled.refusal
  }
  const why = fillRefusal(refusal)
  if (opts.isRetry) {
    $.ui.toast(`The input box still couldn't take the prompt (${why}). Nothing was sent.`, { timeoutMs: 8000 })
    return false
  }
  const copied = await $.ui.copy({ text: improved, ...(opts.surface ? { surface: opts.surface } : {}) }).catch(() => ({ isCopied: false }))
  const path = opts.saveTo && (await $.fs.write(opts.saveTo, `${improved}\n`).then(() => opts.saveTo, () => undefined))
  await update($, waitingA, () => ({ improved, ...(path ? { path } : {}), ...(opts.log ? { log: opts.log } : {}) }))
  await noteHandover($, opts.log, { result: 'kept', tries, ...(refusal ? { refusal } : {}), isCopied: copied.isCopied, ...(path ? { savedTo: path } : {}), ...opts.extra })
  $.ui.log(`/better's improved prompt (not sent; ${why}):\n\n${improved}`)
  const where = [copied.isCopied ? 'on your clipboard' : '', path ? `saved in ${path}` : '', 'shown in the chat'].filter(Boolean).join(', ')
  $.ui.toast(`The input box couldn't take the prompt (${why}). It is ${where}. Press "Put in input box" above the prompt, or run /better-back, to try again. Nothing was sent.${opts.note ?? ''}`, { timeoutMs: 20000 })
  return false
}

const S: {
  isHelper: boolean; edit?: string; current?: AbortController; ticker?: { cancel: () => void }; forks: Set<string>
  spawning: number; tasks: Map<string, string | undefined>; mine: Set<string>; ended: Map<string, ForkEnd>
} = { isHelper: false, forks: new Set(), spawning: 0, tasks: new Map(), mine: new Set(), ended: new Map() }

const DRAFT_TITLE = '/better draft'

async function showDraft($: EngineInterface, improved: string, opts: { saveTo?: string; log?: string; note?: string } = {}): Promise<boolean> {
  const prior = await read($, draftA)
  const path = opts.saveTo && (await $.fs.write(opts.saveTo, `${improved}\n`).then(() => opts.saveTo, () => undefined))
  await update($, draftA, () => ({ text: improved, isEditing: false, ...(path ? { path } : {}), ...(opts.log ? { log: opts.log } : {}) }))
  const opened = await $.ui.open({ id: DRAFT_PANE, title: DRAFT_TITLE }).catch(() => ({ isPlaced: false as const }))
  if (!opened.isPlaced) {
    await update($, draftA, () => prior)
    if (!prior) await $.ui.close({ id: DRAFT_PANE }).catch(() => {})
    return false
  }
  S.edit = undefined
  await noteHandover($, opts.log, { result: 'pane', tries: 0, ...(path ? { savedTo: path } : {}) })
  const replaced = prior ? ` It replaced an earlier draft${prior.path ? `, which is saved in ${prior.path}` : ''}.` : ''
  const news = `${replaced}${opts.note ?? ''}`.trim()
  if (news) $.ui.toast(`The ${DRAFT_TITLE} pane has a new draft.${news ? ` ${news}` : ''}`, { timeoutMs: 10000 })
  return true
}

async function saveEdit($: EngineInterface, value: string | undefined): Promise<void> {
  await update($, draftA, (d) => (d ? { ...d, isEditing: false, ...(value !== undefined && value !== d.text ? { text: value, isEdited: true } : {}) } : d))
  S.edit = undefined
}

async function endDraft($: EngineInterface, how: 'sent' | 'box' | 'dropped', surface?: Surface): Promise<void> {
  const draft = await read($, draftA)
  if (!draft) return
  const text = draft.isEditing ? S.edit ?? draft.text : draft.text
  const isEdited = draft.isEdited === true || text !== draft.text
  const done = { viaPane: true, ...(isEdited ? { isEdited } : {}) }
  if (how === 'sent') {
    if (!text.trim()) return void $.ui.toast('The draft is empty, so nothing was sent.')
    if (draft.isSending) return
    await update($, draftA, (d) => (d ? { ...d, isSending: true } : d))
    const sent = await $.prompt.submit({ text, asUser: true }).catch((e) => ({ drop: (e as Error).message }))
    if (sent.drop !== undefined) await update($, draftA, (d) => (d ? { ...d, isSending: false } : d))
    if (sent.drop !== undefined) return void $.ui.toast(`Couldn't send the draft (${sent.drop}). It stays in the pane; nothing was sent.`, { timeoutMs: 10000 })
  }
  await update($, draftA, () => null)
  S.edit = undefined
  await $.ui.close({ id: DRAFT_PANE }).catch(() => {})
  if (how === 'box') return void (await handOver($, text, { surface, log: draft.log, saveTo: draft.path, extra: done }))
  await noteHandover($, draft.log, { result: how, tries: 0, ...done })
  if (how === 'dropped') $.ui.toast(`The draft was dropped; nothing was sent.${draft.path ? ` A copy is in ${draft.path}.` : ''}`, { timeoutMs: 8000 })
}

function startTicker($: EngineInterface): void {
  S.ticker ??= $.clock.every(1000, () => void update($, tickA, (n) => (n ?? 0) + 1))
}

async function stopTickerIfIdle($: EngineInterface): Promise<void> {
  if ((await read($, runA)) || (await read($, briefsA)) || (await read($, boomA))?.status === 'running') return
  S.ticker?.cancel()
  S.ticker = undefined
}

async function back($: EngineInterface, surface?: Surface): Promise<string | undefined> {
  const boom = await read($, boomA)
  const draft = boom?.improved ? null : await read($, draftA)
  if (draft) {
    const opened = await $.ui.open({ id: DRAFT_PANE, title: DRAFT_TITLE, focus: true }).catch(() => ({ isPlaced: false as const }))
    if (opened.isPlaced) {
      await update($, draftA, (d) => (d ? { ...d, isHidden: false } : d))
      return `The ${DRAFT_TITLE} pane is open.`
    }
    await endDraft($, 'box', surface)
    return (await read($, waitingA)) ? "The input box couldn't take the prompt; it is kept for you, see the note above the prompt. Nothing was sent." : undefined
  }
  if (!boom?.improved) {
    const waiting = await read($, waitingA)
    if (!waiting) return 'No /better draft is waiting.'
    return (await handOver($, waiting.improved, { surface, log: waiting.log, isRetry: true })) ? undefined : `The input box still couldn't take the prompt${waiting.path ? `; it is saved in ${waiting.path}` : ''}. Nothing was sent.`
  }
  const viewed = await $.ui.view({})
  if (viewed.deny && boom.isViewed !== false) return `Couldn't switch back to the main conversation: ${viewed.deny}`
  const home = (await $.env.get('HOME')) ?? ''
  const saveTo = `${runsDir(home, $.plugin.root, await $.env.get('CLAUDE_BETTER_RUNS_DIR'))}/${new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')}-better-${crypto.randomUUID().slice(0, 8)}.md`
  const isFilled = await handOver($, boom.improved, { surface, saveTo })
  await update($, boomA, () => null)
  return isFilled ? undefined : "The input box couldn't take the prompt; it is kept for you, see the note above the prompt. Nothing was sent."
}

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
      const proof = await $.env.get('CLAUDE_BETTER_GUARD_FILE')
      if (proof) await $.fs.write(proof, JSON.stringify({ isGuardLoaded: true }))
      return next(e)
    }
    const started = await next(e)
    await $.command.register({ name: 'better', description: 'Deepen a prompt (or the current task) with a read-only helper in the background, then put the improved prompt in your input box', argumentHint: '[prompt]' })
    await $.command.register({ name: 'better-cancel', description: 'Stop the /better helper that is running; nothing is sent' })
    await $.command.register({ name: 'better-boomerang', description: 'Watch a read-only fork of this chat deepen a prompt (or the current task), then come back with it in your input box', argumentHint: '[prompt]' })
    await $.command.register({ name: 'better-back', description: 'Put a waiting /better or /better-boomerang prompt in your input box' })
    await $.tool.register({
      name: TOOL,
      isDeferred: false,
      description: [
        'Check a brief before you hand it to a subagent, a teammate or a new session that starts with none of this conversation.',
        "A read-only helper on a copy of this chat reads the brief cold, checks it against the repo, and fixes only what would trip the receiver up: references only this conversation explains, wrong or stale paths, symbols, commands and versions, and a missing done-check. It keeps the brief's goal, scope, order and length and adds no work.",
        'Returns the checked brief, to use as the task verbatim. If it fails or is cancelled it returns an error: do not start the work with the unchecked brief. The one exception is an error that says a login problem stopped the check: tell the user what it says, then go on with the unchecked brief.',
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

  on('tool.check', async ($, e, next) => {
    if (!S.isHelper && !(e.agentId !== undefined && (S.forks.has(e.agentId) || ((await read($, forksA)) ?? []).includes(e.agentId)))) return next(e)
    const verdict = helperVerdict(e.tool, e.isReadOnly)
    return verdict.decision === 'pass' ? next(e) : { decision: 'deny', reason: verdict.reason }
  }).catch(async ($, e, next) => {
    const isFork = e.agentId !== undefined && (S.forks.has(e.agentId) || ((await read($, forksA).catch(() => [] as string[])) ?? []).includes(e.agentId))
    return S.isHelper || isFork ? { decision: 'deny', reason: "/better's guard failed, so the call is refused" } : next(e)
  })

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
        const note = out.ok && out.refused ? ` The helper was refused ${out.refused === 1 ? '1 read' : `${out.refused} reads`}, most often for a path outside its folders; the run record lists them.` : ''
        if (out.ok && surface === 'desktop' && (await showDraft($, out.checked, { saveTo: promptFile(out.log), log: out.log, note }))) return
        if (out.ok) await handOver($, out.checked, { surface, saveTo: promptFile(out.log), log: out.log, note })
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

  on('command.run', { command: 'better-boomerang' }, async ($, e) => {
    if (S.isHelper) return { text: '/better-boomerang is off inside its own helper.' }
    const prompt = e.args.trim()
    if (!prompt && (await $.session.turns()) === 0) return { text: '/better-boomerang has no task to deepen yet; give it a prompt: /better-boomerang <prompt>' }
    if ((await read($, boomA))?.status === 'running') return { text: '/better-boomerang is already running; wait for it to finish.' }
    const spawned = await $.agent.spawn({ subagentType: 'fork', prompt: buildHelperTask(prompt), description: '/better-boomerang' })
    if (!spawned.agentId) {
      const deny = 'deny' in spawned && spawned.deny ? spawned.deny : 'no agent started'
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined && S.tasks.has(e.text)) {
      S.forks.add(e.agentId)
      S.tasks.set(e.text, e.agentId)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      if (S.mine.has(e.agentId) || S.spawning) S.ended.set(e.agentId, { reason: e.reason, answer: e.answer })
    }
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
    return { text: said ?? 'The improved prompt is in your input box.', isTextDisplayOnly: true }
  })

  on('tool.call', { tool: TOOL_NAME }, async ($, e, next) => {
    const input = e as unknown as { brief?: unknown; cwd?: unknown }
    if (typeof input.brief !== 'string' || !input.brief.trim()) return { deny: 'check_brief needs the brief.' }
    const where = await briefCwd($, typeof input.cwd === 'string' ? input.cwd : undefined)
    if ('deny' in where) return { deny: where.deny }
    const out = await checkBrief($, input.brief.trim(), where.cwd, next.signal)
    if (out.ok) return { result: out.checked }
    if (out.cancelled) return { deny: '/better was cancelled, so the brief is unchecked; do not start the work with it.' }
    if (out.isLogin) return { deny: `/better couldn't check this brief because of a login problem, not because of the brief. ${out.error} Tell the user that in one line, with the command; then you may start the work with the unchecked brief. (run log: ${out.log})` }
    return { deny: `/better couldn't check this brief, so do not start the work with it: ${out.error} (run log: ${out.log})` }
  }).catch(() => ({ deny: "/better's brief check failed, so the brief is unchecked; do not start the work with it." }))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (S.isHelper || typeof e.prompt !== 'string' || !BRIEF_MARK.test(e.prompt)) return next(e)
    const brief = e.prompt.replace(BRIEF_MARK, '').trim()
    if (!brief) return { deny: 'A /better subagent brief needs the brief after /better.' }
    const out = await checkBrief($, brief, undefined, next.signal)
    if (!out.ok && out.isLogin) return { deny: `/better couldn't check this subagent brief because of a login problem, not because of the brief, so the subagent didn't start. ${out.error} Tell the user that in one line, with the command; then send the Agent call again without the /better prefix to start it unchecked.` }
    if (!out.ok) return { deny: out.cancelled ? "/better was cancelled, so the subagent didn't start." : `/better couldn't check this subagent brief, so the subagent didn't start: ${out.error}` }
    return next({ ...e, prompt: out.checked })
  }).catch(($, e, next) => (next.called ? next(e) : typeof e.prompt === 'string' && BRIEF_MARK.test(e.prompt) ? { deny: "/better's brief check failed, so the subagent didn't start." } : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (S.isHelper) return next(e)
    const run = await read($, runA)
    const briefs = await read($, briefsA)
    const boom = await read($, boomA)
    const waiting = await read($, waitingA)
    const draft = await read($, draftA)
    const hidden = draft?.isHidden ? draft : null
    if (!run && !briefs && !boom && !waiting && !hidden) return next(e)
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
        const chip = `${t.state === 'running' ? '•' : t.state === 'ok' ? '✓' : '✗'} ${chipLabel(t.label)}`
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
    if (waiting) {
      rows.push(
        <Box key="waiting" flexDirection="column">
          <Box>
            <Text color="claude">/better's draft is waiting  </Text>
            <Button key="put" variant="primary" label="Put in input box" onPress={async () => void (await handOver($, waiting.improved, { surface: e.surface, log: waiting.log, isRetry: true }))} />
            <Text>  </Text>
            <Button key="drop" plain label="drop" onPress={() => update($, waitingA, () => null)} />
          </Box>
          {waiting.path ? <Text dimColor>   {waiting.path}</Text> : null}
        </Box>,
      )
    }
    if (hidden) {
      rows.push(
        <Box key="draft">
          <Text color="claude">/better's draft is waiting  </Text>
          <Button key="show" variant="primary" label="Show draft" onPress={async () => {
            const said = await back($, e.surface)
            if (said && !/pane is open/.test(said)) $.ui.toast(said)
          }} />
        </Box>,
      )
    }
    return <Box flexDirection="column">{rows}</Box>
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === DRAFT_PANE && e.origin.kind === 'person') await update($, draftA, (d) => (d ? { ...d, isHidden: true } : d))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: DRAFT_PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
    const draft = await read($, draftA)
    if (!draft) return <Text dimColor>No /better draft is open. Run /better to make one.</Text>
    if (draft.isEditing) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Editing. Enter saves, Shift+Enter adds a line. Nothing is sent from here.</Text>
          <Box>
            <Button key="done" variant="primary" label="Done" onPress={() => saveEdit($, S.edit)} />
            <Text>  </Text>
            <Button key="undo" plain label="discard edit" onPress={() => saveEdit($, undefined)} />
          </Box>
          <Input key="edit" rows={editRows(draft.text)} value={S.edit ?? draft.text} submitLabel="save" onInput={(value) => void (S.edit = value)} onSubmit={(value) => saveEdit($, value)} />
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {draft.isSending
          ? <Text key="status" dimColor>Sending when Claude's turn ends.</Text>
          : (
            <Box flexWrap="wrap">
              <Button key="send" variant="primary" label="Send to thread" onPress={() => void endDraft($, 'sent', e.surface).catch((err) => $.ui.toast(`Couldn't send the draft: ${(err as Error).message}`))} />
              <Text>  </Text>
              <Button key="edit-it" label="Edit" onPress={() => update($, draftA, (d) => (d ? { ...d, isEditing: true } : d))} />
              <Text>   </Text>
              <Button key="box" plain dimColor label="to input box" onPress={() => endDraft($, 'box', e.surface)} />
              <Text dimColor> · </Text>
              <Button key="drop" plain dimColor label="drop" onPress={() => endDraft($, 'dropped', e.surface)} />
            </Box>
          )}
        {draft.isEdited && !draft.isSending ? <Text key="status" dimColor>Edited by you.</Text> : null}
        <Box marginTop={1}>
          <Markdown text={draft.text} />
        </Box>
      </Box>
    )
  })
}
