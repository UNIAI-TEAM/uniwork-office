import type { AskUniV2Bridge } from '../../../shared/askuni-api'

/** the v2 methods on window.aiOffice; a method a preload lacks is undefined (callers treat it as a failure) */
export function frameBridge(): Partial<AskUniV2Bridge> {
  return window.aiOffice as unknown as Partial<AskUniV2Bridge>
}

/** case- and accent-insensitive form of a title, for the client-side filter of lookup answers */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}
