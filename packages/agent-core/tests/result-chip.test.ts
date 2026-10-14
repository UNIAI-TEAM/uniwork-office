import { describe, expect, it } from 'vitest';
import {
  classifyDroppedToolReason,
  noticeToPanelNote,
  resultChip,
  extractSheetsCellsMeta,
} from '../src/index.js';

describe('notice-surface structured dropped reasons', () => {
  it('classifies view_only and not_allowlisted reasons while staying backward compatible', () => {
    expect(classifyDroppedToolReason('view_only')).toBe('view_only');
    expect(classifyDroppedToolReason('readonly')).toBe('view_only');
    expect(classifyDroppedToolReason('not_allowlisted')).toBe('not_allowlisted');
    expect(classifyDroppedToolReason('other_reason')).toBe('other');
    expect(classifyDroppedToolReason(undefined)).toBe('other');

    const noteViewOnly = noticeToPanelNote({
      kind: 'dropped_tool_calls',
      calls: [{ name: 'apply_ops', reason: 'view_only' }],
    });
    expect(noteViewOnly).toEqual({
      kind: 'dropped',
      key: 'aiNoticeDroppedTool',
      params: { name: 'apply_ops' },
      reason: 'view_only',
    });

    const noteNotAllowlisted = noticeToPanelNote({
      kind: 'dropped_tool_calls',
      calls: [{ name: 'run_macro', reason: 'not_allowlisted', module: 'Sheets' }],
    });
    expect(noteNotAllowlisted).toEqual({
      kind: 'dropped',
      key: 'aiNoticeDroppedTool',
      params: { name: 'run_macro' },
      reason: 'not_allowlisted',
      module: 'Sheets',
    });
  });
});

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
    });
    expect(res.chip).toBe('edited');
    expect(res.labelKey).toBe('aiResultEdited');
    expect(res.tone).toBe('ok');
    expect(res.viewChangesKey).toBe('aiResultViewChanges');
    expect(res.editedHintKey).toBe('aiResultEditedHint');
    expect(res.meta?.cellsMetaKey).toBe('aiResultCellsMeta');
    expect(res.meta?.cellsMetaParams).toEqual({
      written: 12,
      range: 'Sheet1!B4:C9',
      overwritten: 4,
    });
    expect(res.errorLine).toBeNull();
  });

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
    });
    expect(res.chip).toBe('edited');
    expect(res.labelKey).toBe('aiResultEdited');
    expect(res.tone).toBe('ok');
    expect(res.viewChangesKey).toBe('aiResultViewChanges');
    expect(res.editedHintKey).toBe('aiResultEditedHint');
    expect(res.errorLine).not.toBeNull();
    expect(res.errorLine?.key).toBe('aiErrRunLimit');
    expect(res.errorLine?.action).toBe('ask-again');
    expect(res.errorLine?.actionKey).toBe('aiRunAskAgain');
  });

  it('(2) unsupported from x_uniwork.dropped_tool_calls when no write ran: view_only -> aiErrViewOnlyEdit', () => {
    const res = resultChip({
      text: 'Tài liệu đang ở chế độ chỉ xem.',
      mutated: false,
      droppedToolCalls: [{ name: 'insert_content', reason: 'view_only' }],
    });
    expect(res.chip).toBe('unsupported');
    expect(res.labelKey).toBe('aiResultUnsupported');
    expect(res.tone).toBe('neutral');
    expect(res.reasonKey).toBe('aiErrViewOnlyEdit');
    expect(res.reasonParams).toBeUndefined();
  });

  it('(2) unsupported from x_uniwork.dropped_tool_calls when no write ran: not_allowlisted -> aiErrUnsupported {module}', () => {
    const res = resultChip({
      text: 'Thao tác này chưa được hỗ trợ.',
      mutated: false,
      moduleName: 'Docs',
      droppedToolCalls: [{ name: 'insert_macro', reason: 'not_allowlisted' }],
    });
    expect(res.chip).toBe('unsupported');
    expect(res.labelKey).toBe('aiResultUnsupported');
    expect(res.tone).toBe('neutral');
    expect(res.reasonKey).toBe('aiErrUnsupported');
    expect(res.reasonParams).toEqual({ module: 'Docs' });
  });

  it('(3) clarify only when allowlisted ask_clarification was called and no write or dropped tool calls', () => {
    const res = resultChip({
      text: 'Bạn muốn tóm tắt theo quý hay theo tháng?',
      toolExecutions: [{ name: 'ask_clarification', mutated: false, isError: false }],
    });
    expect(res.chip).toBe('clarify');
    expect(res.labelKey).toBe('aiResultClarify');
    expect(res.tone).toBe('warn');

    // A question mark in plain text without ask_clarification is still 'answer', NOT 'clarify'
    const plainQuestion = resultChip({
      text: 'Bạn có cần thêm chi tiết không?',
    });
    expect(plainQuestion.chip).toBe('answer');
    expect(plainQuestion.labelKey).toBe('aiResultAnswer');
  });

  it('(4) error when the turn ended in an S9 error and no write/unsupported/clarify happened', () => {
    const creditsErr = resultChip({
      text: '',
      error: { code: 'credits_exhausted' },
    });
    expect(creditsErr.chip).toBe('error');
    expect(creditsErr.labelKey).toBe('aiResultError');
    expect(creditsErr.tone).toBe('error');
    expect(creditsErr.errorLine?.key).toBe('aiErrCredits');
    expect(creditsErr.errorLine?.action).toBe('choose-provider');
    expect(creditsErr.errorLine?.actionKey).toBe('aiRunChooseOther');

    const sessionErr = resultChip({
      text: '',
      error: { code: 'session_expired' },
    });
    expect(sessionErr.chip).toBe('error');
    expect(sessionErr.errorLine?.key).toBe('aiErrSession');
    expect(sessionErr.errorLine?.action).toBe('sign-in');
    expect(sessionErr.errorLine?.actionKey).toBe('acctSignInAgain');

    const tooLargeErr = resultChip({
      text: '',
      error: { code: 'workbook_too_large' },
    });
    expect(tooLargeErr.chip).toBe('error');
    expect(tooLargeErr.errorLine?.key).toBe('aiErrWorkbookTooLarge');
    expect(tooLargeErr.errorLine?.action).toBe('open-in-app');
    expect(tooLargeErr.errorLine?.actionKey).toBe('aiRunOpenInApp');

    const rateLimitErr = resultChip({
      text: '',
      error: { code: 'ai_rate_limited' },
    });
    expect(rateLimitErr.chip).toBe('error');
    expect(rateLimitErr.errorLine?.key).toBe('aiErrRateLimitedNoWait');
    expect(rateLimitErr.errorLine?.action).toBe('retry');
  });

  it('(5) answer for normal read/reply turns', () => {
    const res = resultChip({
      text: 'Dưới đây là tóm tắt 3 ý chính của mục 2.',
    });
    expect(res.chip).toBe('answer');
    expect(res.labelKey).toBe('aiResultAnswer');
    expect(res.tone).toBe('info');
    expect(res.stoppedLine).toBe(false);
    expect(res.errorLine).toBeNull();
  });

  it('stop rules: stopped with text -> answer chip + aiRunStopped; stopped with no text -> no chip, only aiRunStopped; stopped after write -> edited chip + aiRunStopped', () => {
    const stoppedWithText = resultChip({
      text: 'Đoạn mở đầu đã được đọc...',
      stopped: true,
    });
    expect(stoppedWithText.chip).toBe('answer');
    expect(stoppedWithText.labelKey).toBe('aiResultAnswer');
    expect(stoppedWithText.stoppedLine).toBe(true);
    expect(stoppedWithText.stoppedKey).toBe('aiRunStopped');

    const stoppedNoText = resultChip({
      text: '   ',
      stopped: true,
    });
    expect(stoppedNoText.chip).toBeNull();
    expect(stoppedNoText.labelKey).toBeNull();
    expect(stoppedNoText.tone).toBeNull();
    expect(stoppedNoText.stoppedLine).toBe(true);
    expect(stoppedNoText.stoppedKey).toBe('aiRunStopped');

    const stoppedAfterWrite = resultChip({
      text: '',
      mutated: true,
      stopped: true,
    });
    expect(stoppedAfterWrite.chip).toBe('edited');
    expect(stoppedAfterWrite.labelKey).toBe('aiResultEdited');
    expect(stoppedAfterWrite.stoppedLine).toBe(true);
    expect(stoppedAfterWrite.stoppedKey).toBe('aiRunStopped');
  });

  it('engine cannot compute (§6.5) -> answer chip with warning in the meta line', () => {
    const res = resultChip({
      text: 'Đã tính tổng từ dữ liệu hiện có.',
      engineCannotCompute: true,
      engineWarning: 'Không thể tự tính công thức mảng động trên phạm vi này.',
    });
    expect(res.chip).toBe('answer');
    expect(res.labelKey).toBe('aiResultAnswer');
    expect(res.tone).toBe('info');
    expect(res.meta?.warnings).toContain(
      'Không thể tự tính công thức mảng động trên phạm vi này.',
    );
  });

  it('returns null chip when provider is BYOK (isUniwork === false)', () => {
    const res = resultChip({
      isUniwork: false,
      provider: 'anthropic',
      text: 'BYOK answer',
      mutated: true,
    });
    expect(res.chip).toBeNull();
    expect(res.labelKey).toBeNull();
  });

  it('extractSheetsCellsMeta extracts range and cell counts from tool summaries/outputs', () => {
    const meta = extractSheetsCellsMeta([
      {
        name: 'propose_operations',
        summary: 'Wrote 12 cells in Sheet1!B4:C9 (4 overwritten)',
        isError: false,
      },
    ]);
    expect(meta).toMatchObject({
      range: 'Sheet1!B4:C9',
      written: 12,
      overwritten: 4,
    });
  });
});
