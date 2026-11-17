const OPEN = '<improved-prompt>'
const CLOSE = '</improved-prompt>'
const OPEN_LINE = `\n${OPEN}\n`

export const HELPER_MD = `First, without asking me anything, find and read the code, files, docs and logs this touches, so your answers rest on them. I want a deeper version of this task/plan request, not a bigger one. Before rewriting it: (1) say what a top professional in this field would do here that I'm not asking for; (2) name the rawest material they would start from instead of what has already been digested for me; (3) name the specific methods and tools they would use; (4) say what, other than you or me, would show the result is right. Then rewrite my prompt to ask for exactly that.

## How to work

1. Gather the raw material. Don't rely on summaries in the conversation when the source is reachable, and screenshots count too.
   Keep every command quick; I'm waiting until you finish. Search the project and the paths the request names, not whole home, session-log or cache directories (\`~/.claude/projects\` alone can hold tens of gigabytes). Give any command that might be slow a \`timeout\` of 30 seconds or less, and when one times out, narrow it instead of retrying it.
2. Answer (1) to (4) in a few lines each, using concrete facts from what you found: file names, counts, real names of components, commands and tools that exist here.
3. Rewrite the prompt so it asks for exactly that: the deeper version, not a bigger one. Keep my goal and voice, put the concrete facts in, and say what proves the result is right. Write it as my own request, ready to send as is.

Never carry the prompt out. Don't edit files, start work, or launch anything; you only read and rewrite.`

export const BRIEF_MD = `The brief below is for a subagent that starts with none of this conversation: it sees only the brief, the repo and its own tools. Without asking me anything, read the brief the way that subagent would, check it against the real code, files, docs and logs, and fix only what would trip it up. I want a brief the subagent can act on cold, not a bigger one.

## How to work

1. Keep every command quick; I'm waiting until you finish. Search the project and the paths the brief names, not whole home, session-log or cache directories (\`~/.claude/projects\` alone can hold tens of gigabytes). Give any command that might be slow a \`timeout\` of 30 seconds or less, and when one times out, narrow it instead of retrying it.
2. In a few lines each, using concrete facts from what you found:
   (1) List what the subagent can't resolve on its own: references to things only this conversation explains ("the bug we found", "option B", "as discussed"), decisions the brief relies on but doesn't state, and files, commands or setup it assumes.
   (2) Check every path, symbol, line number, command and version the brief names against the repo as it is now, and list what is wrong or out of date with the correct value.
   (3) Say how the subagent will know it's done. If the brief doesn't say, find the real check here: a test, a command, an output, a file to compare.
3. Rewrite the brief with only those gaps fixed: put the missing facts in, correct what's wrong, and add the check from (3) if it was missing. Keep its goal, scope, order, wording and length as close to the original as you can. Don't add work it doesn't ask for. If nothing needs fixing, return it unchanged.

Never carry the brief out. Don't edit files, start work, or launch anything; you only read and rewrite.`

const returnSection = (last: number, what: string) => `## Return

Give answers (1) to (${last}) in your reply, each starting a new line with its number, like "(1)". Then end it with the ${what}, complete, between these two lines and nothing after them:

${OPEN}
the ${what}
${CLOSE}`

export function buildHelperTask(prompt: string): string {
  return [
    HELPER_MD,
    `## Prompt to deepen\n\n${prompt || 'None given: deepen the task in progress in the conversation so far, including any feedback I gave on work already done.'}`,
    returnSection(4, 'rewritten prompt'),
  ].join('\n\n')
}

export const BRIEF_MARK = /^\/better(?=\s|$)/

export function buildBriefTask(brief: string): string {
  return [BRIEF_MD, `## Brief to check\n\n${brief}`, returnSection(3, 'brief')].join('\n\n')
}

export function parseMarkedPrompt(reply: string): string {
  const end = reply.lastIndexOf(CLOSE)
  const before = `\n${reply.slice(0, Math.max(end, 0))}`
  const start = before.lastIndexOf(OPEN_LINE)
  if (end < 0 || start < 0) throw new Error(`The reply has no ${OPEN} … ${CLOSE} block.`)
  const prompt = before.slice(start + OPEN_LINE.length).trim()
  if (!prompt) throw new Error(`The reply's ${OPEN} block is empty.`)
  return prompt
}

