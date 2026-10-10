/**
 * Personal-teacher commercial helpers: Hub probe + lesson-pack zip export.
 * Desktop editing stays free; only AI Hub usage is billable on the gateway.
 */
import { basename } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { BrowserWindow, dialog } from 'electron'
import JSZip from 'jszip'
import { ProjectStore } from '@genoffice/project-store'
import {
  eduPackReadme,
  extractHubBalanceHint,
  hubModelsUrl,
  isOpenRouterHubUrl,
  normalizeHubBaseUrl,
  type HubProbeResult,
} from '@uniwork/edu-core'
import { openRouterAttributionHeaders, probeOpenRouterKey } from '@genoffice/ai-provider'
import { showSaveDialogWithMemory } from '@genoffice/electron-utils'

export async function probeAiHub(baseUrl: string, apiKey: string): Promise<HubProbeResult> {
  const modelsUrl = hubModelsUrl(baseUrl)
  if (!modelsUrl || !apiKey.trim()) {
    return { ok: false, message: 'Cần Base URL và khóa API.' }
  }
  const openRouter = isOpenRouterHubUrl(baseUrl)
  try {
    const res = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        Accept: 'application/json',
        ...(openRouter ? openRouterAttributionHeaders(modelsUrl) : {}),
      },
    })
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text) as unknown
    } catch {
      json = null
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: 'Token không hợp lệ hoặc bị từ chối.', openRouter }
    }
    if (res.status === 402) {
      return { ok: false, message: 'Hết Token / cần nạp credit trên Hub.', openRouter }
    }
    if (!res.ok) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 160)
      return {
        ok: false,
        message: `Hub lỗi HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`,
        openRouter,
      }
    }
    const data = json && typeof json === 'object' ? (json as { data?: unknown[] }) : null
    const modelCount = Array.isArray(data?.data) ? data.data.length : undefined
    let balanceText = extractHubBalanceHint(json)
    const remaining =
      res.headers.get('x-remaining-credits') || res.headers.get('x-credits-remaining')
    if (!balanceText && remaining) balanceText = remaining

    // OpenRouter: enrich with GET /api/v1/key (limit_remaining / usage).
    if (openRouter) {
      const keyStatus = await probeOpenRouterKey(apiKey.trim())
      if (keyStatus.ok && keyStatus.summary) {
        balanceText = keyStatus.summary
      } else if (!balanceText && keyStatus.error) {
        // Models OK but key probe failed — still report models success.
      }
    }

    return {
      ok: true,
      message: balanceText
        ? `Hub OK — ${balanceText}`
        : modelCount != null
          ? `Hub OK — ${modelCount} model.`
          : 'Hub OK — kết nối được.',
      ...(balanceText ? { balanceText: String(balanceText) } : {}),
      ...(modelCount != null ? { modelCount } : {}),
      openRouter,
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      openRouter,
    }
  }
}

export async function exportLessonPackZip(opts: {
  userDataPath: string
  projectId: string
  parent: BrowserWindow | null
}): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }> {
  const store = new ProjectStore(opts.userDataPath)
  const summary = store.listProjectsSummary().find((p) => p.id === opts.projectId)
  if (!summary) return { ok: false, error: 'Không tìm thấy gói bài.' }
  const meta = store.getEduMeta(opts.projectId)
  if (!meta) return { ok: false, error: 'Gói này không phải gói Giáo viên.' }
  const files = store.listProjectFiles(opts.projectId)
  const zip = new JSZip()
  const folderName = sanitizeFolderName(
    [meta.subject, meta.grade, meta.lessonTitle].filter(Boolean).join(' - ') || summary.name,
  )
  const names: string[] = []
  for (const filePath of files) {
    if (!existsSync(filePath)) continue
    const name = basename(filePath)
    names.push(name)
    zip.file(`${folderName}/${name}`, readFileSync(filePath))
  }
  zip.file(`${folderName}/README.txt`, eduPackReadme(meta, names))
  zip.file(`${folderName}/meta.json`, JSON.stringify(meta, null, 2))

  const defaultName = `${folderName}.zip`
  const picked = await showSaveDialogWithMemory(dialog, opts.parent, {
    title: 'Xuất gói bài',
    defaultPath: defaultName,
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  })
  if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(picked.filePath, buf)
  return { ok: true, path: picked.filePath }
}

function sanitizeFolderName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
      .trim()
      .slice(0, 80) || 'goi-bai'
  )
}

export function hubBaseNormalized(baseUrl: string): string {
  return normalizeHubBaseUrl(baseUrl)
}
