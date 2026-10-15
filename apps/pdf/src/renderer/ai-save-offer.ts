/** The text inserts that can name a blank PDF: only the fields the choice reads. */
interface NamingInsert {
  readonly input: {
    readonly pageIndex: number
    readonly origin: readonly [number, number] | readonly number[]
    readonly text: string
  }
}

/**
 * The file name the content suggests for a blank PDF: the first line of the topmost text on the
 * first page that has any ('' when nothing was inserted). The main process derives the same name
 * when the save runs, so the card and the file agree.
 */
export function nameCandidateFromInserts(inserts: readonly NamingInsert[]): string {
  const first = [...inserts].sort(
    (a, b) =>
      a.input.pageIndex - b.input.pageIndex || (b.input.origin[1] ?? 0) - (a.input.origin[1] ?? 0),
  )[0]
  return first?.input.text.split('\n')[0]?.trim() ?? ''
}

/**
 * Which documents the ask-before-saving card applies to after an AI run (G6-09 W8): only a
 * shell-created blank the user has not named, never a PDF the user merely opened or a view-only
 * one. Returns the name to offer ('' = none derivable), or null for no card.
 */
export async function aiRunSaveOffer(args: {
  readonly filePath: string | null | undefined
  readonly readOnly: boolean
  readonly isUntitled: (path: string) => Promise<boolean>
  readonly name: string
}): Promise<string | null> {
  if (!args.filePath || args.readOnly) return null
  try {
    if (!(await args.isUntitled(args.filePath))) return null
  } catch {
    return null
  }
  return args.name
}
