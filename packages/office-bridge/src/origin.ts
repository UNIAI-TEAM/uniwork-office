/**
 * UniWork Office may call HTTPS origins, or loopback HTTP for local tests.
 * Never accept service-role keys, database URLs, or file:// origins.
 */
export function assertSafeApiOrigin(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('invalid_api_origin')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('invalid_api_origin')
  }
  const host = url.hostname.toLowerCase()
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  if (url.protocol === 'https:') {
    return `${url.origin}`
  }
  if (url.protocol === 'http:' && loopback) {
    return `${url.origin}`
  }
  throw new Error('api_origin_must_be_https')
}
