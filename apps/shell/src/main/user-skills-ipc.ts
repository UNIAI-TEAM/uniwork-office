import { app, type IpcMain } from 'electron'
import { readSkillBody, usableSkills } from './imported-skills'

/**
 * The AI panel's door to the skills a user installed.
 *
 * - `ai:skills-list` and `ai:skill-text` hand out only what is installed in
 *   *our* folder (`<userData>/skills`). The coding agents' directories are not
 *   scanned, and recommended skills are not active until the user installs them.
 * - `ai:skill-text` takes a name, never a path: the caller cannot name a file,
 *   it can only pick an entry from the list this process vouched for.
 */

/** skill bodies travel over IPC and into the prompt; keep both bounded */
const MAX_SKILL_CHARS = 32_000

/** what the renderer's skills menu reads back from `ai:skills-list` */
export interface UserSkillEntry {
  name: string
  description: string
  relevant: boolean
}

function clip(text: string): string {
  return text.length > MAX_SKILL_CHARS
    ? `${text.slice(0, MAX_SKILL_CHARS)}…(+${text.length - MAX_SKILL_CHARS} chars)`
    : text
}

export function registerUserSkillsIpc(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle('ai:skills-list', async (): Promise<UserSkillEntry[]> => {
    const skills = await usableSkills(app.getPath('userData'))
    return skills.map(({ name, description, relevance }) => ({
      name,
      description,
      relevant: relevance.relevant,
    }))
  })

  ipc.handle('ai:skill-text', async (_e, name: unknown): Promise<string> => {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('a skill name is required')
    }
    const skills = await usableSkills(app.getPath('userData'))
    const skill = skills.find((s) => s.name === name)
    if (!skill) throw new Error(`no installed skill named "${name}"`)
    return clip(readSkillBody(skill.path))
  })
}
