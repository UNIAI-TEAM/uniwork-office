/** Where a binding lives: one table per module, plus the shell menus and the
 * keys every module shares (`common`). Collisions are only checked inside one
 * scope, so a module may reuse a `common` chord for its own action. */
export type ShortcutScope =
  'common' | 'shell' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'html' | 'markdown'

/** `win` is Windows and Linux (Ctrl/Alt); `mac` is macOS (Cmd/Option/Control). */
export type ShortcutPlatform = 'win' | 'mac'

/** Electron desktop app, or the module frame inside a browser (web build). */
export type ShortcutSurface = 'desktop' | 'web'

/**
 * A chord in canonical text form: modifiers in the order `Ctrl`, `Alt`,
 * `Shift`, `Cmd`, then one key, joined by `+`. On `mac`, `Ctrl` is the
 * Control key and `Alt` is Option; `Cmd` only exists on `mac`.
 *
 * Keys: `A`-`Z`, `0`-`9`, `F1`-`F24`, the named keys `Enter`, `Escape`, `Tab`,
 * `Space`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`,
 * `PageDown`, `Up`, `Down`, `Left`, `Right`, `ContextMenu`, the keypad keys
 * `NumpadAdd`, `NumpadSubtract`, `Numpad0`, and the punctuation keys by their
 * US-layout `KeyboardEvent.code` name: `Minus`, `Equal`, `BracketLeft`,
 * `BracketRight`, `Semicolon`, `Quote`, `Backquote`, `Comma`, `Period`,
 * `Slash`, `Backslash`. A chord may be a bare key (`Space`, `B`, `Period`):
 * slide-show, PDF navigation and dialog keys, kept apart by `context`.
 * Example: `Ctrl+Shift+S`, `Alt+Shift+Equal`, `Ctrl+Alt+Shift+Cmd+G`,
 * `Shift+F4`, `Ctrl+NumpadAdd`.
 */
export type Chord = string

/** One key set per platform; the first chord is the primary one (menus, hints). */
export interface PlatformChords {
  readonly win: readonly Chord[]
  readonly mac: readonly Chord[]
}

/**
 * How keys are compared (rule 9 of the UNI-2011 contract, as changed by lead
 * decision 3 of S-table fix2):
 * - `key`: letters and punctuation by `event.key`, so they follow the layout.
 *   Letters are case-insensitive (Caps Lock safe), Shift exact. Punctuation
 *   is compared by character: a chord names the US character of its key with
 *   its Shift (`Ctrl+Shift+Period` is Ctrl+">", `Ctrl+Shift+Equal` is
 *   Ctrl+"+"), and the event's Shift is not compared, since the layout decides
 *   whether that character needs Shift (German "/" is Shift+7). When
 *   `event.key` is not a printable ASCII character (dead key, Cyrillic,
 *   German "ü", a macOS Option glyph) the physical `event.code` is used
 *   instead, Shift exact. The keypad never stands in for a punctuation chord.
 *   Digits are compared by `event.code` (Shift changes their character) and
 *   win over a punctuation chord the same key types (French Ctrl+6 types
 *   "-"). Named keys by `event.key`, keypad keys by `event.code`.
 * - `code`: every key by its physical `event.code`, Shift exact.
 */
export type ShortcutMatch = 'key' | 'code'

export interface ShortcutGuard {
  /** Marker: the action owns a Ctrl+Alt chord on Windows, which AltGr also
   * produces. The matcher applies the AltGr check to every Windows Ctrl+Alt
   * chord whether or not this is set; table locks require it on such rows. */
  readonly altGraph?: boolean
  /** Auto-repeated keydowns (`event.repeat`) do not fire the action. */
  readonly noRepeat?: boolean
}

/**
 * One row of a shortcut table: data only, serialisable. `id` is the row id in
 * the UNI-2011 `shortcuts.csv` inventory.
 */
export interface ShortcutAction {
  readonly id: string
  readonly scope: ShortcutScope
  /** A mode inside the scope with its own keymap (`slideshow`: PowerPoint
   * slide-show keys). Chords only collide within one scope and context;
   * `matchShortcut` matches a row only when its context is the one passed. */
  readonly context?: string
  /** Desktop chords (Microsoft desktop Office: Windows column, Mac column). */
  readonly win: readonly Chord[]
  readonly mac: readonly Chord[]
  /** Web chords (Microsoft 365 for the web, minus browser-reserved keys).
   * Absent: the web build uses the desktop chords. */
  readonly web?: PlatformChords
  /** Web-only alternative for a key the browser keeps (Ctrl+N, Ctrl+W...).
   * Shown next to the desktop key in web hints and matched on web only. */
  readonly webAlt?: Partial<Record<ShortcutPlatform, Chord>>
  readonly match: ShortcutMatch
  readonly guard: ShortcutGuard
}

/** A CSV row (or one platform of it) the generator could not turn into
 * chords: a key a module slice still has to add by hand (`manual`). */
export interface UnmappedShortcut {
  readonly id: string
  /** Which part is missing: the whole row, or one surface and platform of it. */
  readonly part: 'row' | `${ShortcutSurface}.${ShortcutPlatform}`
  readonly reason: string
}

/** A remark on a mapped row that is not a missing key (the browser keeps the
 * Microsoft key, a reserved chord was dropped, Microsoft prints no web key). */
export interface ShortcutNote {
  readonly id: string
  readonly part: 'web' | `web.${ShortcutPlatform}`
  readonly detail: string
}
