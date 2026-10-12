/**
 * Build-time deployment defaults: which channel this build is and, when the
 * release env names one, the UniWork server it connects to before the user or
 * a web link chooses another. electron-builder.cjs writes the result to
 * resources/deployment-defaults.json (read by uniwork-auth/deployment.ts), and
 * the release workflow runs the same validation before it builds anything.
 *
 *   UNIWORK_DEFAULT_API_ORIGIN      bare origin, https (http loopback on dev)
 *   UNIWORK_DEFAULT_DEPLOYMENT_ID   the server's deployment id
 *
 * Both empty = no default (the app asks for a server). One without the other,
 * or an invalid value, fails the build.
 */

const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function bakedDeploymentDefaults(env, channel) {
  const origin = (env.UNIWORK_DEFAULT_API_ORIGIN || '').trim()
  const id = (env.UNIWORK_DEFAULT_DEPLOYMENT_ID || '').trim()
  if (!origin && !id) return { channel }
  if (!origin || !id) {
    throw new Error(
      'UNIWORK_DEFAULT_API_ORIGIN and UNIWORK_DEFAULT_DEPLOYMENT_ID must be set together or both left empty',
    )
  }
  if (!DEPLOYMENT_ID.test(id)) {
    throw new Error('UNIWORK_DEFAULT_DEPLOYMENT_ID is not a valid deployment id')
  }
  let url
  try {
    url = new URL(origin)
  } catch {
    throw new Error('UNIWORK_DEFAULT_API_ORIGIN is not a valid URL')
  }
  const secure = url.protocol === 'https:'
  const devLoopback = channel === 'dev' && url.protocol === 'http:' && LOOPBACK.has(url.hostname)
  if (!secure && !devLoopback) {
    throw new Error('UNIWORK_DEFAULT_API_ORIGIN must be https (http only for localhost on dev)')
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new Error('UNIWORK_DEFAULT_API_ORIGIN must be a bare origin: no path, query or credentials')
  }
  return { channel, defaultProfile: { deploymentId: id, apiOrigin: url.origin } }
}

module.exports = { bakedDeploymentDefaults }

// `node deployment-defaults.cjs <channel>`: the workflow's fail-fast check
if (require.main === module) {
  const channel = process.argv[2] || 'stable'
  bakedDeploymentDefaults(process.env, channel)
  console.log(`deployment defaults ok (channel ${channel})`)
}
