// The /better MCP server for Cursor (stdio, newline-delimited JSON-RPC). Two tools:
//   better       deepen a prompt; the Cursor app offers the result in a "Create chat with prompt" dialog (its prompt link), and it goes to the clipboard
//   check_brief  check a subagent brief; returns it to use verbatim
// Progress shows on the tool card (notifications/progress). Cursor's stop button cancels the helper through the
// plugin's stop hook (cursor/stops.ts), since Cursor sends the server no notifications/cancelled.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { PLUGIN_ROOT, runHelper } from './helper.ts'
import { isInside, outsideFolder } from '../hooks/better.ts'
import { linkRefusal } from './link.ts'
import { stoppedSince } from './stops.ts'

const VERSION: string = JSON.parse(readFileSync(new URL('../.cursor-plugin/plugin.json', import.meta.url), 'utf8')).version

const TOOLS = [
  {
    name: 'better',
    description: [
      "Deepen the user's prompt with a read-only helper that reads the code it touches, then hand the improved prompt back without acting on it.",
      'Use for /better. The helper cannot see this chat, so pass what the chat established in `context`.',
      'In the Cursor app the result is offered in a "Create chat with prompt" dialog and goes to the clipboard; show it once and stop: never carry it out.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: "The user's prompt, word for word. If they gave none, the task in progress in their words, with their feedback on work already done." },
        context: { type: 'string', description: 'What this chat established that the repo alone will not show: decisions, file paths, errors, constraints. Facts only.' },
        cwd: { type: 'string', description: 'The workspace folder, or a folder inside it (absolute path). Left out: the workspace.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_brief',
    description: [
      'Check a brief before handing it to a subagent that starts with none of this chat: the read-only helper fixes references only this chat explains, wrong or stale paths, symbols and commands, and a missing done-check, and keeps the rest.',
      'Use when a subagent prompt starts with "/better " (drop the mark). Start the subagent with the returned brief verbatim; if this fails, do not start it.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'The brief as you would send it, without the "/better " mark.' },
        context: { type: 'string', description: 'Only if the brief points at things this chat decided: those facts.' },
        cwd: { type: 'string', description: 'The folder the subagent will work in: the workspace or a folder inside it (absolute path). Left out: the workspace.' },
      },
      required: ['brief'],
      additionalProperties: false,
    },
  },
]

const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const calls = new Map<string | number, AbortController>()
let supportsRoots = false

// The workspace: the client's roots (MCP roots/list), else this server's own folder. Never `/` or the home folder,
// since the helper reads everything under the folder it runs in.
let clientRoots: string[] | undefined
let rootsPending: ((roots: string[]) => void) | undefined
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return undefined
  }
}
function workspace(): string[] {
  const home = real(process.env.HOME ?? '') ?? ''
  const found = (clientRoots ?? [process.cwd()]).map(real).filter((r): r is string => !!r && r !== '/' && r !== home)
  return [...new Set(found)]
}
function askRoots(): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(() => ((rootsPending = undefined), done()), 3000)
    rootsPending = (roots) => {
      clearTimeout(timer)
      clientRoots = roots
      done()
    }
    send({ jsonrpc: '2.0', id: 'better-roots', method: 'roots/list' })
  })
}
// The folder the helper may run in, or why not.
function helperCwd(asked: unknown): { cwd: string } | { error: string } {
  const roots = workspace()
  if (!roots.length) return { error: "this window has no workspace folder (or it is / or your home folder), so there's nothing the helper may read. Open a project folder first." }
  if (typeof asked !== 'string' || !asked.trim()) return { cwd: roots[0]! }
  const target = real(isAbsolute(asked) ? asked : resolve(roots[0]!, asked))
  if (!target) return { error: `cwd ${asked} doesn't exist.` }
  return isInside(target, roots) ? { cwd: target } : { error: outsideFolder(asked, roots) }
}

// The Cursor app sets these for the processes it starts; cursor-agent in a terminal does not, and a prompt link
// would pull the app forward there, so it gets the clipboard only.
const isCursorApp = () => Boolean(process.env.VSCODE_PID || process.env.VSCODE_IPC_HOOK || process.env.CURSOR_TRACE_ID)

function toClipboard(text: string): boolean {
  if (process.platform !== 'darwin') return false
  return spawnSync('pbcopy', { input: text }).status === 0
}

