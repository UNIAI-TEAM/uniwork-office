/**
 * Saved signatures on the web, v1 = browser-local (GO-B4 / UNI-1014, capability `savedSignatures`).
 *
 * The desktop keeps the list in userData/pdf-signatures.json (main/signature-store.ts); the frame
 * keeps the same list (same validation, cap and dedupe: shared/signature-list.ts) in localStorage
 * under one namespaced key. The frame is same-origin with the UniWork app, so any script on that
 * origin can read it (risk R6, docs/web-modules/pdf.md); a host user-preferences store is the
 * later replacement. Storage that throws (private mode, blocked site data) degrades to an
 * in-memory list for this page load.
 */
import type { SavedSignature, SignatureData } from '../../../apps/pdf/src/shared/ipc'
import {
  addSignature,
  isSignatureData,
  removeSignature,
  sanitizeSignatures,
} from '../../../apps/pdf/src/shared/signature-list'

export const SIGNATURES_KEY = 'uniwork.office.pdf.savedSignatures'

export function createSignatureStore(storage: () => Storage | null = () => window.localStorage) {
  let memory: SavedSignature[] | null = null

  function read(): SavedSignature[] {
    if (memory) return memory
    try {
      const raw = storage()?.getItem(SIGNATURES_KEY)
      return raw ? sanitizeSignatures(JSON.parse(raw)) : []
    } catch {
      return []
    }
  }

  function write(list: SavedSignature[]): SavedSignature[] {
    try {
      const s = storage()
      if (!s) throw new Error('no storage')
      s.setItem(SIGNATURES_KEY, JSON.stringify(list))
      memory = null
    } catch {
      memory = list
    }
    return list
  }

  return {
    async list(): Promise<SavedSignature[]> {
      return read()
    },
    async add(data: SignatureData): Promise<SavedSignature[]> {
      const list = read()
      return isSignatureData(data) ? write(addSignature(list, data)) : list
    },
    async remove(id: string): Promise<SavedSignature[]> {
      const list = read()
      if (typeof id !== 'string') return list
      const next = removeSignature(list, id)
      return next.length === list.length ? list : write(next)
    },
  }
}
