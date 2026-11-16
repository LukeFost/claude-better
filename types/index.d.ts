export type BetterToolRow = { id: string; label: string; state: 'running' | 'ok' | 'failed' }

export type BetterRun = {
  id: string
  startedAt: number
  stage: number
  label: string
  tools: BetterToolRow[]
}

export type BetterBoomerang = {
  agentId: string
  startedAt: number
  status: 'running' | 'ready'
  improved?: string
  /** false when the main view couldn't show the fork (the desktop app draws none), so Back has no view to leave */
  isViewed?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    better: {
      run: BetterRun | null
      briefs: number
      boomerang: BetterBoomerang | null
      tick: number
      /** every /better-boomerang fork started this session; each stays guarded for its whole life */
      forks: string[]
    }
  }
}
