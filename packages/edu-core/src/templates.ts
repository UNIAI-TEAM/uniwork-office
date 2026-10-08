import type { EduMeta, EduTemplateId } from './types.js'

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function metaBlock(meta: EduMeta): string {
  const week = meta.week ? `<p><strong>Tuần:</strong> ${esc(meta.week)}</p>` : ''
  const duration =
    typeof meta.durationMinutes === 'number'
      ? `<p><strong>Thời lượng:</strong> ${meta.durationMinutes} phút</p>`
      : ''
  const objectives =
    meta.objectives.length > 0
      ? `<ul>${meta.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`
      : '<p><em>(Điền chuẩn đầu ra / mục tiêu)</em></p>'
  return `
    <p><strong>Môn:</strong> ${esc(meta.subject)} &nbsp;|&nbsp; <strong>Lớp:</strong> ${esc(meta.grade)}</p>
    ${week}
    ${duration}
    <p><strong>Bài:</strong> ${esc(meta.lessonTitle)}</p>
    <h2>Mục tiêu / chuẩn đầu ra</h2>
    ${objectives}
  `
}

/** HTML outlines seeded into Docs tabs for education templates. */
export function eduTemplateHtml(templateId: EduTemplateId, meta: EduMeta): string | null {
  switch (templateId) {
    case 'giao-an':
      return `
        <h1>GIÁO ÁN</h1>
        <p><em>Theo định hướng Chương trình GDPT 2018 — khung soạn trên máy, không bắt buộc dùng AI.</em></p>
        ${metaBlock(meta)}
        <h2>I. Mục tiêu</h2>
        <h3>1. Kiến thức</h3>
        <ul><li></li><li></li></ul>
        <h3>2. Năng lực</h3>
        <ul><li>Năng lực chung:</li><li>Năng lực đặc thù:</li></ul>
        <h3>3. Phẩm chất</h3>
        <ul><li></li></ul>
        <h2>II. Thiết bị / học liệu</h2>
        <p>Giáo viên:</p>
        <p>Học sinh:</p>
        <h2>III. Tiến trình dạy học</h2>
        <h3>1. Khởi động (≈ 5 phút)</h3>
        <p><strong>Mục tiêu hoạt động:</strong></p>
        <p><strong>Tổ chức:</strong></p>
        <p><strong>Sản phẩm:</strong></p>
        <h3>2. Hình thành kiến thức mới</h3>
        <p><strong>Mục tiêu hoạt động:</strong></p>
        <p><strong>Tổ chức:</strong></p>
        <p><strong>Sản phẩm:</strong></p>
        <h3>3. Luyện tập</h3>
        <p><strong>Mục tiêu hoạt động:</strong></p>
        <p><strong>Tổ chức:</strong></p>
        <p><strong>Sản phẩm:</strong></p>
        <h3>4. Vận dụng / củng cố / dặn dò</h3>
        <p><strong>Mục tiêu hoạt động:</strong></p>
        <p><strong>Tổ chức:</strong></p>
        <p><strong>Sản phẩm:</strong></p>
        <h2>IV. Điều chỉnh sau tiết</h2>
        <p>Nội dung cần bổ sung:</p>
        <p>Học sinh cần hỗ trợ thêm:</p>
      `.trim()
    case 'khdh':
      return `
        <h1>KẾ HOẠCH BÀI DẠY</h1>
        <p><em>Khung hoạt động — có thể nộp / mang đi dạy trực tiếp.</em></p>
        ${metaBlock(meta)}
        <h2>1. Yêu cầu cần đạt</h2>
        <p></p>
        <h2>2. Đồ dùng dạy học</h2>
        <p></p>
        <h2>3. Các hoạt động dạy học</h2>
        <table>
          <thead><tr><th>Hoạt động</th><th>Thời gian</th><th>Tổ chức</th><th>Sản phẩm</th></tr></thead>
          <tbody>
            <tr><td>Khởi động</td><td>5'</td><td></td><td></td></tr>
            <tr><td>Khám phá / hình thành KT</td><td></td><td></td><td></td></tr>
            <tr><td>Luyện tập</td><td></td><td></td><td></td></tr>
            <tr><td>Vận dụng / củng cố</td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <h2>4. Điều chỉnh</h2>
        <p></p>
      `.trim()
    case 'phieu-hoc-tap':
      return `
        <h1>PHIẾU HỌC TẬP</h1>
        ${metaBlock(meta)}
        <p><strong>Họ và tên:</strong> ........................ &nbsp;&nbsp; <strong>Lớp:</strong> ........</p>
        <h2>Phần A — Nhận biết / thông hiểu</h2>
        <ol>
          <li></li>
          <li></li>
          <li></li>
        </ol>
        <h2>Phần B — Vận dụng</h2>
        <ol>
          <li></li>
          <li></li>
        </ol>
        <h2>Phần C — Vận dụng cao</h2>
        <ol>
          <li></li>
        </ol>
        <h2>Đáp án gợi ý (giáo viên)</h2>
        <p><em>Phần này có thể ẩn khi in cho học sinh.</em></p>
        <p>A:</p>
        <p>B:</p>
        <p>C:</p>
      `.trim()
    case 'slide':
    case 'ppct':
      return null
  }
}

