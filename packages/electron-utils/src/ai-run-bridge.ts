/// Preload half of the AI turn signal (see ./ai-run): exposes
/// window.uniworkAiRun.reportAiRun, which forwards a report to the shell main
/// process over AI_RUN_CHANNEL. Called once from every editor preload.
import { contextBridge, ipcRenderer } from 'electron'
import { AI_RUN_BRIDGE_KEY, AI_RUN_CHANNEL } from './ai-run'
import type { AiRunBridge, AiRunReport } from './ai-run'

export function createAiRunBridge(
  send: (channel: string, report: AiRunReport) => void,
): AiRunBridge {
  return {
    // only the two named fields cross; main validates them again
    reportAiRun: (report) =>
      send(AI_RUN_CHANNEL, {
        state: report?.state,
        ...(report?.runId !== undefined ? { runId: report.runId } : {}),
      } as AiRunReport),
  }
}

export function installAiRunBridge(): void {
  contextBridge.exposeInMainWorld(
    AI_RUN_BRIDGE_KEY,
    createAiRunBridge((channel, report) => ipcRenderer.send(channel, report)),
  )
}
