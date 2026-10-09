/**
 * The engine this lane ships (UNI-1016): every operation answers a typed `engine-unavailable`.
 * The renderer reads `capabilities.xlsxEngine === false` (set from `kind`) and shows the styled
 * "cannot be opened on the web yet" screen instead of booting the grid; a renderer that gets
 * here anyway (e.g. an old bundle) sees the same error code and shows the same screen.
 * The WASM backend (C11, follow-up SH2) replaces this object; nothing else changes.
 */
import { EngineUnavailableError, NO_ENGINE_FEATURES, type SheetsEngineTransport } from './transport'

export function createUnavailableTransport(): SheetsEngineTransport {
  const fail = (operation: string) => () => Promise.reject(new EngineUnavailableError(operation))
  return {
    kind: 'unavailable',
    features: NO_ENGINE_FEATURES,
    open: fail('open'),
    readRange: fail('read_range'),
    readFormulaCells: fail('read_formula_cells'),
    readMedia: fail('read_media'),
    readPivotDefinition: fail('read_pivot_definition'),
    recalc: fail('recalc_cells'),
    serialize: fail('save'),
    replaceSession: fail('open'),
    // closing a session that never opened is a no-op, as on the desktop
    close: () => Promise.resolve(),
  }
}