// Opens Cursor's prompt link, or says why not. Cursor shows no dialog for text its own rule refuses, so that text never goes to the link.
function openInNewChat(text: string): { opened: true } | { opened: false; why?: string } {
  if (process.platform !== 'darwin' || !isCursorApp()) return { opened: false }
  const why = linkRefusal(text)
  if (why) return { opened: false, why }
  const url = `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(text)}`
  // -g: hand the link to Cursor without bringing it forward, so a user who switched apps mid-run keeps their focus.
  spawn('open', ['-g', url], { stdio: 'ignore', detached: true }).unref()
  return { opened: true }
}

async function call(id: string | number, name: string, args: any, progressToken: unknown): Promise<unknown> {
  const isBrief = name === 'check_brief'
  const body = String((isBrief ? args?.brief : args?.prompt) ?? '').replace(/^\/better(\s|$)/, '').trim()
  // The app starts one server before any workspace is open, so the roots are asked for again at each call.
  if (supportsRoots) await askRoots()
  const where = helperCwd(args?.cwd)
  if ('error' in where) return { isError: true, content: [{ type: 'text', text: `/better refused: ${where.error}${isBrief ? ' Do not start the subagent with the unchecked brief.' : ''}` }] }
  const cwd = where.cwd
  if (!body) return { isError: true, content: [{ type: 'text', text: isBrief ? 'check_brief needs the brief.' : 'better needs the prompt (or the task in progress).' }] }
  const context = typeof args?.context === 'string' && args.context.trim() ? `\n\n## What this chat established\n\n${args.context.trim()}` : ''
  const stop = new AbortController()
  calls.set(id, stop)
  // Cursor's stop button reaches only the plugin's stop hook, which leaves a marker for this workspace.
  const since = Date.now()
  const watch = setInterval(() => stoppedSince(cwd, since) && stop.abort(), 500)
  try {
    const out = await runHelper({
      kind: isBrief ? 'brief' : 'better', input: body + context, cwd, signal: stop.signal,
      onStage: (progress, total, message) => {
        if (progressToken !== undefined) send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress, total, message } })
      },
    })
    if (!out.ok) {
      const text = out.cancelled ? '/better was cancelled; nothing was produced.' : `/better failed: ${out.error}`
      return { isError: true, content: [{ type: 'text', text: isBrief ? `${text} Do not start the subagent with the unchecked brief.` : text }] }
    }
    if (isBrief) return { content: [{ type: 'text', text: out.text }] }
    // Stopped after the helper's last word but before the hand-off: drop the result rather than pop a dialog.
    if (stop.signal.aborted || stoppedSince(cwd, since)) return { isError: true, content: [{ type: 'text', text: '/better was cancelled; nothing was produced.' }] }
    const link = openInNewChat(out.text)
    const copied = toClipboard(out.text)
    const skipped = !link.opened && link.why ? ` Cursor's prompt link can't take it (${link.why}), so there is no dialog.` : ''
    const where = link.opened
      ? `Cursor is offering it in a "Create chat with prompt" dialog${copied ? ', and it is on the clipboard' : ''}; nothing was sent.`
      : `${copied ? 'It is on the clipboard, not sent.' : 'Copy it from here; nothing was sent.'}${skipped}`
    return { content: [{ type: 'text', text: `${where} Show it to the user once and stop; do not carry it out.\n\n<improved-prompt>\n${out.text}\n</improved-prompt>` }] }
  } finally {
    clearInterval(watch)
    calls.delete(id)
  }
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  if (id === 'better-roots' && method === undefined) {
    const roots = Array.isArray(msg.result?.roots) ? msg.result.roots : []
    // Cursor 3.30 sends a plain path where the spec says a file:// URI; take both.
    rootsPending?.(roots.flatMap((r: any) => {
      const uri = r?.uri
      if (typeof uri !== 'string') return []
      if (uri.startsWith('file:')) return [fileURLToPath(uri)]
      return isAbsolute(uri) ? [uri] : []
    }))
    rootsPending = undefined
    return
  }
  if (method === 'notifications/cancelled') return calls.get(params?.requestId)?.abort()
  if (method === 'notifications/initialized' || method === 'notifications/roots/list_changed') {
    if (supportsRoots) await askRoots()
    return
  }
  if (id === undefined) return
  try {
    if (method === 'initialize') {
      supportsRoots = Boolean(params?.capabilities?.roots)
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'better', version: VERSION }, instructions: `Read-only prompt deepening and brief checks. Guard: ${PLUGIN_ROOT}/hooks/register.tsx.` } })
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    if (method === 'tools/call') {
      const result = await call(id, params?.name, params?.arguments, params?._meta?.progressToken)
      return send({ jsonrpc: '2.0', id, result })
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } })
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: (e as Error).message } })
  }
})
