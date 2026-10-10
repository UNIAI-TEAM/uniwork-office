import type { ReactElement } from 'react'

/**
 * "Use the app" message of the web frame (A7 / B): a feature the web build does not have is shown
 * with what it is and the one-line hint to open the document in the UniWork Office app, plus the
 * Open-in-app action when the host granted `desktopOpen` (`onOpen` is undefined otherwise).
 * `lead` is the feature sentence, `hint` the shared localised message.
 */
export function AppOnlyNote({
  lead,
  hint,
  openLabel,
  onOpen,
  testId,
}: {
  lead: string
  hint: string
  openLabel: string
  onOpen?: () => void
  testId: string
}): ReactElement {
  return (
    <div className="pdf-app-only" data-testid={testId}>
      <p className="pdf-app-only-lead">{lead}</p>
      <p className="pdf-app-only-hint">{hint}</p>
      {onOpen && (
        <button type="button" className="pdf-modal-btn primary" onClick={onOpen}>
          {openLabel}
        </button>
      )}
    </div>
  )
}
