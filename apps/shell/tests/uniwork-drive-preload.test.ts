/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { UNIWORK_DRIVE_CHANNELS, type UniworkDriveApi } from '../src/shared/uniwork-drive-api'

async function loadBridge(reply: unknown) {
  vi.resetModules()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: () => undefined,
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return typeof reply === 'function' ? (reply as (ch: string) => unknown)(channel) : reply
      },
      send: () => undefined,
      removeListener: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  return {
    drive: exposed.uniworkDrive as UniworkDriveApi,
    office: exposed.aiOffice as HomeApi,
    invoked,
  }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

describe('window.uniworkDrive and aiOffice.uniworkDrive* (preload, UNI-2194)', () => {
  it('invokes each UNIWORK_DRIVE_CHANNELS entry with the renderer arguments', async () => {
    const { drive, office, invoked } = await loadBridge({ ok: true, value: null })
    await drive.isAvailable()
    await drive.listConnections('ws_1')
    await drive.listFiles({ workspaceId: 'ws_1', connectionId: 'c_1', cursor: 'cur', limit: 20 })
    await drive.listFolders({ workspaceId: 'ws_1', connectionId: 'c_1' })
    await drive.getFile({ workspaceId: 'ws_1', driveFileId: 'df_1' })
    await drive.unlink({ workspaceId: 'ws_1', driveFileId: 'df_1' })
    await drive.openOnGoogle({ workspaceId: 'ws_1', driveFileId: 'df_1' })
    await drive.getHistory({ workspaceId: 'ws_1', driveFileId: 'df_1' })

    const C = UNIWORK_DRIVE_CHANNELS
    expect(invoked.filter((c) => c.channel.startsWith('uniwork-drive:'))).toEqual([
      { channel: C.isAvailable, args: [] },
      { channel: C.listConnections, args: ['ws_1'] },
      {
        channel: C.listFiles,
        args: [{ workspaceId: 'ws_1', connectionId: 'c_1', cursor: 'cur', limit: 20 }],
      },
      { channel: C.listFolders, args: [{ workspaceId: 'ws_1', connectionId: 'c_1' }] },
      { channel: C.getFile, args: [{ workspaceId: 'ws_1', driveFileId: 'df_1' }] },
      { channel: C.unlink, args: [{ workspaceId: 'ws_1', driveFileId: 'df_1' }] },
      { channel: C.openOnGoogle, args: [{ workspaceId: 'ws_1', driveFileId: 'df_1' }] },
      { channel: C.getHistory, args: [{ workspaceId: 'ws_1', driveFileId: 'df_1' }] },
    ])

    // aiOffice.uniworkDrive* aliases invoke the same channels
    await office.uniworkDriveIsAvailable?.()
    expect(invoked.at(-1)).toEqual({ channel: C.isAvailable, args: [] })
    await office.uniworkDriveListConnections?.('ws_2')
    expect(invoked.at(-1)).toEqual({ channel: C.listConnections, args: ['ws_2'] })
    await office.uniworkDriveListFolders?.({ workspaceId: 'ws_2', connectionId: 'c_2' })
    expect(invoked.at(-1)).toEqual({
      channel: C.listFolders,
      args: [{ workspaceId: 'ws_2', connectionId: 'c_2' }],
    })
  })

  it('passes valid ok/error envelopes through and turns broken replies into server_error', async () => {
    const okBridge = await loadBridge({ ok: true, value: [{ id: 'c_1' }] })
    expect(await okBridge.drive.listConnections('ws_1')).toEqual({
      ok: true,
      value: [{ id: 'c_1' }],
    })

    for (const code of [
      'network',
      'not_signed_in',
      'session_expired',
      'not_found',
      'forbidden',
      'feature_disabled',
      'auth_failed',
      'server_error',
    ] as const) {
      const errBridge = await loadBridge({ ok: false, error: code })
      expect(await errBridge.drive.listConnections('ws_1')).toEqual({
        ok: false,
        error: code,
      })
    }

    for (const broken of [undefined, null, 'bad', {}, { ok: false, error: 'unknown_code' }]) {
      const badBridge = await loadBridge(broken)
      expect(await badBridge.drive.listConnections('ws_1')).toEqual({
        ok: false,
        error: 'server_error',
      })
    }
  })

  it('invokes uniwork-drive:is-available in isAvailable() and maps non-boolean replies to false', async () => {
    const C = UNIWORK_DRIVE_CHANNELS

    const onBridge = await loadBridge((ch: string) => (ch === C.isAvailable ? true : null))
    expect(await onBridge.drive.isAvailable()).toBe(true)
    expect(await onBridge.office.uniworkDriveIsAvailable?.()).toBe(true)

    const offBridge = await loadBridge((ch: string) => (ch === C.isAvailable ? false : null))
    expect(await offBridge.drive.isAvailable()).toBe(false)
    expect(await offBridge.office.uniworkDriveIsAvailable?.()).toBe(false)

    for (const nonBool of [null, undefined, 'true', 1, { ok: true, value: true }]) {
      const badBridge = await loadBridge(nonBool)
      expect(await badBridge.drive.isAvailable()).toBe(false)
      expect(await badBridge.office.uniworkDriveIsAvailable?.()).toBe(false)
    }
  })
})
