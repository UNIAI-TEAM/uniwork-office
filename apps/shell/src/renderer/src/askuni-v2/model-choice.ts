import { useCallback, useEffect, useState } from 'react'
import { wbStoreRead, wbStoreWrite } from '../workbench-store-client'
import type {
  AskUniEffort,
  AskUniModel,
  AskUniModelOption,
  AskUniCapabilitiesResult,
} from '../../../shared/askuni-api'
import { frameBridge } from './frame-bridge'

/** per-account Workbench key (the `uniwork.ai.` prefix is on the store's allowlist) */
export const ASKUNI_MODEL_KEY = 'uniwork.ai.askuni-model'

/** '' = Auto for both fields, as on web */
export interface AskUniModelChoice {
  model: AskUniModel
  effort: AskUniEffort | ''
}

const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus']
const EFFORTS: readonly string[] = ['low', 'medium', 'high']

export function readModelChoice(): AskUniModelChoice {
  const raw = wbStoreRead<unknown>(ASKUNI_MODEL_KEY, null)
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    model: typeof o.model === 'string' && MODELS.includes(o.model) ? (o.model as AskUniModel) : '',
    effort:
      typeof o.effort === 'string' && EFFORTS.includes(o.effort) ? (o.effort as AskUniEffort) : '',
  }
}

export function writeModelChoice(choice: AskUniModelChoice): void {
  wbStoreWrite(ASKUNI_MODEL_KEY, choice)
}

/** a model the organization has switched off (or one no longer offered) reads as Auto */
export function effectiveModel(
  model: AskUniModel,
  enabled: readonly AskUniModelOption[],
): AskUniModel {
  return model !== '' && enabled.some((m) => m.key === model) ? model : ''
}

export interface AskUniModelSelection {
  /** the capabilities call: Auto stays usable while loading or after a failure */
  status: 'loading' | 'ready' | 'failed'
  enabled: AskUniModelOption[]
  /** the model key Auto resolves to; '' when unknown */
  autoModel: string
  /** the choice made safe for sending */
  model: AskUniModel
  effort: AskUniEffort | ''
  setModel: (model: AskUniModel) => void
  setEffort: (effort: AskUniEffort | '') => void
}

/** the asker's model and effort for one workspace: capabilities from the server, the pick from the account store */
export function useAskModelSelection(workspaceId: string): AskUniModelSelection {
  const [choice, setChoice] = useState<AskUniModelChoice>(readModelChoice)
  const [caps, setCaps] = useState<{
    status: 'loading' | 'ready' | 'failed'
    enabled: AskUniModelOption[]
    autoModel: string
  }>({ status: 'loading', enabled: [], autoModel: '' })

  useEffect(() => {
    let alive = true
    setCaps({ status: 'loading', enabled: [], autoModel: '' })
    const call = frameBridge().askUniCapabilities
    if (!call) {
      setCaps({ status: 'failed', enabled: [], autoModel: '' })
      return
    }
    call({ workspaceId }).then(
      (r: AskUniCapabilitiesResult) => {
        if (!alive) return
        setCaps(
          r.ok
            ? {
                status: 'ready',
                enabled: r.models.filter((m) => m.enabled),
                autoModel: r.autoModel,
              }
            : { status: 'failed', enabled: [], autoModel: '' },
        )
      },
      () => {
        if (alive) setCaps({ status: 'failed', enabled: [], autoModel: '' })
      },
    )
    return () => {
      alive = false
    }
  }, [workspaceId])

  const setModel = useCallback((model: AskUniModel) => {
    setChoice((c) => {
      const next = { ...c, model }
      writeModelChoice(next)
      return next
    })
  }, [])
  const setEffort = useCallback((effort: AskUniEffort | '') => {
    setChoice((c) => {
      const next = { ...c, effort }
      writeModelChoice(next)
      return next
    })
  }, [])

  return {
    ...caps,
    model: effectiveModel(choice.model, caps.enabled),
    effort: choice.effort,
    setModel,
    setEffort,
  }
}
