/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider, useI18n } from '../src/renderer/src/locale'
import { WbToastHost, createWbToasts } from '../src/renderer/src/WbToastHost'
import { WorkbenchModulePane } from '../src/renderer/src/WorkbenchModulePanes'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function SwitchToVi() {
  const { setLang } = useI18n()
  return createElement('button', { id: 'to-vi', onClick: () => setLang('vi') })
}

it('the Forms upload notice follows a language switch while it is shown', async () => {
  window.aiOffice = {
    pickAttachments: vi.fn(async () => ({ accepted: [], rejected: [] })),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SwitchToVi),
        createElement(
          WbToastHost,
          { toasts: createWbToasts() },
          createElement(WorkbenchModulePane, {
            moduleId: 'forms',
            practiceId: 'sales',
            vi: false,
            workspace: null,
            workspaceError: null,
            onReload: () => {},
          }),
        ),
      ),
    )
  })
  const upload = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === 'Upload template file…',
  )!
  await act(async () => upload.click())
  // a toast in the page's one host, translated at render
  expect(host.querySelector('.wb-toast')?.textContent).toContain('No supported file selected.')
  await act(async () => host.querySelector<HTMLButtonElement>('#to-vi')!.click())
  expect(host.textContent).toContain('Không chọn được tệp được hỗ trợ.')
  act(() => root.unmount())
  host.remove()
})
