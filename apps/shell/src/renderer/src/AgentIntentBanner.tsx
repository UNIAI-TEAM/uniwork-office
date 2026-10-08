import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { type AgentIntent, type PracticeId } from '@uniwork/practice-core'
import { applyAgentIntent } from './agent-intent-apply'
import { emitAgentIntentNavigate } from './agent-intent-bus'
import { buildContextPack } from './context-manager'
import { useI18n } from './locale'

interface Props {
  practiceId: PracticeId
  /** Enter workbench mode if user is on Recents/Cloud. */
  ensureWorkbench: () => void
}

export function AgentIntentBanner({ practiceId, ensureWorkbench }: Props): ReactElement | null {
  const { lang } = useI18n()
  const vi = lang === 'vi'
  const L = (a: string, b: string) => (vi ? a : b)

  const [pending, setPending] = useState<AgentIntent | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const off = window.aiOffice.onAgentIntent?.((intent) => {
      setNotice(null)
      if (intent.requireConsent) {
        setPending(intent)
      } else {
        runApply(intent)
      }
    })
    return off
  }, [practiceId])

  const pack = useMemo(
    () => (pending ? buildContextPack(pending, practiceId, vi) : null),
    [pending, practiceId, vi],
  )

  const runApply = (intent: AgentIntent) => {
    // Switch into Workbench first; navigate bus keeps the tab switch if home mounts late.
    ensureWorkbench()
    const result = applyAgentIntent(intent, practiceId)
    emitAgentIntentNavigate(result.tabId, intent)
    setPending(null)
    setNotice(vi ? result.messageVi : result.messageEn)
    void window.aiOffice.agentIntentAck?.(intent.intentId, result.ok ? 'applied' : 'failed')
  }

  const dismiss = () => {
    if (pending) {
      void window.aiOffice.agentIntentAck?.(pending.intentId, 'dismissed')
    }
    setPending(null)
  }

  if (!pending && !notice) return null

  if (notice && !pending) {
    return (
      <div className="agent-intent-banner is-done" role="status">
        <p>{notice}</p>
        <button type="button" className="btn btn-secondary" onClick={() => setNotice(null)}>
          {L('Đóng', 'Dismiss')}
        </button>
      </div>
    )
  }

  if (!pending || !pack) return null

  return (
    <div className="agent-intent-banner" role="dialog" aria-label={L('Xác nhận lệnh AI', 'Confirm AI intent')}>
      <div className="agent-intent-main">
        <p className="agent-intent-kicker">
          {L('Lệnh từ', 'Intent from')} {pending.source.toUpperCase()}
        </p>
        <h3>
          {pack.actionLabel} → {pack.targetLabel}
        </h3>
        <p className="teacher-hint">{pending.summary}</p>
        {pending.text ? <p className="agent-intent-text">{pending.text}</p> : null}
        <details className="agent-intent-pack">
          <summary>
            {L('Context máy', 'On-device context')} ({pack.charCount} {L('ký tự', 'chars')})
          </summary>
          <ul>
            {pack.chunks.map((c) => (
              <li key={c.id}>
                <strong>{c.source}</strong>: {c.text}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="agent-intent-actions">
        <button type="button" className="btn btn-secondary" onClick={dismiss}>
          {L('Từ chối', 'Reject')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => runApply(pending)}>
          {L('Cho phép trên máy', 'Allow on device')}
        </button>
      </div>
    </div>
  )
}
