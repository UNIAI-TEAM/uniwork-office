import type { SourceViewResult, SourceViewState, OpenSourceValue } from '../../shared/source-view'
import type { UniworkModuleSeam } from './modules'

// RED STUB (UNI-1993): compile-only shapes so the tests fail on behaviour, not on imports.

export class SourceViewRegistry {
  add(_path: string, _meta: SourceViewState): void {
    throw new Error('not implemented')
  }
  has(_path: string): boolean {
    return false
  }
  meta(_path: string): SourceViewState | null {
    return null
  }
  remove(_path: string): boolean {
    return false
  }
  paths(): string[] {
    return []
  }
}

export interface SourceViewSeamOptions {
  onSourceSave?(path: string): void
}

export function withSourceViews(
  seam: UniworkModuleSeam,
  _registry: SourceViewRegistry,
  _options: SourceViewSeamOptions = {},
): UniworkModuleSeam {
  return seam
}

export interface SourceViewFs {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  rm(path: string, options: { recursive: true; force: true }): Promise<void>
  rmSync(path: string, options: { recursive: true; force: true }): void
}

export interface SourceViewOpenerDeps {
  previewRoot: string
  startupSweep: Promise<unknown>
  registry: SourceViewRegistry
  identity(): { deploymentId: string } | null
  profile(): { deploymentId: string } | null
  storeLocked(): boolean
  documentMaxBytes(): number
  downloadSource(workspaceId: string, sourceId: string): Promise<{ bytes: Uint8Array }>
  openPath(path: string): boolean | Promise<boolean>
  isPathOpen(path: string): boolean
  now?(): number
  newSession?(): string
  fs?: Partial<SourceViewFs>
}

export interface SourceViewOpener {
  openSource(input: unknown): Promise<SourceViewResult<OpenSourceValue>>
  sweep(): Promise<void>
  dropAll(closePath?: (path: string) => void | Promise<void>): Promise<void>
  disposeSync(): void
}

export const SOURCE_VIEW_CLOSE_GRACE_MS = 30_000

export function createSourceViewOpener(_deps: SourceViewOpenerDeps): SourceViewOpener {
  return {
    openSource: async () => {
      throw new Error('not implemented')
    },
    sweep: async () => undefined,
    dropAll: async () => undefined,
    disposeSync: () => undefined,
  }
}
