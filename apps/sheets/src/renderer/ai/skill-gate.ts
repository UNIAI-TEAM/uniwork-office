import type { AgentSkill } from '@genoffice/agent-core'

/**
 * A skill that is only offered while `enabled()` is true (a web capability, see
 * ../capabilities.ts): off, it contributes no tools and no prompt text, so the model never learns
 * of a tool the frame cannot run. Live like composeSkills' own getters: the loop re-reads tools
 * and systemPrompt before every request, so a capability the host or the server switches later
 * (the cloud tool switches land after the first paint) takes effect on the next turn.
 */
export function gateSkill(skill: AgentSkill, enabled: () => boolean): AgentSkill {
  const { buildContext } = skill
  return {
    ...skill,
    get systemPrompt() {
      return enabled() ? skill.systemPrompt : ''
    },
    get tools() {
      return enabled() ? skill.tools : []
    },
    ...(buildContext ? { buildContext: () => (enabled() ? buildContext() : '') } : {}),
  }
}
