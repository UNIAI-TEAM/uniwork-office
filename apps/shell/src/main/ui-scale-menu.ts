import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuLabels } from '@genoffice/electron-utils'
import { LANGS } from '@genoffice/i18n'

import type { TabKind } from '../shared/tabs-api'
import { changeUiScale } from './ui-scale'

/**
 * Every View menu label produced by `appMenuLabels(lang)` across supported
 * locales. Editor menus (e.g. Sheets) build their View menu from
 * `appMenuLabels`, whose `view` translation differs from the shell's own
 * `menuView` in it/nl/pt/vi/hi (e.g. vi `'Xem'` vs `'Hiển thị'`).
 */
const APP_MENU_VIEW_LABELS: ReadonlySet<string> = new Set(
  LANGS.map((lang) => appMenuLabels(lang).view),
)

/**
 * Tab kinds whose chrome follows the interface scale: the Home frame and the Sheets chrome opt in
 * to `zoom: var(--ui-scale)`. The Docs, Slides, PDF, Markdown and HTML chrome follows in upstream's
 * part 2, so until it is ported their View menu offers no scale items (and no Ctrl+Alt+= / - / 0
 * accelerators): a control that only grows the tab strip while the ribbon stays put is a
 * half-shipped feature. The stored setting is kept either way.
 */
export function chromeFollowsUiScale(kind: TabKind): boolean {
  return kind === 'home' || kind === 'sheets'
}

/**
 * The View › interface-scale items. CmdOrCtrl+Alt (not Shift): Shift+= is Sheets insert-cells and
 * Docs superscript.
 */
export function uiScaleMenuItems(
  label: (key: 'menuUiZoomIn' | 'menuUiZoomOut' | 'menuUiZoomReset') => string,
  settingsPath: () => string,
): MenuItemConstructorOptions[] {
  return [
    {
      label: label('menuUiZoomIn'),
      accelerator: 'CmdOrCtrl+Alt+=',
      click: () => changeUiScale(settingsPath(), 1),
    },
    {
      label: label('menuUiZoomOut'),
      accelerator: 'CmdOrCtrl+Alt+-',
      click: () => changeUiScale(settingsPath(), -1),
    },
    { type: 'separator' },
    {
      label: label('menuUiZoomReset'),
      accelerator: 'CmdOrCtrl+Alt+0',
      click: () => changeUiScale(settingsPath(), 0),
    },
  ]
}

/**
 * Interface-scale items in the View menu of the tab kinds whose chrome follows the scale. Editor
 * menus are built in the editor apps or by the shell-owned builders, so the current application
 * menu is post-processed here: an existing View menu gains the items after a separator, otherwise
 * a fresh View menu is inserted before the Help menu every builder carries.
 */
export function withViewMenu(
  kind: TabKind,
  label: (key: 'menuView' | 'menuUiZoomIn' | 'menuUiZoomOut' | 'menuUiZoomReset') => string,
  settingsPath: () => string,
): void {
  if (!chromeFollowsUiScale(kind)) return
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const hasScale = menu.items.some((item) =>
    item.submenu?.items.some((i) => i.accelerator === 'CmdOrCtrl+Alt+='),
  )
  if (hasScale) return
  const items = uiScaleMenuItems(label, settingsPath)
  const view = menu.items.find(
    (item) =>
      item.label === label('menuView') ||
      (item.label !== undefined && APP_MENU_VIEW_LABELS.has(item.label)) ||
      item.submenu?.items.some((i) => i.role === 'togglefullscreen'),
  )
  if (view?.submenu) {
    // build the separator together with the items: Electron drops a separator that sits alone in a template
    for (const item of Menu.buildFromTemplate([{ type: 'separator' }, ...items]).items) {
      view.submenu.append(item)
    }
    return
  }
  const viewItem = Menu.buildFromTemplate([{ label: label('menuView'), submenu: items }]).items[0]!
  const helpIdx = menu.items.findIndex((item) => item.role === 'help')
  if (helpIdx === -1) menu.append(viewItem)
  else menu.insert(helpIdx, viewItem)
}
