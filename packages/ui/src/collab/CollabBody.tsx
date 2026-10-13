import type { ReactNode } from 'react'
import { parseBody, type BodyToken } from './body'
import type { CollabMention } from './types'

export interface CollabBodyProps {
  body: string
  /** the `mentions` table of the list answer: the chip shows the CURRENT name by user id */
  mentions?: readonly CollabMention[]
  className?: string
}

function renderTokens(
  tokens: readonly BodyToken[],
  names: ReadonlyMap<string, string>,
): ReactNode[] {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'text':
        return t.raw
      case 'break':
        return <br key={i} />
      case 'bold':
        return <strong key={i}>{renderTokens(t.children, names)}</strong>
      case 'italic':
        return <em key={i}>{renderTokens(t.children, names)}</em>
      case 'code':
        return (
          <code key={i} className="collab-body-code">
            {t.text}
          </code>
        )
      case 'link':
        return (
          <a
            key={i}
            className="collab-body-link"
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.text}
          </a>
        )
      case 'mention': {
        const name = names.get(t.userId)
        // unavailable or unknown id: the token label, plain text styling, nothing to follow
        if (name === undefined) {
          return (
            <span key={i} className="collab-mention-unavailable">
              @{t.label}
            </span>
          )
        }
        return (
          <span key={i} className="collab-mention" data-user-id={t.userId}>
            @{name || t.label}
          </span>
        )
      }
      default:
        return null
    }
  })
}

/** Renders a comment body (contract-collab §3). Only text nodes and the fixed elements above are emitted: no raw HTML. */
export function CollabBody({ body, mentions, className }: CollabBodyProps) {
  const names = new Map<string, string>()
  for (const m of mentions ?? []) {
    if (m.state === 'ok') names.set(m.user_id.toUpperCase(), m.display_name ?? '')
  }

  const paragraphs: BodyToken[][] = [[]]
  for (const t of parseBody(body)) {
    if (t.type === 'paragraph') paragraphs.push([])
    else paragraphs[paragraphs.length - 1].push(t)
  }

  return (
    <div className={className ? `collab-body ${className}` : 'collab-body'} dir="auto">
      {paragraphs
        .filter((p) => p.some((t) => t.type !== 'text' || t.raw.trim() !== ''))
        .map((p, i) => (
          <p key={i} className="collab-body-p">
            {renderTokens(p, names)}
          </p>
        ))}
    </div>
  )
}
