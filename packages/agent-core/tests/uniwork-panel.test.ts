import { describe, expect, it } from 'vitest'
import {
  getEntryResultChipView,
  isTurnEnded,
  panelLiveAnnouncement,
  resolveEntryResultChip,
  type UniworkPanelEntryLike,
} from '../src/index.js'
import type { ResultChip } from '../src/result-chip.js'

const mockTranslate = (key: string, vars?: Record<string, string | number>): string => {
  if (!vars || Object.keys(vars).length === 0) return `[${key}]`
  const suffix = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return `[${key}:${suffix}]`
}

describe('uniwork-panel shared helper (RF1-14, RF1-19)', () => {
  describe('isTurnEnded', () => {
    it('returns false when index is out of bounds', () => {
      const entries: UniworkPanelEntryLike[] = [{ role: 'assistant', text: 'Hello' }]
      expect(isTurnEnded(entries, -1, false)).toBe(false)
      expect(isTurnEnded(entries, 1, false)).toBe(false)
    })

    it('returns true for the last entry only when not busy', () => {
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hello' },
      ]
      expect(isTurnEnded(entries, 1, true)).toBe(false)
      expect(isTurnEnded(entries, 1, false)).toBe(true)
    })

    it('returns true for an earlier assistant entry only when followed by a user entry', () => {
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Turn 1' },
        { role: 'assistant', text: 'Step 1' },
        { role: 'assistant', text: 'Step 2' },
        { role: 'user', text: 'Turn 2' },
        { role: 'assistant', text: 'Reply 2', streaming: true },
      ]
      expect(isTurnEnded(entries, 1, true)).toBe(false)
      expect(isTurnEnded(entries, 2, true)).toBe(true)
      expect(isTurnEnded(entries, 4, true)).toBe(false)
    })
  })

  describe('resolveEntryResultChip & getEntryResultChipView', () => {
    const answerChip: ResultChip = {
      kind: 'answer',
      tone: 'neutral',
      labelKey: 'aiResultAnswer',
    }

    it('returns null while entry is streaming or turn has not ended', () => {
      const streamingEntries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: 'A', streaming: true, resultChip: answerChip },
      ]
      expect(resolveEntryResultChip(streamingEntries, 1, false)).toBeNull()

      const busyEntries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: 'A', streaming: false, resultChip: answerChip },
      ]
      expect(resolveEntryResultChip(busyEntries, 1, true)).toBeNull()
      expect(getEntryResultChipView(busyEntries, 1, true, mockTranslate)).toBeNull()
    })

    it('resolves precomputed resultChip or computes from fallback input when turn ended', () => {
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        {
          role: 'assistant',
          text: 'A',
          streaming: false,
          resultChip: {
            kind: 'edited',
            tone: 'success',
            labelKey: 'aiResultEditedCellsCount',
            labelMeta: { count: 4 },
            stoppedKey: 'aiStoppedNoMoreChanges',
          },
        },
      ]
      const view = getEntryResultChipView(entries, 1, false, mockTranslate)
      expect(view).toEqual({
        chip: entries[1].resultChip,
        labelText: '[aiResultEditedCellsCount:count=4]',
        stoppedText: '[aiStoppedNoMoreChanges]',
      })

      const fallbackEntries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: 'Computed answer', streaming: false },
      ]
      const fallbackView = getEntryResultChipView(fallbackEntries, 1, false, mockTranslate, {
        provider: 'uniwork',
        module: 'pdf',
        toolCalls: [],
        assistantText: 'Computed answer',
      })
      expect(fallbackView?.chip.kind).toBe('answer')
      expect(fallbackView?.labelText).toBe('[aiResultAnswer]')
      expect(fallbackView?.stoppedText).toBeNull()
    })

    it('narrows labelKey !== null when user stopped before any write (stopped-only chip)', () => {
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        {
          role: 'assistant',
          text: '',
          streaming: false,
          resultChip: {
            kind: null,
            tone: 'neutral',
            labelKey: null,
            stoppedKey: 'aiStoppedNoMoreChanges',
          },
        },
      ]
      const view = getEntryResultChipView(entries, 1, false, mockTranslate)
      expect(view).toEqual({
        chip: entries[1].resultChip,
        labelText: null,
        stoppedText: '[aiStoppedNoMoreChanges]',
      })
    })
  })

  describe('panelLiveAnnouncement (RF1-19)', () => {
    it('returns waitLine or status first while running', () => {
      expect(
        panelLiveAnnouncement({
          entries: [
            { role: 'assistant', text: '', streaming: true, waitLine: 'Đang đọc tài liệu…' },
          ],
          busy: true,
          translate: mockTranslate,
        }),
      ).toBe('Đang đọc tài liệu…')

      expect(
        panelLiveAnnouncement({
          entries: [{ role: 'assistant', text: '', streaming: true, status: 'Đang ghi các ô…' }],
          busy: true,
          translate: mockTranslate,
        }),
      ).toBe('Đang ghi các ô…')
    })

    it('returns latest streaming note when waitLine is empty', () => {
      expect(
        panelLiveAnnouncement({
          entries: [
            {
              role: 'assistant',
              text: 'Partial',
              streaming: true,
              notes: [{ text: 'Note 1' }, { text: 'Note 2' }],
            },
          ],
          busy: true,
          translate: mockTranslate,
        }),
      ).toBe('Note 2')
    })

    it('announces ONLY the chip line on turn completion and never appends assistant body text (RF1-19)', () => {
      const longAnswer =
        'Đây là câu trả lời rất dài gồm nhiều đoạn văn mà trình đọc màn hình không nên đọc toàn bộ.'
      const announced = panelLiveAnnouncement({
        entries: [
          { role: 'user', text: 'Tóm tắt tài liệu' },
          {
            role: 'assistant',
            text: longAnswer,
            streaming: false,
            resultChip: {
              kind: 'answer',
              tone: 'neutral',
              labelKey: 'aiResultAnswer',
            },
          },
        ],
        busy: false,
        translate: mockTranslate,
      })

      expect(announced).toBe('[aiResultAnswer]')
      expect(announced).not.toContain(longAnswer)
    })

    it('returns empty string on completion when provider is not UniWork (no resultChip)', () => {
      const announced = panelLiveAnnouncement({
        entries: [
          { role: 'user', text: 'Hi' },
          { role: 'assistant', text: 'BYOK reply', streaming: false, resultChip: null },
        ],
        busy: false,
        translate: mockTranslate,
      })
      expect(announced).toBe('')
    })
  })
})
