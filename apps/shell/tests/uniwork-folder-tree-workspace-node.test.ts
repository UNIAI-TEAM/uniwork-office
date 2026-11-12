/**
 * @vitest-environment jsdom
 *
 * UNI-2509, the web's F11 (document-tree.test.tsx "workspace folder node"): the Documents sidebar tree draws
 * a display-only node beside My Folder that wraps every other root. Its id never reaches a host callback
 * (the host would send it to the server), it opens no page, and its menu is the host's one entry.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { UniworkFolderNode } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { FolderMenuItem } from '../src/renderer/src/uniwork-folders/FolderMenu'
import { UniworkFolderTree } from '../src/renderer/src/uniwork-folders/UniworkFolderTree'
import {
  ROOT_KEY,
  WORKSPACE_NODE_ID,
  buildFolderIndex,
  drawnUnderWorkspaceNode,
  isWorkspaceNode,
  withWorkspaceNode,
} from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const node = (
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  parentId: string | null = null,
): UniworkFolderNode => ({ id, parentId, title, position: 0, children })

const MINE: UniworkFolderNode = {
  ...node('my', 'stored title never shown', [node('my-sub', 'Mine sub', [], 'my')]),
  systemKind: 'my_folder',
}
const FOREST = [
  node('plans', 'Plans', [node('plans-q4', 'Q4', [], 'plans')]),
  MINE,
  node('budgets', 'Budgets'),
]

describe('withWorkspaceNode / drawnUnderWorkspaceNode', () => {
  it('puts My Folder first, then one node holding every other root in order', () => {
    const drawn = withWorkspaceNode(
      [MINE, ...FOREST.filter((n) => n !== MINE)],
      'Thư mục của workspace',
    )
    expect(drawn.map((n) => n.id)).toEqual(['my', WORKSPACE_NODE_ID])
    expect(drawn[1]!.title).toBe('Thư mục của workspace')
    expect(drawn[1]!.parentId).toBeNull()
    expect(drawn[1]!.children.map((n) => n.id)).toEqual(['plans', 'budgets'])
  })

  it('still wraps the roots without My Folder, and stays when there are none', () => {
    expect(withWorkspaceNode([node('a', 'A')], 'WS').map((n) => n.id)).toEqual([WORKSPACE_NODE_ID])
    const empty = withWorkspaceNode([], 'WS')
    expect(empty).toHaveLength(1)
    expect(empty[0]!.children).toEqual([])
  })

  it('leaves the real forest untouched', () => {
    const before = JSON.stringify(FOREST)
    withWorkspaceNode(FOREST, 'WS')
    expect(JSON.stringify(FOREST)).toBe(before)
  })

  it('knows the id is the node: only the exact display id', () => {
    expect(isWorkspaceNode({ id: WORKSPACE_NODE_ID })).toBe(true)
    expect(isWorkspaceNode({ id: 'plans' })).toBe(false)
    expect(isWorkspaceNode({ id: null })).toBe(false)
    expect(isWorkspaceNode(null)).toBe(false)
  })

  it('draws the root and every folder outside My Folder under the node, nothing else', () => {
    const index = buildFolderIndex(FOREST)
    expect(drawnUnderWorkspaceNode(index, null)).toBe(true)
    expect(drawnUnderWorkspaceNode(index, 'plans')).toBe(true)
    expect(drawnUnderWorkspaceNode(index, 'plans-q4')).toBe(true)
    expect(drawnUnderWorkspaceNode(index, 'my')).toBe(false)
    expect(drawnUnderWorkspaceNode(index, 'my-sub')).toBe(false)
    expect(drawnUnderWorkspaceNode(index, 'unknown')).toBe(false)
  })
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.setItem('genoffice.lang', 'vi')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.restoreAllMocks()
})

interface Spies {
  onOpen: Mock
  onExpandedChange: Mock
  menuFor: Mock
  onMenuIntent: Mock
  blockOf: Mock
  onNew: Mock
}

async function mount(
  options: {
    nodes?: UniworkFolderNode[]
    expanded?: string[]
    workspaceNode?: boolean
    withMenu?: boolean
    hideRoot?: boolean
  } = {},
): Promise<Spies> {
  const spies: Spies = {
    onOpen: vi.fn(),
    onExpandedChange: vi.fn(),
    menuFor: vi.fn((): FolderMenuItem[] => [{ id: 'rename', label: 'Rename', onSelect: vi.fn() }]),
    onMenuIntent: vi.fn(),
    blockOf: vi.fn(() => null),
    onNew: vi.fn(),
  }
  const { workspaceNode = true, withMenu = true, hideRoot = true } = options
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'vi' },
        createElement(UniworkFolderTree, {
          nodes: options.nodes ?? FOREST,
          label: 'Cây thư mục',
          expanded: new Set(options.expanded ?? [WORKSPACE_NODE_ID]),
          onExpandedChange: spies.onExpandedChange,
          selectedKey: ROOT_KEY,
          onOpen: spies.onOpen,
          hideRoot,
          menuFor: spies.menuFor,
          onMenuIntent: spies.onMenuIntent,
          blockOf: spies.blockOf,
          workspaceNode: workspaceNode
            ? {
                menu: withMenu ? [{ id: 'new', label: 'Tạo thư mục', onSelect: spies.onNew }] : [],
              }
            : undefined,
        }),
      ),
    )
  })
  return spies
}

const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]'))
const titles = () => rows().map((r) => r.querySelector('.uwf-tree-title')!.textContent)
const wsRow = () => rows().find((r) => r.dataset.key === WORKSPACE_NODE_ID)!

describe('the workspace folder node in the sidebar tree', () => {
  it('draws My Folder and the node side by side, the node holding exactly the other roots', async () => {
    await mount()
    expect(titles()).toEqual(['Thư mục của tôi', 'Thư mục của workspace', 'Plans', 'Budgets'])
    expect(rows().map((r) => r.getAttribute('aria-level'))).toEqual(['1', '1', '2', '2'])
    expect(wsRow().getAttribute('aria-expanded')).toBe('true')
    // My Folder is no child of the node: it keeps its own subtree
    expect(rows()[0]!.dataset.key).toBe('my')
  })

  it('wraps the roots when there is no My Folder', async () => {
    await mount({ nodes: [node('plans', 'Plans')] })
    expect(titles()).toEqual(['Thư mục của workspace', 'Plans'])
  })

  it('is off unless the host asks, and only in the root-less sidebar tree', async () => {
    await mount({ workspaceNode: false })
    expect(titles()).toEqual(['Thư mục của tôi', 'Plans', 'Budgets'])
    await mount({ hideRoot: false })
    expect(rows().some((r) => r.dataset.key === WORKSPACE_NODE_ID)).toBe(false)
  })

  it('starts folded when the host did not open it', async () => {
    await mount({ expanded: [] })
    expect(titles()).toEqual(['Thư mục của tôi', 'Thư mục của workspace'])
    expect(wsRow().getAttribute('aria-expanded')).toBe('false')
  })

  it('folds on click and on Enter, opens nothing, and its id reaches no host callback', async () => {
    const spies = await mount()
    await act(async () => {
      wsRow().click()
    })
    expect(spies.onExpandedChange).toHaveBeenLastCalledWith(new Set())
    await act(async () => {
      wsRow().focus()
      wsRow().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(spies.onExpandedChange).toHaveBeenCalledTimes(2)
    expect(spies.onExpandedChange).toHaveBeenLastCalledWith(new Set())
    expect(spies.onOpen).not.toHaveBeenCalled()
    for (const spy of [spies.onOpen, spies.menuFor, spies.onMenuIntent, spies.blockOf]) {
      for (const call of spy.mock.calls) {
        const arg = call[0] as { id?: string | null } | string | null
        expect(typeof arg === 'object' && arg ? arg.id : arg).not.toBe(WORKSPACE_NODE_ID)
      }
    }
  })

  it('opens a folder under the node with its real id', async () => {
    const spies = await mount()
    const plans = rows().find((r) => r.dataset.key === 'plans')!
    await act(async () => {
      plans.click()
    })
    expect(spies.onOpen).toHaveBeenCalledWith('plans')
  })

  it('has the host menu only: one entry, no rename even on F2, host menu never asked', async () => {
    const spies = await mount()
    const row = wsRow()
    expect(row.classList.contains('uwf-tree-row-menu')).toBe(true)
    await act(async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    const entries = Array.from(document.querySelectorAll('[role="menuitem"]'))
    expect(entries.map((e) => e.getAttribute('data-folder-action'))).toEqual(['new'])
    await act(async () => {
      ;(entries[0] as HTMLElement).click()
    })
    expect(spies.onNew).toHaveBeenCalledTimes(1)
    expect(spies.onMenuIntent).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: WORKSPACE_NODE_ID }),
      expect.anything(),
    )
    await act(async () => {
      row.focus()
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    })
    expect(spies.onNew).toHaveBeenCalledTimes(1)
  })

  it('has no menu at all when the host gives it no entry', async () => {
    const spies = await mount({ withMenu: false })
    const row = wsRow()
    expect(row.classList.contains('uwf-tree-row-menu')).toBe(false)
    expect(row.querySelector('.uw-row-menu')).toBeNull()
    await act(async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(spies.onNew).not.toHaveBeenCalled()
  })

  it('is never the selected row, even when the selection is the workspace root', async () => {
    await mount()
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(0)
  })
})
