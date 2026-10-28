/** Web targets a link annotation may carry: http(s) and mailto only, so a saved
    file never holds a javascript:/file: URI for another viewer to follow. A bare
    "www." address gets https. Returns null for anything else. */
export function normalizeLinkUrl(raw: string): string | null {
  const url = raw.trim()
  if (/^www\./i.test(url)) return `https://${url}`
  return /^(https?:|mailto:)\S/i.test(url) ? url : null
}
