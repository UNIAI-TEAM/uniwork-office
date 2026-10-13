import { useId } from 'react'

/**
 * The UniAI mark ("helper"): the u of uni holding the dot of the i in AI, a figure reaching out
 * to help. Sibling of the UniWork Office logo: same blue-cyan gradient, round head, soft body.
 *
 * - `tile`: white glyph on the brand gradient squircle (avatars, panel titles, AI entry points).
 *   Brand artwork, so its colors are fixed in both themes like the file-type badges.
 * - `glyph`: one-color glyph in `currentColor` for tinted or inline spots (pills, feature icons).
 *
 * Without `size` the SVG fills its box, for containers that size their own logo.
 */
export function UniAiMark({
  variant = 'tile',
  size,
  className,
  title,
}: {
  variant?: 'tile' | 'glyph'
  size?: number
  className?: string
  /** accessible name; omitted, the mark is decorative (the label sits next to it) */
  title?: string
}) {
  // per-instance gradient id: a shared id breaks once its first owner is display:none
  const gradientId = `uniai-mark-${useId().replace(/:/g, '')}`
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const }

  if (variant === 'glyph') {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        {...a11y}
      >
        <circle cx="12" cy="5.6" r="2.6" fill="currentColor" />
        <path
          d="M5.4 10V12.4a6.6 6.6 0 0 0 13.2 0V10"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" {...a11y}>
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="24"
          x2="24"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#0A4FE0" />
          <stop offset="1" stopColor="#05D8F2" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7" fill={`url(#${gradientId})`} />
      <circle cx="12" cy="7.4" r="2.5" fill="#fff" />
      <path
        d="M6.6 10.6V12.9a5.4 5.4 0 0 0 10.8 0V10.6"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
