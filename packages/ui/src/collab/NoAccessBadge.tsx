/** G8-18: the lock + "Can't view" badge shared by the mention picker rows and the composer chips */
export function NoAccessBadge({ label }: { label: string }) {
  return (
    <span className="collab-mention-no-access" data-no-access="true">
      <svg
        className="collab-mention-lock"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path
          d="M3.5 5V3.8a2.5 2.5 0 0 1 5 0V5M2.5 5h7v5.5h-7V5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
      <span className="collab-mention-no-access-text">{label}</span>
    </span>
  )
}
