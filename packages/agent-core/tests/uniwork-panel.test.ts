import { describe, expect, it } from 'vitest'
import {
  getEntryResultChipView,
  isTurnEnded,
  panelLiveAnnouncement,
  resolveEntryResultChip,
  resultChip,
  singleShortcutHint,
  uniworkErrorLineText,
  type ResultChipOutput,
  type UniworkPanelEntryLike,
} from '../src/index.js'

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
    const answerChip: ResultChipOutput = resultChip({
      provider: 'uniwork',
      text: 'A',
    })

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
      const editedChip = resultChip({
        provider: 'uniwork',
        mutated: true,
        stopped: true,
        text: 'A',
      })
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        {
          role: 'assistant',
          text: 'A',
          streaming: false,
          resultChip: editedChip,
        },
      ]
      const view = getEntryResultChipView(entries, 1, false, mockTranslate)
      expect(view).toEqual({
        chip: editedChip,
        labelText: '[aiResultEdited]',
        stoppedText: '[aiRunStopped]',
      })

      const fallbackEntries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: 'Computed answer', streaming: false },
      ]
      const fallbackView = getEntryResultChipView(fallbackEntries, 1, false, mockTranslate, {
        provider: 'uniwork',
      })
      expect(fallbackView?.chip.chip).toBe('answer')
      expect(fallbackView?.labelText).toBe('[aiResultAnswer]')
      expect(fallbackView?.stoppedText).toBeNull()
    })

    it('narrows labelKey !== null when user stopped before any write (stopped-only chip)', () => {
      const stoppedOnlyChip = resultChip({
        provider: 'uniwork',
        stopped: true,
        text: '',
      })
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        {
          role: 'assistant',
          text: '',
          streaming: false,
          resultChip: stoppedOnlyChip,
        },
      ]
      const view = getEntryResultChipView(entries, 1, false, mockTranslate)
      expect(view).toEqual({
        chip: stoppedOnlyChip,
        labelText: null,
        stoppedText: '[aiRunStopped]',
      })
    })
  })

  describe('stop filler is not streamed text (RF2-1)', () => {
    it('hasStreamedText=false wins over a filler entry.text: no Answer chip, stopped line only', () => {
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: '(stopped filler)', streaming: false },
      ]
      const view = getEntryResultChipView(entries, 1, false, mockTranslate, {
        provider: 'uniwork',
        stopped: true,
        hasStreamedText: false,
      })
      expect(view).toEqual({
        chip: expect.objectContaining({ chip: null, labelKey: null }),
        labelText: null,
        stoppedText: '[aiRunStopped]',
      })
    })
  })

  describe('panelLiveAnnouncement (RF1-19)', () => {
    it('returns waitLine or status first while running, joining streaming notes when both exist', () => {
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

      expect(
        panelLiveAnnouncement({
          entries: [
            {
              role: 'assistant',
              text: '',
              streaming: true,
              waitLine: 'Thử lại sau 30 giây.',
              notes: [{ text: 'Cuộc trò chuyện đã khởi động lại.' }],
            },
          ],
          busy: true,
          translate: mockTranslate,
        }),
      ).toBe('Thử lại sau 30 giây. Cuộc trò chuyện đã khởi động lại.')
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
            resultChip: resultChip({
              provider: 'uniwork',
              text: longAnswer,
            }),
          },
        ],
        busy: false,
        translate: mockTranslate,
      })

      expect(announced).toBe('[aiResultAnswer]')
      expect(announced).not.toContain(longAnswer)
    })

    it('a stopped Answer announces its label and the stopped line (RF2-9)', () => {
      const announced = panelLiveAnnouncement({
        entries: [
          { role: 'user', text: 'Q' },
          {
            role: 'assistant',
            text: 'partial answer',
            streaming: false,
            resultChip: resultChip({ provider: 'uniwork', stopped: true, text: 'partial answer' }),
          },
        ],
        busy: false,
        translate: mockTranslate,
      })
      expect(announced).toBe('[aiResultAnswer]. [aiRunStopped]')
    })

    it('an error chip announces its error line after the label (RF2-9)', () => {
      const announced = panelLiveAnnouncement({
        entries: [
          { role: 'user', text: 'Q' },
          {
            role: 'assistant',
            text: '',
            streaming: false,
            resultChip: resultChip({
              provider: 'uniwork',
              error: { code: 'unavailable', message: 'down' },
            }),
          },
        ],
        busy: false,
        translate: mockTranslate,
      })
      expect(announced).toBe('[aiResultError]. [aiErrUnavailable]')
    })

    it('a stop with nothing streamed announces the stopped line only (RF2-1)', () => {
      const announced = panelLiveAnnouncement({
        entries: [
          { role: 'user', text: 'Q' },
          { role: 'assistant', text: '(stopped filler)', streaming: false },
        ],
        busy: false,
        translate: mockTranslate,
        lastEntryChipInput: { provider: 'uniwork', stopped: true, hasStreamedText: false },
      })
      expect(announced).toBe('[aiRunStopped]')
    })

    it('does not double terminal punctuation (. ! ? 。 ！ ？) when joining parts in vi, en and zh (RF3-4)', () => {
      const stoppedErrorChip: ResultChipOutput = {
        ...resultChip({
          provider: 'uniwork',
          stopped: true,
          error: { code: 'unavailable', message: 'down' },
        }),
        labelKey: 'aiResultError',
      }
      const entries: UniworkPanelEntryLike[] = [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: '', streaming: false, resultChip: stoppedErrorChip },
      ]

      const viStrings: Record<string, string> = {
        aiResultError: 'Đã dừng',
        aiErrUnavailable:
          'UniWork AI tạm thời không phản hồi. Tài liệu và nút Lưu vẫn dùng bình thường.',
        aiRunStopped: 'Đã dừng theo yêu cầu của bạn.',
      }
      expect(
        panelLiveAnnouncement({
          entries,
          busy: false,
          translate: (k) => viStrings[k] ?? k,
        }),
      ).toBe(
        'Đã dừng. UniWork AI tạm thời không phản hồi. Tài liệu và nút Lưu vẫn dùng bình thường. Đã dừng theo yêu cầu của bạn.',
      )

      const enBangStrings: Record<string, string> = {
        aiResultError: 'Stopped!',
        aiErrUnavailable: 'Is UniWork AI reachable?',
        aiRunStopped: 'Stopped at your request.',
      }
      expect(
        panelLiveAnnouncement({
          entries,
          busy: false,
          translate: (k) => enBangStrings[k] ?? k,
        }),
      ).toBe('Stopped! Is UniWork AI reachable? Stopped at your request.')

      const zhStrings: Record<string, string> = {
        aiResultError: '已停止！',
        aiErrUnavailable: 'UniWork AI 暂时无响应。文档和保存按钮仍可正常使用。',
        aiRunStopped: '已按你的要求停止。',
      }
      expect(
        panelLiveAnnouncement({
          entries,
          busy: false,
          translate: (k) => zhStrings[k] ?? k,
        }),
      ).toBe('已停止！ UniWork AI 暂时无响应。文档和保存按钮仍可正常使用。 已按你的要求停止。')

      const zhQuestionStrings: Record<string, string> = {
        aiResultError: '为什么停止？',
        aiErrUnavailable: '服务暂不可用。',
        aiRunStopped: '已停止。',
      }
      expect(
        panelLiveAnnouncement({
          entries,
          busy: false,
          translate: (k) => zhQuestionStrings[k] ?? k,
        }),
      ).toBe('为什么停止？ 服务暂不可用。 已停止。')
    })

    it('returns empty string on completion when provider is not UniWork (no resultChip)', () => {
      const announced = panelLiveAnnouncement({
        entries: [
          { role: 'user', text: 'Hi' },
          { role: 'assistant', text: 'BYOK reply', streaming: false },
        ],
        busy: false,
        translate: mockTranslate,
        lastEntryChipInput: {
          provider: 'openai',
          text: 'BYOK reply',
        },
      })
      expect(announced).toBe('')
    })
  })

  describe('the announcement says what the visible turn says (chipwire F2, F3)', () => {
    const tail = (chip: ResultChipOutput) =>
      panelLiveAnnouncement({
        entries: [
          { role: 'user', text: 'Q' },
          { role: 'assistant', text: 'body', streaming: false, resultChip: chip },
        ],
        busy: false,
        translate: mockTranslate,
      })

    it('a specific error key (the key of the visible line) is announced, never the generic line', () => {
      for (const key of ['aiErrCredits', 'aiErrSession', 'aiErrUnavailable', 'aiErrRunLimit']) {
        expect(tail(resultChip({ provider: 'uniwork', error: key }))).toBe(
          `[aiResultError]. [${key}]`,
        )
      }
    })

    it('an unsupported chip announces its reason after the label', () => {
      const viewOnly = resultChip({
        provider: 'uniwork',
        droppedToolCalls: [{ name: 'insert_content', reason: 'view_only' }],
      })
      expect(tail(viewOnly)).toBe('[aiResultUnsupported]. [aiErrViewOnlyEdit]')
      const unsupported = resultChip({
        provider: 'uniwork',
        droppedToolCalls: [{ name: 'cloud_search', reason: 'not_allowlisted', module: 'Docs' }],
      })
      expect(tail(unsupported)).toBe('[aiResultUnsupported]. [aiErrUnsupported:module=Docs]')
    })
  })

  describe('uniworkErrorLineText (chipwire F11)', () => {
    const prefix = (e: string) => `Lỗi: ${e}`
    it('an error chip already says Error: the line is the bare message', () => {
      const chip = resultChip({ provider: 'uniwork', error: 'aiErrCredits' })
      expect(uniworkErrorLineText(chip, 'Hết tín dụng', prefix)).toBe('Hết tín dụng')
    })
    it('any other chip (edited then failed) or no chip keeps the prefix', () => {
      const edited = resultChip({ provider: 'uniwork', mutated: true, error: 'aiErrCredits' })
      expect(uniworkErrorLineText(edited, 'Hết tín dụng', prefix)).toBe('Lỗi: Hết tín dụng')
      expect(uniworkErrorLineText(null, 'boom', prefix)).toBe('Lỗi: boom')
    })
  })

  describe('singleShortcutHint (chipwire F5)', () => {
    it('non-Mac: one Ctrl shortcut, in the language of the Ctrl key, from the rewritten text', () => {
      expect(singleShortcutHint('Chưa lưu — hoàn tác bằng Ctrl/Ctrl+Z hoặc bấm Lưu.', false)).toBe(
        'Chưa lưu — hoàn tác bằng Ctrl+Z hoặc bấm Lưu.',
      )
      expect(singleShortcutHint('mit Strg/Ctrl+Z rückgängig', false)).toBe('mit Strg+Z rückgängig')
    })
    it('Mac: ⌘Z from the dictionary notation', () => {
      expect(singleShortcutHint('undo with Ctrl/⌘+Z, or press Save', true)).toBe(
        'undo with ⌘Z, or press Save',
      )
    })
    it('leaves a text without the dual form alone', () => {
      expect(singleShortcutHint('Press Save', false)).toBe('Press Save')
      expect(singleShortcutHint('Ctrl+Enter sends', false)).toBe('Ctrl+Enter sends')
    })
  })
})
