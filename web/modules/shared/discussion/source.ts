/**
 * The collab kit's `CollabSource` over the frame protocol (contract-collab §10): `comments.*` with
 * `kind: 'discussion'` forced on list and create, `mentions.search` as is. Every rejection becomes
 * the kit's `CollabError` (`details.code` read before `code`, contract-collab §9), so the kit's
 * panel states (offline, server error, view-only, deleted target) follow the protocol codes.
 */
import { toCollabError, type CollabSource } from '@genoffice/ui/collab'
import {
  toProtocolError,
  type FrameRequestType,
  type FrameRequests,
} from '../../../docs/protocol/types'
import type { FramePort } from '../../../docs/bridge/frame-port'

export type DiscussionRequestPort = Pick<FramePort, 'request'>

export function createFrameDiscussionSource(port: DiscussionRequestPort): CollabSource {
  async function call<K extends FrameRequestType>(
    type: K,
    payload: FrameRequests[K]['payload'],
  ): Promise<FrameRequests[K]['result']> {
    try {
      return await port.request(type, payload)
    } catch (e) {
      throw toCollabError(toProtocolError(e))
    }
  }
  // the kit's DTOs are structural copies of the protocol ones (collab-protocol-shape.test.ts)
  return {
    list: ({ since_token }) =>
      call(
        'comments.list',
        since_token ? { kind: 'discussion', since_token } : { kind: 'discussion' },
      ),
    create: ({ parent_id, body }) =>
      call(
        'comments.create',
        parent_id ? { kind: 'discussion', body, parent_id } : { kind: 'discussion', body },
      ),
    update: (p) => call('comments.update', p),
    remove: (p) => call('comments.delete', p),
    resolve: (p) => call('comments.resolve', p),
    reopen: (p) => call('comments.reopen', p),
    revisions: (p) => call('comments.revisions', p),
    searchMentions: (p) => call('mentions.search', p),
  } as CollabSource
}
