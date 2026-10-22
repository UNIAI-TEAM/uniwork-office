import { act } from 'react'

/**
 * UNI-2113: the Documents home Type control is one trigger with a menu of checkable types. These
 * helpers drive it the way a person does (open the menu, press an item) for the screens' tests.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

export const typeTrigger = (host: ParentNode): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('.dh-filter-bar button[data-filter="type"]')

export const typeMenu = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('.dh-filter-bar [role="menu"]')

export const typeItem = (host: ParentNode, key: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(
    `.dh-filter-bar [role="menuitemcheckbox"][data-type="${key}"]`,
  )

/** the type chips under the bar (one per pick, menu order) */
export const typeChips = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll('.dh-filter-bar .dh-filter-chips [data-chip]')).map(
    (el) => el.getAttribute('data-chip') ?? '',
  )

/** press one item of the Type menu (opens the menu first when it is closed); `all` clears */
export async function pickType(host: ParentNode, key: string): Promise<void> {
  if (!typeMenu(host)) {
    await act(async () => {
      typeTrigger(host)!.click()
    })
    await settle()
  }
  const el = typeItem(host, key)
  if (!el) throw new Error(`no Type menu item "${key}"`)
  await act(async () => {
    el.click()
  })
  await settle()
}
