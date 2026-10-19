/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupStoragePane } from '../src/renderer/src/BackupStoragePane'
import { LocaleProvider } from '../src/renderer/src/locale'

/**
 * UNI-1958 row 11: the dev-only "clear simulated purchases" button and its
 * confirmation read "Xóa ..." (the web's spelling), never "Xoá ...".
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('BackupStoragePane clear-simulated control (vi)', () => {
  it('the button reads "Xóa giao dịch mô phỏng (dev)" and the status "Đã xóa ..." after a click', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(BackupStoragePane, { loggedIn: true, onLogin: () => undefined }),
        ),
      )
    })
    const button = host.querySelector<HTMLButtonElement>('.set-backup-actions .set-btn')!
    expect(button.textContent).toBe('Xóa giao dịch mô phỏng (dev)')
    expect(button.textContent).not.toContain('Xoá')
    await act(async () => button.click())
    const status = host.querySelector<HTMLElement>('[role="status"]')!
    expect(status.textContent).toBe('Đã xóa giao dịch mô phỏng.')
    expect(status.textContent).not.toContain('xoá')
  })
})
