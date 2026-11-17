import type { Register } from 'claude-code'

import { helperVerdict } from './better'

// better-code-mode hooks no tool calls, so that Code Mode starts with it enabled.
// Its helper is a separate `claude -p` process, which loads this module instead
// (--plugin-dir), and this is what holds that process to reads.
export const register: Register = (on) => {
  let isHelper = false

  on('session.start', async ($, e, next) => {
    isHelper = (await $.env.get('CLAUDE_BETTER_HELPER')) === '1'
    const proof = isHelper ? await $.env.get('CLAUDE_BETTER_GUARD_FILE') : undefined
    if (proof) await $.fs.write(proof, JSON.stringify({ isGuardLoaded: true }))
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    if (!isHelper) return next(e)
    const verdict = helperVerdict(e.tool, e.isReadOnly)
    return verdict.decision === 'pass' ? next(e) : { decision: 'deny', reason: verdict.reason }
  }).catch(($, e, next) => (isHelper ? { decision: 'deny', reason: "/better's guard failed, so the call is refused" } : next(e)))
}
