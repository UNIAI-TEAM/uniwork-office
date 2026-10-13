import { useEffect, useState } from 'react'
import { DiscussionPanel } from './DiscussionPanel'
import { Home } from './Home'
import { Onboarding } from './Onboarding'
import { TabBar } from './TabBar'
import { UniworkLockHost } from './UniworkLockPanel'
import { WorkbenchAccountGate } from './WorkbenchAccountGate'

interface AppFrameProps {
  /** resolved before first paint (main.tsx) so home never flashes under the overlay */
  initialOnboardingSeen: boolean
}

export function AppFrame({ initialOnboardingSeen }: AppFrameProps) {
  const [homeActive, setHomeActive] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.aiOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setHomeActive(!active || active.kind === 'home')
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])

  const finishOnboarding = async (): Promise<boolean> => {
    try {
      const persisted = await window.aiOffice.setOnboardingSeen()
      if (!persisted) return false
      setShowOnboarding(false)
      return true
    } catch {
      return false
    }
  }

  return (
    <div className="app-frame">
      <TabBar />
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div className="app-frame-content" style={{ visibility: homeActive ? 'visible' : 'hidden' }}>
        {/* S11: a working copy refused by the newer-store guard replaces the content area
         * until closed; the host makes the Home subtree inert while its panel is shown */}
        <UniworkLockHost homeActive={homeActive}>
          {/* Home shows the signed-in account's My AI and workbench data only */}
          <WorkbenchAccountGate>
            <Home />
          </WorkbenchAccountGate>
        </UniworkLockHost>
      </div>
      {/* S13: main narrows the active editor view by this width, so the panel draws in the strip it frees */}
      <DiscussionPanel />
      {/* editor WebContentsViews paint above ALL shell DOM, so the overlay only
       * renders while the home tab is active — it comes back when home does */}
      {showOnboarding && homeActive && <Onboarding onDone={finishOnboarding} />}
    </div>
  )
}
