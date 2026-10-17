import { useCallback, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  OfflineFailure,
  OfflineResult,
  OfflineUnpinResult,
} from '../../shared/offline-library'
import { useI18n } from './locale'
import { OFFLINE_MENU_LABEL, offlineFailureCopy, offlineMenuOf } from './offline-library-model'
import { ActionToast } from './UniworkDocActions'
import { useOfflineLibrary } from './use-offline-library'
import { WbConfirm } from './WbConfirm'

export interface OfflineToggleDoc {
  documentId: string
  workspaceId: string
  name: string
}

/**
 * G5-05u F5: "Dùng khi không có mạng" / "Bỏ dùng khi không có mạng" in the
 * document menus (Home recents, Open dialog, In progress). The label follows
 * main's library (pinned -> unpin; the pin is hidden while the org turned the
 * capability off). An unpin main answers `needs_confirm` asks first
 * (`uwOfflineUnpinConfirm`); a refused pin (cap reached) is a toast and pins
 * nothing. `node` renders the confirm and the toast.
 */
export function useOfflineToggle(api = window.uniworkSyncCenter): {
  menuOf: (documentId: string) => 'pin' | 'unpin' | null
  labelOf: (documentId: string) => string | null
  toggle: (doc: OfflineToggleDoc) => void
  node: ReactElement
} {
  const { t, dateLocale } = useI18n()
  const offline = useOfflineLibrary(api)
  const inFlight = useRef(new Set<string>())
  const [confirming, setConfirming] = useState<OfflineToggleDoc | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const clearMessage = useCallback(() => setMessage(null), [])

  const menuOf = (documentId: string) => offlineMenuOf(offline, documentId)

  const refused = (failure: OfflineFailure) => {
    const copy = offlineFailureCopy(failure, dateLocale)
    setMessage(t(copy.key, copy.params))
  }

  const unpin = async (doc: OfflineToggleDoc, confirmed: boolean) => {
    if (inFlight.current.has(doc.documentId)) return
    inFlight.current.add(doc.documentId)
    let result: OfflineUnpinResult
    try {
      result = (await api?.offlineUnpin(
        doc.documentId,
        confirmed ? { confirmed: true } : undefined,
      )) ?? { ok: false, code: 'unknown' }
    } catch {
      result = { ok: false, code: 'unknown' }
    } finally {
      inFlight.current.delete(doc.documentId)
    }
    if (result.ok) return
    if (result.code === 'needs_confirm' && !confirmed) setConfirming(doc)
    else refused(result)
  }

  const toggle = (doc: OfflineToggleDoc) => {
    if (inFlight.current.has(doc.documentId)) return
    setMessage(null)
    const kind = menuOf(doc.documentId)
    if (kind === 'unpin') {
      void unpin(doc, false)
      return
    }
    if (kind !== 'pin') return
    inFlight.current.add(doc.documentId)
    void Promise.resolve(
      api?.offlinePin({ documentId: doc.documentId, workspaceId: doc.workspaceId }),
    )
      .then((res): OfflineResult => res ?? { ok: false, code: 'unknown' })
      .catch((): OfflineResult => ({ ok: false, code: 'unknown' }))
      .then((result) => {
        inFlight.current.delete(doc.documentId)
        if (!result.ok) refused(result)
      })
  }

  const node = (
    <>
      {confirming && (
        <WbConfirm
          title={t('uwOfflineUnpin')}
          body={t('uwOfflineUnpinConfirm')}
          confirmLabel={t('uwOfflineUnpinShort')}
          cancelLabel={t('uwActBack')}
          tone="danger"
          onConfirm={() => {
            const doc = confirming
            setConfirming(null)
            void unpin(doc, true)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {message && <ActionToast message={message} onDone={clearMessage} />}
    </>
  )

  return {
    menuOf,
    labelOf: (documentId) => {
      const kind = menuOf(documentId)
      return kind ? t(OFFLINE_MENU_LABEL[kind]) : null
    },
    toggle,
    node,
  }
}
