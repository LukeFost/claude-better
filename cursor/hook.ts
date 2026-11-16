// Cursor hooks for /better (cursor/hooks.json). Reads the hook's JSON on stdin and prints its answer on stdout.
//   stop        a turn the user aborted leaves a marker, so a /better run in that workspace is cancelled (cursor/stops.ts)
//   preToolUse  a subagent (Task) prompt that starts with "/better " is checked by the helper and replaced by the
//               checked brief, as the Claude Code mod does; if the check fails the subagent doesn't start
import { realpathSync } from 'node:fs'
import { runHelper } from './helper.ts'
import { recordStop, runOnce } from './stops.ts'
import { createHash } from 'node:crypto'

const MARK = /^\/better(\s|$)/

type Plan = { pass: true } | { deny: string } | { brief: string; cwd: string }

/** What preToolUse should do with this tool call, before any helper runs. */
export function planBrief(input: any, home = process.env.HOME ?? ''): Plan {
  const tool = String(input?.tool_name ?? '')
  const prompt = input?.tool_input?.prompt
  if (!/^(task|agent|subagent)$/i.test(tool) || typeof prompt !== 'string' || !MARK.test(prompt.trimStart())) return { pass: true }
  const brief = prompt.trimStart().replace(MARK, '').trim()
  if (!brief) return { deny: 'A /better subagent brief needs the brief after /better.' }
  const real = (p: string) => {
    try {
      return realpathSync(p)
    } catch {
      return undefined
    }
  }
  const roots = (Array.isArray(input?.workspace_roots) ? input.workspace_roots : []).filter((r: unknown) => typeof r === 'string')
  const homeReal = real(home) ?? home
  const cwd = roots.map(real).find((r: string | undefined) => !!r && r !== '/' && r !== homeReal)
  if (!cwd) return { deny: "this window has no workspace folder (or it is / or your home folder), so the /better brief can't be checked and the subagent didn't start." }
  return { brief, cwd }
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const input = JSON.parse(raw || '{}')
  const say = (out: unknown) => process.stdout.write(JSON.stringify(out))

  if (input.hook_event_name === 'stop') {
    if (input.status === 'aborted') recordStop(input.workspace_roots)
    return say({})
  }
  if (input.hook_event_name === 'preToolUse') {
    const plan = planBrief(input)
    if ('pass' in plan) return say({})
    const deny = (why: string) => ({ permission: 'deny', user_message: why, agent_message: `${why} Do not start the subagent with the unchecked brief.` })
    if ('deny' in plan) return say(deny(`/better: ${plan.deny}`))
    const key = createHash('sha256').update(JSON.stringify([input.conversation_id, input.generation_id, input.tool_input.prompt])).digest('hex').slice(0, 32)
    const answer = await runOnce(key, async () => {
      const out = await runHelper({ kind: 'brief', input: plan.brief, cwd: plan.cwd })
      if (!out.ok) return JSON.stringify(deny(out.cancelled ? "/better was cancelled, so the subagent didn't start." : `/better couldn't check this subagent brief, so the subagent didn't start: ${out.error}`))
      return JSON.stringify({ updated_input: { ...input.tool_input, prompt: out.text } })
    }).catch((e) => JSON.stringify(deny(`/better couldn't check this subagent brief, so the subagent didn't start: ${(e as Error).message}`)))
    return process.stdout.write(answer)
  }
  say({})
}

if (process.argv[1]?.endsWith('/hook.ts')) main()