/** Extra HTML seeds for material roles not in EduTemplateId. */
export function eduMaterialSeedHtml(role: string, meta: EduMeta): string | null {
  if (role === 'de-kiem-tra') {
    return `
      <h1>ĐỀ KIỂM TRA / ĐÁNH GIÁ</h1>
      ${metaBlock(meta)}
      <p><strong>Thời gian:</strong> …… phút &nbsp;|&nbsp; <strong>Hình thức:</strong> ……</p>
      <h2>I. Trắc nghiệm</h2>
      <ol><li></li><li></li><li></li><li></li></ol>
      <h2>II. Tự luận</h2>
      <ol><li></li><li></li></ol>
      <h2>Đáp án / biểu điểm (GV)</h2>
      <p></p>
    `.trim()
  }
  if (role === 'tai-lieu-tham-khao') {
    return `
      <h1>TÀI LIỆU THAM KHẢO / TÓM TẮT</h1>
      ${metaBlock(meta)}
      <h2>Ý chính</h2>
      <ul><li></li><li></li></ul>
      <h2>Từ khóa</h2>
      <p></p>
      <h2>Câu hỏi ôn</h2>
      <ol><li></li><li></li><li></li></ol>
    `.trim()
  }
  return eduTemplateHtml(role as EduTemplateId, meta)
}

export function eduTemplateTitle(templateId: EduTemplateId, meta: EduMeta): string {
  const map: Record<EduTemplateId, string> = {
    'giao-an': `Giáo án — ${meta.lessonTitle}`,
    khdh: `KHDH — ${meta.lessonTitle}`,
    slide: `Bài giảng — ${meta.lessonTitle}`,
    'phieu-hoc-tap': `Phiếu HT — ${meta.lessonTitle}`,
    ppct: `PPCT — ${meta.subject} ${meta.grade}`,
  }
  return map[templateId]
}

export function eduMaterialSeedTitle(role: string, meta: EduMeta): string {
  if (role === 'de-kiem-tra') return `Đề KT — ${meta.lessonTitle}`
  if (role === 'tai-lieu-tham-khao') return `Tham khảo — ${meta.lessonTitle}`
  if (role === 'khac') return `Học liệu — ${meta.lessonTitle}`
  const known: EduTemplateId[] = ['giao-an', 'khdh', 'slide', 'phieu-hoc-tap', 'ppct']
  if (known.includes(role as EduTemplateId)) {
    return eduTemplateTitle(role as EduTemplateId, meta)
  }
  return `Học liệu — ${meta.lessonTitle}`
}
