/**
 * UNI-2033: "view the version an anchor was kept in" on the web frame. The editors call
 * `window.uniworkComments.openVersion?.(...)` (frame-api.ts builds it from this file):
 *
 * - `createFrameViewVersion` sends `comments.viewVersion` and answers `{opened}`. It exists only
 *   with the EFFECTIVE `commentsViewVersion` capability (frame claim AND host grant, and
 *   `comments`), so the editors show no action everywhere else (an old host, or inside a version
 *   view, where the host never grants it). A failed request answers `{opened: false}`: the editor
 *   then shows its own "unavailable" line instead of a protocol error.
 * - `frameOpenVersionId` is the `FileMeta.versionId` the host gave in `api.open` (or the one a
 *   landed save made current), so the editors can tell the open version from the one an anchor
 *   was kept in; `context()` reports it.
 */
import type { FramePort, PortSession } from '../../../docs/bridge/frame-port'
import type { FrameDocVersion } from './doc-version'

export interface FrameViewVersionRequest {
  commentId: string
  versionNo: number
}

export interface FrameViewVersionResult {
  opened: boolean
}

/** true only with the effective `commentsViewVersion` capability (and `comments`) */
export function frameViewVersionAccess(session: Pick<PortSession, 'capabilities'>): boolean {
  const caps = session.capabilities
  return caps?.comments === true && caps.commentsViewVersion === true
}

export function createFrameViewVersion(
  port: Pick<FramePort, 'request'>,
  session: Pick<PortSession, 'capabilities'>,
): ((req: FrameViewVersionRequest) => Promise<FrameViewVersionResult>) | undefined {
  if (!frameViewVersionAccess(session)) return undefined
  return async ({ commentId, versionNo }) => {
    try {
      const { opened } = await port.request('comments.viewVersion', {
        comment_id: commentId,
        version_no: versionNo,
      })
      return { opened }
    } catch {
      return { opened: false }
    }
  }
}

export function frameOpenVersionId(
  version: FrameDocVersion,
  session: Pick<PortSession, 'open'>,
): string | undefined {
  return version.current().versionId ?? session.open?.file.versionId ?? undefined
}