export function replyProgress(text: string): { answered: number; writingPrompt: boolean } {
  let answered = 0
  for (const [, n] of text.matchAll(/^\W*\(([1-4])\)/gm)) answered = Math.max(answered, Number(n))
  return { answered, writingPrompt: `\n${text}`.includes(OPEN_LINE) }
}

export function handOverText(improved: string, draft: string): string {
  const kept = draft.trim()
  return kept ? `${improved}\n\n${kept}` : improved
}

export const HELPER_ENV = 'CLAUDE_BETTER_HELPER'
export const GUARD_ENV = 'CLAUDE_BETTER_GUARD_FILE'
export const HELPER_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'] as const
const norm = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)
export function isInside(path: string, roots: readonly string[]): boolean {
  const target = norm(path)
  return roots.some((root) => {
    const r = norm(root)
    return !!r && (target === r || target.startsWith(r === '/' ? '/' : `${r}/`))
  })
}

export const outsideFolder = (cwd: string, roots: readonly string[]) =>
  `cwd ${cwd} is outside this session's folder (${roots.join(', ')}), and the helper reads everything under its cwd, so the check was refused. Leave cwd out, or give a folder inside the session's.`

export const HELPER_TIMEOUT_MS = 20 * 60 * 1000

export function claudeCandidates(path: string, home: string): string[] {
  const windows = path.includes(';')
  const names = windows ? ['claude.exe', 'claude'] : ['claude']
  const dirs = path.split(windows ? ';' : ':').filter(Boolean)
  if (home) dirs.push(`${home}/.local/bin`, `${home}/.claude/local`)
  dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  return [...new Set(dirs.flatMap((d) => names.map((n) => `${d.replace(/[\\/]$/, '')}/${n}`)))]
}

export const desktopEngineDir = (home: string, version: string) => `${home}/Library/Application Support/Claude/claude-code/${version}`

export const NO_CLAUDE =
  "Couldn't find the `claude` CLI for the helper: it isn't on PATH, in ~/.local/bin, /opt/homebrew/bin or /usr/local/bin, or in the desktop app's own engine. " +
  'Install it (https://code.claude.com/docs/en/setup) so `which claude` finds it in a login shell, then start a new session.'

export const isLoginFailure = (said: string) => /failed to authenticate|not logged in|authentication required|login (expired|reached its time limit)|session expired|oauth (session|token|refresh token)|invalid api key|invalid bearer|authentication_error/i.test(said)

export const CLI_LOGIN =
  "The helper runs the `claude` CLI, and that CLI's own login has expired or is missing (it is kept apart from the login of the app you are in). Run `claude auth login` in a terminal to fix it."

export const WAIT_ARGV = ['/bin/sleep', '1'] as const

export function helperArgv(opts: { claude: string; sessionId?: string; model?: string; pluginRoot: string }): string[] {
  return [
    opts.claude, '-p',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ...(opts.sessionId ? ['--resume', opts.sessionId, '--fork-session'] : []),
    '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--setting-sources', '',
    '--strict-mcp-config',
    ...(opts.model ? ['--model', opts.model] : []),
    '--plugin-dir', opts.pluginRoot,
    '--tools', HELPER_TOOLS.join(','),
  ]
}

export function helperVerdict(tool: string, isReadOnly: boolean | undefined): { decision: 'pass' } | { decision: 'deny'; reason: string } {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return { decision: 'pass' }
  if (tool === 'Bash' && isReadOnly) return { decision: 'pass' }
  const why = tool === 'Bash' ? 'that command is not read-only' : `${tool} is off`
  return { decision: 'deny', reason: `/better's helper only reads and rewrites, so ${why}. Use Read, Grep, Glob or a read-only Bash command.` }
}

export type ToolRow = { id: string; label: string; state: 'running' | 'ok' | 'failed'; why?: string }

