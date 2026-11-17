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
  isViewed?: boolean
}

export type BetterDraft = { text: string; isEditing: boolean; isEdited?: boolean; isHidden?: boolean; path?: string; log?: string }

export type BetterWaiting = { improved: string; path?: string; log?: string }

declare module 'claude-code' {
  interface PluginState {
    better: {
      run: BetterRun | null
      briefs: number
      boomerang: BetterBoomerang | null
      tick: number
      forks: string[]
      waiting: BetterWaiting | null
      draft: BetterDraft | null
    }
  }
}
