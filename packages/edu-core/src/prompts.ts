import type { EduMeta, EduWorkflowId } from './types.js'

function contextBlock(meta: EduMeta): string {
  const lines = [
    `Môn: ${meta.subject}`,
    `Lớp: ${meta.grade}`,
    meta.week ? `Tuần: ${meta.week}` : null,
    `Bài: ${meta.lessonTitle}`,
    typeof meta.durationMinutes === 'number' ? `Thời lượng: ${meta.durationMinutes} phút` : null,
    meta.objectives.length > 0 ? `Mục tiêu: ${meta.objectives.join('; ')}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

/** Prompt the teacher can paste into uniAI, or that Home can seed as intent. */
export function eduWorkflowPrompt(workflowId: EduWorkflowId, meta: EduMeta): string {
  const ctx = contextBlock(meta)
  switch (workflowId) {
    case 'draft-lesson-plan':
      return [
        'Bạn là trợ lý soạn giáo án theo Chương trình GDPT 2018 (Việt Nam).',
        'Hãy hoàn thiện giáo án trong tài liệu hiện tại dựa trên khung sẵn có.',
        'Viết rõ mục tiêu (kiến thức, năng lực, phẩm chất), đồ dùng, và tiến trình từng hoạt động với thời gian gợi ý.',
        'Giọng văn sư phạm, ngắn gọn, có thể mang vào lớp dạy ngay.',
        '',
        'Thông tin bài:',
        ctx,
      ].join('\n')
    case 'slides-from-plan':
      return [
        'Bạn là trợ lý thiết kế slide bài giảng cho giáo viên phổ thông Việt Nam.',
        'Tạo bộ slide rõ ràng: trang mở đầu, mục tiêu, nội dung từng hoạt động, luyện tập, củng cố, và kết thúc.',
        'Mỗi slide ngắn, chữ lớn, ưu tiên gạch đầu dòng; tránh đoạn văn dài.',
        'Dựa trên thông tin bài dưới đây (và giáo án trong project nếu có).',
        '',
        'Thông tin bài:',
        ctx,
      ].join('\n')
    case 'worksheet-from-plan':
      return [
        'Bạn là trợ lý soạn phiếu học tập / bài tập theo bài học.',
        'Hoàn thiện phiếu trong tài liệu: câu hỏi phân tầng nhận biết → thông hiểu → vận dụng → vận dụng cao.',
        'Phù hợp thời lượng tiết học; ghi rõ yêu cầu từng phần.',
        '',
        'Thông tin bài:',
        ctx,
      ].join('\n')
    case 'lesson-chain-templates':
      return ''
  }
}

/** Short system-prompt addendum when a file belongs to an education project. */
export function eduSystemPromptAddendum(meta: EduMeta): string {
  return [
    'Context: this document belongs to a UniWork Office teacher lesson pack.',
    `Subject=${meta.subject}; Grade=${meta.grade}; Lesson=${meta.lessonTitle}.`,
    'Prefer Vietnamese pedagogical structure aligned with CTGDPT 2018.',
    'Do not invent copyrighted textbook passages verbatim; paraphrase and original exercises only.',
  ].join(' ')
}