export function shortPath(path: string, cwd: string, home: string): string {
  if (path === cwd) return '.'
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`
  return path
}

export function toolLabel(name: string, input: any, cwd: string, home: string): string {
  let label = name
  if (name === 'Bash' && typeof input?.command === 'string') {
    const parts = input.command.split(/\s*(?:&&|\|\||;|\|&|\||(?<![<>&|])&(?![>&])|\n)\s*/).map((p: string) => p.trim()).filter((p: string) => p && !/^cd\s/.test(p))
    const first = (parts[0] ?? '') + (parts.length > 1 ? ` (+${parts.length - 1} more)` : '')
    label = first.replace(/(?<![\w.~$>:/])\/(?!dev\/)[\w.@+-]+(?:\/[\w.@+-]*)*/g, (p: string) => shortPath(p, cwd, home))
  } else {
    const path = typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : undefined
    const target = path ? shortPath(path, cwd, home) : input?.pattern
    if (typeof target === 'string') label = `${name} ${target}`
  }
  return label.replace(/[\s\p{Cc}]+/gu, ' ').trim() || name
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join(' ')
  return ''
}

export function chipLabel(label: string, max = 28): string {
  const [, base = '', more = ''] = /^(.*?)( \(\+\d+ more\))?$/s.exec(label) ?? []
  const room = max - more.length
  return `${base.length > room ? `${base.slice(0, room - 1)}…` : base}${more}`
}

export const toolLine = (t: ToolRow) => `${t.state} ${t.label}${t.why ? `: ${t.why}` : ''}`

export const KEEP_RUNS = 200
const RUN_RECORD = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(?:better|brief)-[0-9a-f]{8}\.json$/

export function staleRecords(names: readonly string[], keep = KEEP_RUNS): string[] {
  const records = names.filter((n) => RUN_RECORD.test(n)).toSorted()
  return records.slice(0, Math.max(0, records.length - keep))
}

export class StreamReader {
  tools: ToolRow[] = []
  text = ''
  reply = ''
  resultError: string | undefined
  sawResult = false
  private buffered = ''
  private cwd: string
  private home: string
  constructor(cwd: string, home: string) {
    this.cwd = cwd
    this.home = home
  }

  push(chunk: string): boolean {
    const lines = (this.buffered + chunk).split('\n')
    this.buffered = lines.pop() ?? ''
    let changed = false
    for (const line of lines) changed = this.line(line) || changed
    return changed
  }

  end(): boolean {
    const rest = this.buffered
    this.buffered = ''
    return rest ? this.line(rest) : false
  }

  private line(line: string): boolean {
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      return false
    }
    if (ev.type === 'stream_event') {
      const inner = ev.event
      if (inner?.type === 'message_start') this.text = ''
      else if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') this.text += inner.delta.text
      else return false
      return true
    }
    if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      let changed = false
      for (const part of ev.message.content) {
        if (part.type === 'tool_use' && !this.tools.some((t) => t.id === part.id)) {
          this.tools.push({ id: part.id, label: toolLabel(part.name, part.input, this.cwd, this.home), state: 'running' })
          changed = true
        }
        if (part.type === 'text' && part.text.trim()) this.reply = part.text
      }
      return changed
    }
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      let changed = false
      for (const part of ev.message.content) {
        const tool = part.type === 'tool_result' && this.tools.find((t) => t.id === part.tool_use_id)
        if (tool) {
          tool.state = part.is_error ? 'failed' : 'ok'
          if (part.is_error) tool.why = resultText(part.content).replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, 200)
          changed = true
        }
      }
      return changed
    }
    if (ev.type === 'result') {
      this.sawResult = true
      if (typeof ev.result === 'string' && ev.result.trim()) this.reply = ev.result
      if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) this.resultError = typeof ev.result === 'string' && ev.result ? ev.result : ev.subtype ?? 'error'
      return true
    }
    return false
  }
}

export function helperExitError(code: number | null, signal: string | null): string {
  return `The helper ${code === null ? `was stopped by ${signal}` : `exited with code ${code}`}`
}

const ANSWERING = ['Working out what a pro would do', 'Finding the rawest material', 'Picking the methods and tools', 'Deciding what would prove it right']

export function stageOf(text: string, questions = 4): { stage: number; label: string } {
  const { answered, writingPrompt } = replyProgress(text)
  if (writingPrompt) return { stage: questions + 1, label: questions === 4 ? 'Writing your improved prompt' : 'Writing the checked brief' }
  if (answered) return { stage: answered, label: questions === 4 ? `${ANSWERING[answered - 1]} (${answered} of 4)` : `Checking the brief (${answered} of 3)` }
  return { stage: 0, label: 'Reading your code and files' }
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
