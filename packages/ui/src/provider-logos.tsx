import { UniAiMark } from './UniAiMark'

// ── The AI provider mark of the composer model chip. UniWork AI is the one provider, and it
// carries the UniWork mark (brand art: its colors stay fixed in both themes).

/** Inline brand mark sized by the surrounding container (default `.gs-provider-logo`). */
export function ProviderLogo({ className = 'gs-provider-logo' }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <UniAiMark />
    </span>
  )
}
