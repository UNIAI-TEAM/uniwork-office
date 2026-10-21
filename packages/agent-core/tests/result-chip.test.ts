import { describe, expect, it } from 'vitest'
import { classifyDroppedToolReason, resultChip, extractSheetsCellsMeta } from '../src/index.js'

describe('notice-surface structured dropped reasons', () => {
  it('classifies only strict x_uniwork.dropped_tool_calls reasons (view_only and not_allowlisted) and rejects local aliases like readonly', () => {
    expect(classifyDroppedToolReason('view_only')).toBe('view_only')
    expect(classifyDroppedToolReason('readonly')).toBe('other')
    expect(classifyDroppedToolReason('read_only')).toBe('other')
    expect(classifyDroppedToolReason('not_allowlisted')).toBe('not_allowlisted')
    expect(classifyDroppedToolReason('other_reason')).toBe('other')
    expect(classifyDroppedToolReason(undefined)).toBe('other')
  })
})

describe('resultChip deterministic priority table', () => {
  it('(1) edited wins when >=1 editor write tool succeeded in the turn', () => {
    const res = resultChip({
      text: 'Đã cập nhật bảng doanh thu.',
      mutated: true,
      cellsMeta: {
        sheet: 'Sheet1',
        range: 'Sheet1!B4:C9',
        written: 12,
        overwritten: 4,
        rows: 6,
      },
    })
    expect(res.chip).toBe('edited')
    expect(res.labelKey).toBe('aiResultEdited')
    expect(res.tone).toBe('ok')
    expect(res.viewChangesKey).toBe('aiResultViewChanges')
    expect(res.editedHintKey).toBe('aiResultEditedHint')
    expect(res.meta?.cellsMetaKey).toBe('aiResultCellsMeta')
    expect(res.meta?.cellsMetaParams).toEqual({
      written: 12,
      range: 'Sheet1!B4:C9',
      overwritten: 4,
    })
    expect(res.errorLine).toBeNull()
  })

  it('(1) edited + later error -> chip is still edited AND S9 error line is returned with its action', () => {
    const res = resultChip({
      text: 'Đã ghi phần đầu bảng.',
      toolExecutions: [{ name: 'apply_ops', mutated: true, isError: false }],
      droppedToolCalls: [{ name: 'other_tool', reason: 'not_allowlisted', module: 'Docs' }],
      clarifyCalled: true,
      error: {
        code: 'run_limit_reached',
        message: 'Đã đạt giới hạn bước cho một lần hỏi.',
      },
    })
    expect(res.chip).toBe('edited')
    expect(res.labelKey).toBe('aiResultEdited')
    expect(res.tone).toBe('ok')
    expect(res.viewChangesKey).toBe('aiResultViewChanges')
    expect(res.editedHintKey).toBe('aiResultEditedHint')
    expect(res.errorLine).not.toBeNull()
    expect(res.errorLine?.key).toBe('aiErrRunLimit')
    expect(res.errorLine?.action).toBe('ask-again')
    expect(res.errorLine?.actionKey).toBe('aiRunAskAgain')
  })

  it('(2) unsupported from x_uniwork.dropped_tool_calls when no write ran: view_only -> aiErrViewOnlyEdit', () => {
    const res = resultChip({
      text: 'Tài liệu đang ở chế độ chỉ xem.',
      mutated: false,
      droppedToolCalls: [{ name: 'insert_content', reason: 'view_only' }],
    })
    expect(res.chip).toBe('unsupported')
    expect(res.labelKey).toBe('aiResultUnsupported')
    expect(res.tone).toBe('neutral')
    expect(res.reasonKey).toBe('aiErrViewOnlyEdit')
    expect(res.reasonParams).toBeUndefined()
  })

  it('(2) unsupported from x_uniwork.dropped_tool_calls when no write ran: not_allowlisted -> aiErrUnsupported {module}', () => {
    const res = resultChip({
      text: 'Thao tác này chưa được hỗ trợ.',
      mutated: false,
      moduleName: 'Docs',
      droppedToolCalls: [{ name: 'insert_macro', reason: 'not_allowlisted' }],
    })
    expect(res.chip).toBe('unsupported')
    expect(res.labelKey).toBe('aiResultUnsupported')
    expect(res.tone).toBe('neutral')
    expect(res.reasonKey).toBe('aiErrUnsupported')
    expect(res.reasonParams).toEqual({ module: 'Docs' })
  })

  it('(3) clarify only when allowlisted ask_clarification was called and no write or dropped tool calls', () => {
    const res = resultChip({
      text: 'Bạn muốn tóm tắt theo quý hay theo tháng?',
      toolExecutions: [{ name: 'ask_clarification', mutated: false, isError: false }],
    })
    expect(res.chip).toBe('clarify')
    expect(res.labelKey).toBe('aiResultClarify')
    expect(res.tone).toBe('warn')

    // A question mark in plain text without ask_clarification is still 'answer', NOT 'clarify'
    const plainQuestion = resultChip({
      text: 'Bạn có cần thêm chi tiết không?',
    })
    expect(plainQuestion.chip).toBe('answer')
    expect(plainQuestion.labelKey).toBe('aiResultAnswer')
  })

  it('(4) error when the turn ended in an S9 error and no write/unsupported/clarify happened', () => {
    const creditsErr = resultChip({
      text: '',
      error: { code: 'credits_exhausted' },
    })
    expect(creditsErr.chip).toBe('error')
    expect(creditsErr.labelKey).toBe('aiResultError')
    expect(creditsErr.tone).toBe('error')
    expect(creditsErr.errorLine?.key).toBe('aiErrCredits')
    expect(creditsErr.errorLine?.action).toBe('choose-provider')
    expect(creditsErr.errorLine?.actionKey).toBe('aiRunChooseOther')

    const sessionErr = resultChip({
      text: '',
      error: { code: 'session_expired' },
    })
    expect(sessionErr.chip).toBe('error')
    expect(sessionErr.errorLine?.key).toBe('aiErrSession')
    expect(sessionErr.errorLine?.action).toBe('sign-in')
    expect(sessionErr.errorLine?.actionKey).toBe('acctSignInAgain')

    const tooLargeErr = resultChip({
      text: '',
      error: { code: 'workbook_too_large' },
    })
    expect(tooLargeErr.chip).toBe('error')
    expect(tooLargeErr.errorLine?.key).toBe('aiErrWorkbookTooLarge')
    expect(tooLargeErr.errorLine?.action).toBe('open-in-app')
    expect(tooLargeErr.errorLine?.actionKey).toBe('aiRunOpenInApp')

    const rateLimitErr = resultChip({
      text: '',
      error: { code: 'ai_rate_limited' },
    })
    expect(rateLimitErr.chip).toBe('error')
    expect(rateLimitErr.errorLine?.key).toBe('aiErrRateLimitedNoWait')
    expect(rateLimitErr.errorLine?.action).toBe('retry')
  })

  it('(5) answer for normal read/reply turns', () => {
    const res = resultChip({
      text: 'Dưới đây là tóm tắt 3 ý chính của mục 2.',
    })
    expect(res.chip).toBe('answer')
    expect(res.labelKey).toBe('aiResultAnswer')
    expect(res.tone).toBe('info')
    expect(res.stoppedLine).toBe(false)
    expect(res.errorLine).toBeNull()
  })

  it('stop rules: stopped with text -> answer chip + aiRunStopped; stopped with no text -> no chip, only aiRunStopped; stopped after write -> edited chip + aiRunStopped', () => {
    const stoppedWithText = resultChip({
      text: 'Đoạn mở đầu đã được đọc...',
      stopped: true,
    })
    expect(stoppedWithText.chip).toBe('answer')
    expect(stoppedWithText.labelKey).toBe('aiResultAnswer')
    expect(stoppedWithText.stoppedLine).toBe(true)
    expect(stoppedWithText.stoppedKey).toBe('aiRunStopped')

    const stoppedNoText = resultChip({
      text: '   ',
      stopped: true,
    })
    expect(stoppedNoText.chip).toBeNull()
    expect(stoppedNoText.labelKey).toBeNull()
    expect(stoppedNoText.tone).toBeNull()
    expect(stoppedNoText.stoppedLine).toBe(true)
    expect(stoppedNoText.stoppedKey).toBe('aiRunStopped')

    const stoppedAfterWrite = resultChip({
      text: '',
      mutated: true,
      stopped: true,
    })
    expect(stoppedAfterWrite.chip).toBe('edited')
    expect(stoppedAfterWrite.labelKey).toBe('aiResultEdited')
    expect(stoppedAfterWrite.stoppedLine).toBe(true)
    expect(stoppedAfterWrite.stoppedKey).toBe('aiRunStopped')
  })

  it('engine cannot compute (§6.5) -> answer chip with warning in the meta line', () => {
    const res = resultChip({
      text: 'Đã tính tổng từ dữ liệu hiện có.',
      engineCannotCompute: true,
      engineWarning: 'Không thể tự tính công thức mảng động trên phạm vi này.',
    })
    expect(res.chip).toBe('answer')
    expect(res.labelKey).toBe('aiResultAnswer')
    expect(res.tone).toBe('info')
    expect(res.meta?.warnings).toContain('Không thể tự tính công thức mảng động trên phạm vi này.')
  })

  it('returns null chip when provider is BYOK (isUniwork === false)', () => {
    const res = resultChip({
      isUniwork: false,
      provider: 'anthropic',
      text: 'BYOK answer',
      mutated: true,
    })
    expect(res.chip).toBeNull()
    expect(res.labelKey).toBeNull()
  })

  it('extractSheetsCellsMeta extracts range and cell counts from tool summaries/outputs', () => {
    const meta = extractSheetsCellsMeta([
      {
        name: 'propose_operations',
        summary: 'Wrote 12 cells in Sheet1!B4:C9 (4 overwritten)',
        isError: false,
      },
    ])
    expect(meta).toMatchObject({
      range: 'Sheet1!B4:C9',
      written: 12,
      overwritten: 4,
    })
  })

  it('RF1-22: extractSheetsCellsMeta rejects non-range tokens like UTF8 / ID2, uses no Vietnamese literals, and prefers structured tool output', () => {
    // Reject tokens like UTF8 or ID2 that look like column+row if unanchored or part of prose
    const bogus = extractSheetsCellsMeta([
      {
        name: 'propose_operations',
        summary: 'Saved UTF8 text for ID2 in 5 cells (1 overwritten)',
        isError: false,
      },
    ])
    expect(bogus).toBeNull()

    // Structured JSON / fields in tool execution take precedence over prose parsing
    const structured = extractSheetsCellsMeta([
      {
        name: 'propose_operations',
        summary: 'Updated table',
        output: JSON.stringify({
          sheet: 'Revenue 2026',
          range: "'Revenue 2026'!$D$2:$F$10",
          written: 27,
          overwritten: 9,
          rows: 9,
        }),
        isError: false,
      },
    ])
    expect(structured).toEqual({
      sheet: 'Revenue 2026',
      range: "'Revenue 2026'!$D$2:$F$10",
      written: 27,
      overwritten: 9,
      rows: 9,
    })
  })

  it('RF1-6: maps provider_unreachable (502), cloud_unavailable (503), timeout -> aiErrUnavailable and office_capability_off / format_off -> aiErrCapabilityOff without falling through to raw server text', () => {
    for (const code of [
      'provider_unreachable',
      'cloud_unavailable',
      'timeout',
      'ai_provider_timeout',
      '502',
      '503',
    ]) {
      const res = resultChip({
        text: '',
        error: { code, message: 'Raw upstream 502 Bad Gateway error from server' },
      })
      expect(res.chip).toBe('error')
      expect(res.errorLine?.key, `code=${code}`).toBe('aiErrUnavailable')
      expect(res.errorLine?.action, `code=${code}`).toBe('retry')
      // the labelled "Thử lại" / "Retry" button of the S9 table (chipwire F1)
      expect(res.errorLine?.actionKey, `code=${code}`).toBe('aiRunRetry')
    }

    for (const code of ['office_capability_off', 'format_off', 'format-off', 'capability_off']) {
      const res = resultChip({
        text: '',
        error: { code, message: 'Raw server format off message' },
      })
      expect(res.chip).toBe('error')
      expect(res.errorLine?.key, `code=${code}`).toBe('aiErrCapabilityOff')
      expect(res.errorLine?.action, `code=${code}`).toBe('choose-provider')
      expect(res.errorLine?.actionKey, `code=${code}`).toBe('aiRunChooseOther')
    }

    // Even an unknown error code maps to aiErrUnavailable rather than key: null + raw server text
    const unknownErr = resultChip({
      text: '',
      error: { code: 'some_unforeseen_server_code', message: 'Internal stack trace' },
    })
    expect(unknownErr.chip).toBe('error')
    expect(unknownErr.errorLine?.key).toBe('aiErrGeneric')
    // RF2-3: an unknown code is not a "service unavailable" and offers no Retry
    expect(unknownErr.errorLine?.action).toBeNull()
    expect(unknownErr.errorLine?.actionKey).toBeNull()
    expect(unknownErr.errorLine?.rawMessage).toBeUndefined()
  })

  it('RF1-9: Stop before any write takes priority over dropped tool calls and ask_clarification (answer chip if text, null chip if no text, plus aiRunStopped)', () => {
    const stoppedDroppedWithText = resultChip({
      text: 'Đang phân tích bảng...',
      stopped: true,
      droppedToolCalls: [{ name: 'apply_ops', reason: 'view_only' }],
    })
    expect(stoppedDroppedWithText.chip).toBe('answer')
    expect(stoppedDroppedWithText.labelKey).toBe('aiResultAnswer')
    expect(stoppedDroppedWithText.stoppedLine).toBe(true)
    expect(stoppedDroppedWithText.stoppedKey).toBe('aiRunStopped')
    expect(stoppedDroppedWithText.reasonKey).toBeUndefined()

    const stoppedDroppedNoText = resultChip({
      text: '',
      stopped: true,
      droppedToolCalls: [{ name: 'apply_ops', reason: 'not_allowlisted', module: 'Docs' }],
    })
    expect(stoppedDroppedNoText.chip).toBeNull()
    expect(stoppedDroppedNoText.labelKey).toBeNull()
    expect(stoppedDroppedNoText.stoppedLine).toBe(true)
    expect(stoppedDroppedNoText.stoppedKey).toBe('aiRunStopped')

    const stoppedClarifyWithText = resultChip({
      text: 'Tôi cần hỏi thêm...',
      stopped: true,
      clarifyCalled: true,
      toolExecutions: [{ name: 'ask_clarification', mutated: false, isError: false }],
    })
    expect(stoppedClarifyWithText.chip).toBe('answer')
    expect(stoppedClarifyWithText.labelKey).toBe('aiResultAnswer')
    expect(stoppedClarifyWithText.stoppedLine).toBe(true)
    expect(stoppedClarifyWithText.stoppedKey).toBe('aiRunStopped')

    const stoppedClarifyNoText = resultChip({
      text: '   ',
      stopped: true,
      clarifyCalled: true,
    })
    expect(stoppedClarifyNoText.chip).toBeNull()
    expect(stoppedClarifyNoText.labelKey).toBeNull()
    expect(stoppedClarifyNoText.stoppedLine).toBe(true)
    expect(stoppedClarifyNoText.stoppedKey).toBe('aiRunStopped')
  })

  it('RF1-10: an error raised during a stopped turn is preserved on errorLine even when there is no text', () => {
    const stoppedSessionErrNoText = resultChip({
      text: '',
      stopped: true,
      error: { code: 'session_expired' },
    })
    expect(stoppedSessionErrNoText.chip).toBeNull()
    expect(stoppedSessionErrNoText.stoppedLine).toBe(true)
    expect(stoppedSessionErrNoText.stoppedKey).toBe('aiRunStopped')
    expect(stoppedSessionErrNoText.errorLine).not.toBeNull()
    expect(stoppedSessionErrNoText.errorLine?.key).toBe('aiErrSession')
    expect(stoppedSessionErrNoText.errorLine?.action).toBe('sign-in')
    expect(stoppedSessionErrNoText.errorLine?.actionKey).toBe('acctSignInAgain')
  })

  it('RF1-13 & RF1-23(a): unsupported chip comes only from x_uniwork.dropped_tool_calls and deduplicates dropped calls', () => {
    // droppedToolCalls is the sole source for the unsupported chip and is deduplicated
    const withBoth = resultChip({
      text: 'Thao tác chưa hỗ trợ.',
      moduleName: 'Sheets',
      droppedToolCalls: [
        { name: 'run_macro', reason: 'not_allowlisted', module: 'Sheets' },
        { name: 'run_macro', reason: 'not_allowlisted', module: 'Sheets' },
      ],
    })
    expect(withBoth.chip).toBe('unsupported')
    expect(withBoth.reasonKey).toBe('aiErrUnsupported')
    expect(withBoth.reasonParams).toEqual({ module: 'Sheets' })
  })

  it('RF1-15 (pinning): step limit run_limit_reached with text yields error chip aiErrRunLimit + aiRunAskAgain action per EXPERIENCE priority (4) and S9 table', () => {
    const stepLimitWithText = resultChip({
      text: 'Đã tóm tắt phần 1 và phần 2 của tài liệu.',
      turnLimit: true,
      error: { code: 'run_limit_reached' },
    })
    expect(stepLimitWithText.chip).toBe('error')
    expect(stepLimitWithText.labelKey).toBe('aiResultError')
    expect(stepLimitWithText.tone).toBe('error')
    expect(stepLimitWithText.errorLine?.key).toBe('aiErrRunLimit')
    expect(stepLimitWithText.errorLine?.action).toBe('ask-again')
    expect(stepLimitWithText.errorLine?.actionKey).toBe('aiRunAskAgain')
  })

  it('RF2-3: an abort-type error during Stop is dropped, while the same error outside Stop is a generic error without Retry', () => {
    for (const error of [
      'AbortError',
      { code: 'ABORT_ERR', message: 'The operation was aborted' },
      { code: 'aborted' },
      { message: 'This operation was aborted' },
      { code: 'cancelled' },
      { code: 'ERR_CANCELED', message: 'canceled' },
    ]) {
      const stoppedNoText = resultChip({ text: '', stopped: true, error })
      expect(stoppedNoText.errorLine, JSON.stringify(error)).toBeNull()
      expect(stoppedNoText.chip).toBeNull()
      expect(stoppedNoText.stoppedKey).toBe('aiRunStopped')
      const stoppedWithText = resultChip({ text: 'partial', stopped: true, error })
      expect(stoppedWithText.errorLine, JSON.stringify(error)).toBeNull()
      expect(stoppedWithText.chip).toBe('answer')
      const notStopped = resultChip({ text: '', error })
      expect(notStopped.errorLine?.key, JSON.stringify(error)).toBe('aiErrGeneric')
      expect(notStopped.errorLine?.action).toBeNull()
    }
    // A real error that happens during Stop is still kept (RF1-10)
    const real = resultChip({ text: '', stopped: true, error: { code: 'timeout' } })
    expect(real.errorLine?.key).toBe('aiErrUnavailable')
  })

  it('RF2-4: an unqualified A1 range needs a left boundary, so ABCDEF1:B2 does not match as DEF1:B2', () => {
    expect(
      extractSheetsCellsMeta([
        { name: 'propose_operations', summary: 'Wrote 4 cells in ABCDEF1:B2' },
      ]),
    ).toBeNull()
    expect(
      extractSheetsCellsMeta([{ name: 'propose_operations', summary: 'Wrote 4 cells in $A$1:B2' }]),
    ).toMatchObject({ range: '$A$1:B2', written: 4 })
    expect(
      extractSheetsCellsMeta([{ name: 'propose_operations', summary: 'Wrote 4 cells (A1:B2)' }]),
    ).toMatchObject({ range: 'A1:B2', written: 4 })
    expect(
      extractSheetsCellsMeta([
        { name: 'propose_operations', summary: 'Wrote 4 cells in Sheet1!B4:C9' },
      ]),
    ).toMatchObject({ sheet: 'Sheet1', range: 'Sheet1!B4:C9' })
  })

  it('RF2-10: dedupe keeps view_only over not_allowlisted for the same tool, and an unknown overwritten count is null, not 0', () => {
    const mixed = resultChip({
      text: 'x',
      moduleName: 'Sheets',
      droppedToolCalls: [
        { name: 'apply_ops', reason: 'not_allowlisted', module: 'Sheets' },
        { name: 'apply_ops', reason: 'view_only', module: 'Sheets' },
      ],
    })
    expect(mixed.chip).toBe('unsupported')
    expect(mixed.reasonKey).toBe('aiErrViewOnlyEdit')

    const unknown = resultChip({
      text: 'x',
      mutated: true,
      cellsMeta: { range: 'A1:B2', written: 4 },
    })
    expect(unknown.meta?.overwritten).toBeUndefined()
    expect(unknown.meta?.cellsMetaParams?.overwritten).toBeNull()

    const known = resultChip({
      text: 'x',
      mutated: true,
      cellsMeta: { range: 'A1:B2', written: 4, overwritten: 0 },
    })
    expect(known.meta?.cellsMetaParams?.overwritten).toBe(0)

    // prose with no overwritten count: unknown stays null
    const prose = extractSheetsCellsMeta([
      { name: 'propose_operations', summary: 'Wrote 12 cells in Sheet1!B4:C9' },
    ])
    expect(prose?.overwritten).toBeUndefined()
  })
})
