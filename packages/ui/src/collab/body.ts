/**
 * Comment body grammar: the Markdown subset + mention token of contract-collab §3 / addendum §4.2.
 *
 * Paragraphs (blank line), line breaks, `**bold**`, `*italic*`, `` `code` ``, `[text](http(s)://…)` links
 * and the mention token `[@Label](mention://member/<ULID>)` (`\ [ ] ( )` escaped in the label). Everything
 * else is plain text, verbatim. Never HTML: the renderer only ever emits text nodes.
 *
 * Every token keeps its `raw` source, so `serialize(parseBody(s)) === s` for any string — a body that
 * goes web -> desktop -> web is never rewritten by a client that merely displayed it.
 */

export type BodyToken =
  | { type: 'text'; raw: string }
  /** one newline (with the spaces before it and any blank-looking tail): rendered as <br> */
  | { type: 'break'; raw: string }
  /** a blank line or more: starts a new paragraph */
  | { type: 'paragraph'; raw: string }
  | { type: 'bold'; raw: string; children: BodyToken[] }
  | { type: 'italic'; raw: string; children: BodyToken[] }
  | { type: 'code'; raw: string; text: string }
  | { type: 'link'; raw: string; text: string; href: string }
  /** `userId` is upper-cased (the server normalises ids); `label` is unescaped */
  | { type: 'mention'; raw: string; userId: string; label: string }

const MENTION = /\[@((?:[^[\]\\]|\\[\s\S])*)\]\(mention:\/\/member\/([0-9A-Za-z]{26})\)/y
const LINK = /\[([^[\]\n]+)\]\((https?:\/\/[^\s()]+)\)/y
const CODE = /`([^`\n]+)`(?!`)/y
const BOLD = /\*\*(?=[^\s*])((?:(?!\*\*)[^\n])*?)(?<=[^\s*])\*\*/y
const ITALIC = /\*(?=[^\s*])([^*\n]*?)(?<=[^\s*])\*/y
const BLANK_LINE = /[ \t]*\r?\n/y
const LABEL_ESCAPE = /[\\[\]()]/g

interface Allow {
  bold: boolean
  italic: boolean
}

function match(re: RegExp, src: string, at: number): RegExpExecArray | null {
  re.lastIndex = at
  return re.exec(src)
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''
  } catch {
    return false
  }
}

function scan(src: string, allow: Allow, block: boolean): BodyToken[] {
  const out: BodyToken[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ type: 'text', raw: text })
    text = ''
  }
  const push = (token: BodyToken) => {
    flush()
    out.push(token)
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]

    if (block && (ch === '\n' || (ch === '\r' && src[i + 1] === '\n'))) {
      // the spaces/tabs a hard break ("  \n") leaves in the buffer belong to the break, not to the text
      const trailing = /[ \t]*$/.exec(text)?.[0] ?? ''
      text = text.slice(0, text.length - trailing.length)
      let raw = trailing
      let newlines = 0
      let at = i
      for (let m = match(BLANK_LINE, src, at); m; m = match(BLANK_LINE, src, at)) {
        raw += m[0]
        newlines += 1
        at += m[0].length
      }
      push({ type: newlines > 1 ? 'paragraph' : 'break', raw })
      i = at
      continue
    }

    if (ch === '\\' && i + 1 < src.length && '\\*`[]()'.includes(src[i + 1])) {
      // an escape outside a mention label is not part of the subset: shown as typed, and it
      // stops the next character from starting markup
      text += ch + src[i + 1]
      i += 2
      continue
    }

    if (ch === '`') {
      let run = 1
      while (src[i + run] === '`') run++
      const m = run === 1 ? match(CODE, src, i) : null
      if (m) {
        push({ type: 'code', raw: m[0], text: m[1] })
        i += m[0].length
      } else {
        text += src.slice(i, i + run)
        i += run
      }
      continue
    }

    if (ch === '[') {
      const mention = match(MENTION, src, i)
      if (mention) {
        push({
          type: 'mention',
          raw: mention[0],
          userId: mention[2].toUpperCase(),
          label: mention[1].replace(/\\([\s\S])/g, '$1'),
        })
        i += mention[0].length
        continue
      }
      const link = src[i - 1] === '!' ? null : match(LINK, src, i)
      if (link && isHttpUrl(link[2])) {
        push({ type: 'link', raw: link[0], text: link[1], href: link[2] })
        i += link[0].length
        continue
      }
    }

    if (ch === '*') {
      const bold = allow.bold ? match(BOLD, src, i) : null
      if (bold) {
        push({
          type: 'bold',
          raw: bold[0],
          children: scan(bold[1], { bold: false, italic: allow.italic }, false),
        })
        i += bold[0].length
        continue
      }
      const italic = allow.italic ? match(ITALIC, src, i) : null
      if (italic) {
        push({
          type: 'italic',
          raw: italic[0],
          children: scan(italic[1], { bold: allow.bold, italic: false }, false),
        })
        i += italic[0].length
        continue
      }
    }

    text += ch
    i++
  }
  flush()
  return out
}

export function parseBody(body: string): BodyToken[] {
  return scan(body, { bold: true, italic: true }, true)
}

/** the exact source the tokens were parsed from */
export function serialize(tokens: readonly BodyToken[]): string {
  return tokens.map((t) => t.raw).join('')
}

/** `[@Label](mention://member/<id>)`: the only way a client writes a mention (picker pick, never a typed `@Name`) */
export function buildMentionToken(userId: string, label: string): string {
  const escaped = label.replace(/[\r\n]+/g, ' ').replace(LABEL_ESCAPE, (c) => '\\' + c)
  return `[@${escaped}](mention://member/${userId})`
}
