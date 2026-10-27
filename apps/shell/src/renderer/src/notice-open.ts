/**
 * What a notice says and what a click on it does, shared by the Desk tray and the Inbox pane (UNI-2079):
 * the tray used to carry this alone (UNI-2067); the target comes from the notice model.
 */
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { WorkNotification, WorkWebTarget } from '../../shared/uniwork-work-api'
import {
  documentChangedFacts,
  documentChangedHasPage,
  noticeState,
  opensDocumentList,
} from './desk-doc-change'
import type { TFunc } from './locale'
import { localizeNoticeParams, noticeSentence, noticeTarget } from './notices-model'
import { openDocumentShare, openFolderInDocuments, revealInTrash } from './documents-intent-bus'
import { publishUniworkNotice } from './uniwork-notice-bus'
import { openUniworkDocument } from './uniwork-open'

/** what a click on a notice does, decided from the notice (see openNotice) */
export interface NoteState {
  /** a several-document change: opens the list of its documents */
  list: boolean
  /** deleted or out of reach: say why in the launch notice instead of opening */
  notice: 'deleted' | 'forbidden' | null
  /** no page to open (deleted, trashed or out of reach): the click only marks it read */
  gone: boolean
  /** a count-1 change with no title: the reader may be unable to open it, so a failed open still clears it */
  untitled: boolean
}

export interface NoticeLine {
  /** the notice as a sentence, params in the reader's words */
  sentence: string
  /** the document's name for the open notice and the row's title ('' when none) */
  named: string
  /** "Plan, Budget and 3 more" under a several-document change; '' for any other notice */
  titles: string
  state: NoteState
  /** a change row: its sentence is its title */
  changed: boolean
}

export function noticeLine(n: WorkNotification, t: TFunc, dateLocale: string): NoticeLine {
  const changed = n.kind === 'document_changed'
  const facts = changed ? documentChangedFacts(n) : null
  const { key, params } = noticeSentence(n)
  const sentence = t(key, localizeNoticeParams(params, t, dateLocale))
  const list = opensDocumentList(n)
  // a several-document change always opens its list; any other notice says when its document is gone
  const verdict = list ? 'open' : noticeState(n)
  const state: NoteState = {
    list,
    notice: verdict === 'deleted' ? 'deleted' : verdict === 'no_access' ? 'forbidden' : null,
    gone: verdict !== 'open' || (changed && !documentChangedHasPage(n)),
    untitled: !!facts && facts.count === 1 && facts.titles.length === 0,
  }
  const named = facts ? (facts.titles[0] ?? '') : (n.params.document ?? '')
  const titles =
    facts && facts.count > 1 && facts.titles.length > 0
      ? [facts.titles.join(', '), facts.more > 0 ? t('wbDocChangeMore', { count: facts.more }) : '']
          .filter(Boolean)
          .join(' ')
      : ''
  return { sentence, named, titles, state, changed }
}

export interface NoticeEnv {
  /** the workspace the notice belongs to: its slugs address a web page (null for document notices only) */
  workspace: UniworkWorkspaceRef | null
  /** mark one notice read; a refusal is the caller's quiet business */
  markRead: (id: string) => Promise<void>
  /** a several-document change: show the list of its documents */
  openList: (id: string) => void
}

/**
 * Open a notice where it points and mark it read once it did. Nothing opens for a notice whose document
 * is gone or out of reach (the launch notice says why and the click clears it); a failed open keeps the
 * notice unread, unless nothing says the document is still reachable.
 */
export async function openNotice(
  n: WorkNotification,
  line: NoticeLine,
  env: NoticeEnv,
): Promise<void> {
  const { state, named } = line
  const target = noticeTarget(n)
  switch (target.to) {
    case 'changed': {
      if (state.list) {
        // the list reads the documents itself and marks the notice read once its first page is loaded
        env.openList(n.id)
        return
      }
      if (state.notice) {
        publishUniworkNotice({ phase: 'failed', error: state.notice })
        await env.markRead(n.id)
        return
      }
      if (state.gone) {
        await env.markRead(n.id)
        return
      }
      const opened = await openUniworkDocument(
        { documentId: n.resource_id, title: named },
        window.aiOffice,
      )
      if (opened || state.untitled) await env.markRead(n.id)
      return
    }
    case 'document': {
      // no `discussion` flag: the held reveal reaches both the editor comments panel and the shell Discussion panel
      const opened = await openUniworkDocument(
        { documentId: target.documentId, title: named, commentId: target.commentId },
        window.aiOffice,
      )
      if (opened) await env.markRead(n.id)
      return
    }
    case 'share':
      openDocumentShare({
        documentId: target.documentId,
        workspaceId: target.workspaceId,
        section: target.section,
      })
      await env.markRead(n.id)
      return
    case 'folder':
      openFolderInDocuments({ folderId: target.folderId, workspaceId: target.workspaceId })
      await env.markRead(n.id)
      return
    case 'trash':
      revealInTrash({ documentId: target.documentId, workspaceId: target.workspaceId })
      await env.markRead(n.id)
      return
    case 'web': {
      const ws = env.workspace
      if (!ws) return
      const web = { ...target.target, orgSlug: ws.orgSlug, wsSlug: ws.slug } as WorkWebTarget
      const opened = await window.uniworkWork.openWeb(web).catch(() => false)
      if (opened) await env.markRead(n.id)
      return
    }
    case 'none':
      // gone or out of reach: say why, then clear the reminder; a declined request has nothing to say
      if (state.notice) publishUniworkNotice({ phase: 'failed', error: state.notice })
      await env.markRead(n.id)
      return
  }
}
