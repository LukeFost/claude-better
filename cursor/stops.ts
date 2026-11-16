// Cursor's stop button never reaches an MCP server (Cursor 3.30.14 sends no notifications/cancelled), so the plugin's
// `stop` hook leaves a marker here when a turn is aborted, and the server cancels a run in that workspace that began
// before it. Markers are small JSON files: {"at": <ms>, "roots": [<real paths>]}.
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isInside } from '../hooks/better.ts'

const KEEP_MS = 10 * 60 * 1000

export const stopsDir = (home = process.env.HOME ?? '') => join(home, '.claude', 'better', 'cursor-stops')

const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** A folder the helper may treat as a workspace: not /, not the home folder and not a folder that holds it. */
export function isWorkspaceRoot(root: string, home = process.env.HOME ?? ''): boolean {
  return !!root && !isInside(real(home), [real(root)])
}

/** Records that the user stopped a turn in these workspace folders. */
export function recordStop(roots: unknown, dir = stopsDir(), now = Date.now(), home = process.env.HOME ?? ''): void {
  const list = Array.isArray(roots) ? roots.filter((r): r is string => typeof r === 'string' && r.length > 0).map(real).filter((r) => isWorkspaceRoot(r, home)) : []
  if (!list.length) return
  mkdirSync(dir, { recursive: true })
  stoppedSince('', now, dir, now) // drops old markers
  writeFileSync(join(dir, `${now}-${process.pid}.json`), JSON.stringify({ at: now, roots: list }))
}

/**
 * Runs `work` once per key across processes: Cursor runs each installed copy of the plugin's hooks (a Claude Code
 * install it imports plus a clone, say), so two hooks can see the same call. The first runs it; the others wait for
 * its answer. A holder that died is taken over.
 */
export async function runOnce(key: string, work: () => Promise<string>, dir = join(stopsDir(), '..', 'cursor-once'), waitMs = 21 * 60 * 1000, onError = (e: Error) => { throw e }): Promise<string> {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const lock = join(dir, `${key}.lock`)
  const out = join(dir, `${key}.out`)
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    try {
      if (Date.now() - statSync(file).mtimeMs > 60 * 60 * 1000) unlinkSync(file)
    } catch {}
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const end = Date.now() + waitMs
  while (Date.now() < end) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
    } catch {
      try {
        return readFileSync(out, 'utf8')
      } catch {}
      try {
        if (!alive(Number(readFileSync(lock, 'utf8')))) unlinkSync(lock)
      } catch {} // the lock went away meanwhile: try again
      await new Promise((r) => setTimeout(r, 300))
      continue
    }
    // Whatever the holder ends with, success or a failure answer, is written for the other copy, so both agree.
    let text: string
    try {
      text = await work()
    } catch (e) {
      text = await Promise.resolve().then(() => onError(e as Error) as unknown as string)
    }
    // Written whole, then renamed, so a waiter never reads half an answer; 0600 like the run records.
    const tmp = `${out}.${process.pid}.tmp`
    writeFileSync(tmp, text, { mode: 0o600 })
    renameSync(tmp, out)
    return text
  }
  throw new Error('another copy of the hook never finished the check')
}

/** Whether a stop in a workspace holding `cwd` was recorded at or after `since`. Drops markers older than ten minutes. */
export function stoppedSince(cwd: string, since: number, dir = stopsDir(), now = Date.now()): boolean {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return false
  }
  let hit = false
  for (const name of names) {
    const file = join(dir, name)
    try {
      const { at, roots } = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof at !== 'number' || now - at > KEEP_MS) {
        unlinkSync(file)
        continue
      }
      if (at >= since && Array.isArray(roots) && isInside(cwd, roots)) hit = true
    } catch {}
  }
  return hit
}
