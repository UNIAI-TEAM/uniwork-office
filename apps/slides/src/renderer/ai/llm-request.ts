import type { AiSettings, AiStreamRequest } from '../../shared/ipc'

/**
 * The request behind the panel's own generators (per-page, style skill, planning). They are not
 * conversation turns, so they carry `purpose: 'one-shot'`: UniWork AI refuses such a request
 * instead of sending the generator's user text to the server as a question.
 */
export function oneShotStreamRequest(args: {
  requestId: string
  settings: AiSettings
  system: string
  user: string
  maxTokens?: number | undefined
}): AiStreamRequest {
  return {
    requestId: args.requestId,
    settings: args.settings,
    system: args.system,
    messages: [{ role: 'user', text: args.user }],
    purpose: 'one-shot',
    ...(args.maxTokens ? { maxTokens: args.maxTokens } : {}),
  }
}
