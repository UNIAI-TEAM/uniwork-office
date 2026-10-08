/**
 * Generate a 10-slide UniWork Office intro deck (Vietnamese).
 * Image-forward: real product screenshots from docs/pitch/assets/.
 * Run: node docs/pitch/generate-uniwork-intro-deck.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PptxGenJS from 'pptxgenjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.join(__dirname, 'UniWork-Office-He-Dieu-Hanh-Cong-Viec.pptx')
const A = (name) => path.join(__dirname, 'assets', name)

const C = {
  ink: '0B1220',
  ink2: '0F172A',
  inkSoft: '334155',
  mute: '64748B',
  paper: 'F4F7FB',
  white: 'FFFFFF',
  accent: '0D9488',
  accentSoft: 'CCFBF1',
  accentDark: '0F766E',
  warm: 'EA580C',
  line: 'E2E8F0',
  mist: 'EEF2FF',
  slate: '1E293B',
}

const pptx = new PptxGenJS()
pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 })
pptx.layout = 'WIDE'
pptx.author = 'UniWork Office'
pptx.title = 'UniWork Office — Hệ điều hành công việc & cuộc sống'
pptx.subject = 'Giới thiệu nền tảng desktop UniWork Office'

const FONT = 'Calibri'

function bg(slide, color = C.paper) {
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.333, h: 7.5,
    fill: { color }, line: { color },
  })
}

function footer(slide, page, total = 10, light = false) {
  slide.addText('UniWork Office  ·  Cài trên máy  ·  Dữ liệu của bạn', {
    x: 0.5, y: 7.12, w: 10, h: 0.26,
    fontSize: 10, color: light ? '94A3B8' : C.mute, fontFace: FONT,
  })
  slide.addText(`${page} / ${total}`, {
    x: 11.5, y: 7.12, w: 1.4, h: 0.26,
    fontSize: 10, color: light ? '94A3B8' : C.mute, fontFace: FONT, align: 'right',
  })
}

function shot(slide, file, x, y, w, h) {
  // Soft frame behind image
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: x - 0.04, y: y - 0.04, w: w + 0.08, h: h + 0.08,
    fill: { color: C.white },
    line: { color: C.line, width: 1 },
    shadow: { type: 'outer', color: '0F172A', blur: 18, opacity: 0.18, offset: 4 },
    rectRadius: 0.1,
  })
  slide.addImage({
    path: A(file),
    x, y, w, h,
    sizing: { type: 'cover', w, h },
  })
}

function pill(slide, text, x, y, w = 2.2) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h: 0.32,
    fill: { color: C.accentSoft },
    line: { color: C.accentSoft },
    rectRadius: 0.16,
  })
  slide.addText(text, {
    x, y, w, h: 0.32,
    fontSize: 11, bold: true, color: C.accentDark, fontFace: FONT,
    align: 'center', valign: 'middle',
  })
}

// ─── 1. Title — cinematic split ─────────────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.ink)
  // Product hero on right
  s.addImage({
    path: A('hero.png'),
    x: 5.6, y: 0, w: 7.733, h: 7.5,
    sizing: { type: 'cover', w: 7.733, h: 7.5 },
  })
  // Gradient veil
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 5.2, y: 0, w: 1.2, h: 7.5,
    fill: { color: C.ink, transparency: 20 },
    line: { color: C.ink, transparency: 100 },
  })
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 6.2, h: 7.5,
    fill: { color: C.ink },
    line: { color: C.ink },
  })
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.14, h: 7.5,
    fill: { color: C.accent }, line: { color: C.accent },
  })
  s.addText('UNIWORK OFFICE', {
    x: 0.7, y: 1.55, w: 5.2, h: 0.35,
    fontSize: 13, bold: true, color: C.accentSoft, fontFace: FONT, charSpacing: 5,
  })
  s.addText('Hệ điều hành công việc\nvà quản trị cuộc sống', {
    x: 0.7, y: 2.05, w: 5.2, h: 1.7,
    fontSize: 32, bold: true, color: C.white, fontFace: FONT,
  })
  s.addText(
    'Cài trực tiếp trên máy · Dữ liệu ở lại với bạn\nOffice đủ dùng + Workbench + My AI có kiểm soát\nGiảm phụ thuộc bản quyền Microsoft Office',
    {
      x: 0.7, y: 4.0, w: 5.0, h: 1.3,
      fontSize: 14, color: 'CBD5E1', fontFace: FONT,
    },
  )
  pill(s, 'Desktop-native', 0.7, 5.55, 1.7)
  pill(s, 'Local-first', 2.55, 5.55, 1.45)
  pill(s, 'OOXML chuẩn', 4.15, 5.55, 1.5)
  s.addText('1 / 10', {
    x: 0.7, y: 7.1, w: 1.2, h: 0.26,
    fontSize: 10, color: '94A3B8', fontFace: FONT,
  })
}

// ─── 2. Problem — with muted product backdrop ───────────────
{
  const s = pptx.addSlide()
  bg(s, C.paper)
  s.addImage({
    path: A('hero-dark.png'),
    x: 8.5, y: 1.4, w: 5.5, h: 5.2,
    sizing: { type: 'cover', w: 5.5, h: 5.2 },
    transparency: 72,
  })
  s.addText('BÀI TOÁN', {
    x: 0.55, y: 0.4, w: 4, h: 0.3,
    fontSize: 12, bold: true, color: C.accentDark, fontFace: FONT, charSpacing: 3,
  })
  s.addText('Người làm việc cá nhân\nbị kẹt giữa suite doanh nghiệp\nvà hàng tá app rời', {
    x: 0.55, y: 0.75, w: 7.5, h: 1.55,
    fontSize: 28, bold: true, color: C.ink2, fontFace: FONT,
  })

  const pains = [
    { t: 'Bản quyền đắt', d: 'MS 365 theo năm, nhân theo máy — dù chỉ cần Word–Excel–Slide.' },
    { t: 'Data lên mây mặc định', d: 'Tài liệu & đời sống dễ bị kéo vào cloud nhà cung cấp.' },
    { t: 'Công cụ mảnh vụn', d: 'Soạn thảo một nơi, việc–sức khỏe–tài chính chỗ khác.' },
    { t: 'Phụ thuộc online', d: 'Mất mạng là đứt nhịp; cá nhân cần chủ động trên máy mình.' },
  ]
  pains.forEach((p, i) => {
    const y = 2.55 + i * 1.05
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.55, y, w: 7.6, h: 0.92,
      fill: { color: C.white },
      line: { color: C.line, width: 1 },
      shadow: { type: 'outer', color: '0F172A', blur: 10, opacity: 0.08, offset: 2 },
      rectRadius: 0.1,
    })
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.7, y: y + 0.28, w: 0.12, h: 0.36,
      fill: { color: i === 0 ? C.warm : C.accent },
      line: { color: i === 0 ? C.warm : C.accent },
      rectRadius: 0.06,
    })
    s.addText(p.t, {
      x: 1.05, y: y + 0.14, w: 6.8, h: 0.32,
      fontSize: 15, bold: true, color: C.ink2, fontFace: FONT,
    })
    s.addText(p.d, {
      x: 1.05, y: y + 0.48, w: 6.8, h: 0.32,
      fontSize: 13, color: C.inkSoft, fontFace: FONT,
    })
  })
  footer(s, 2)
}

// ─── 3. What is UniWork — product proof ─────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.white)
  s.addText('GIẢI PHÁP', {
    x: 0.5, y: 0.35, w: 4, h: 0.28,
    fontSize: 12, bold: true, color: C.accentDark, fontFace: FONT, charSpacing: 3,
  })
  s.addText('UniWork Office là gì?', {
    x: 0.5, y: 0.68, w: 6.2, h: 0.5,
    fontSize: 26, bold: true, color: C.ink2, fontFace: FONT,
  })
  s.addText(
    'Desktop cài trên máy bạn — bộ Office chuẩn + Workbench quản trị công việc & cuộc sống + My AI điều phối.',
    {
      x: 0.5, y: 1.25, w: 6.0, h: 0.7,
      fontSize: 14, color: C.inkSoft, fontFace: FONT,
    },
  )

  const pillars = [
    { n: '01', t: 'Office trên máy', d: 'Word · Excel · PPT · PDF — file chuẩn, offline.' },
    { n: '02', t: 'Workbench theo vai', d: 'Sales, Teacher, Legal, IT… tri thức & việc.' },
    { n: '03', t: 'My AI điều phối', d: 'Tạo file, mở Recent, playbook — có xác nhận Token.' },
    { n: '04', t: 'Đời sống cá nhân', d: 'Tài chính, sức khỏe, gia đình — cùng một không gian.' },
  ]
  pillars.forEach((p, i) => {
    const y = 2.15 + i * 1.1
    s.addText(p.n, {
      x: 0.5, y: y + 0.1, w: 0.7, h: 0.4,
      fontSize: 18, bold: true, color: C.accent, fontFace: FONT,
    })
    s.addText(p.t, {
      x: 1.3, y: y + 0.05, w: 5.2, h: 0.35,
      fontSize: 16, bold: true, color: C.ink2, fontFace: FONT,
    })
    s.addText(p.d, {
      x: 1.3, y: y + 0.42, w: 5.2, h: 0.35,
      fontSize: 13, color: C.inkSoft, fontFace: FONT,
    })
  })

  shot(s, 'docs-ai.png', 6.9, 0.9, 5.9, 5.7)
  footer(s, 3)
}

// ─── 4. Local-first — desktop proof ─────────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.ink2)
  s.addText('LOCAL-FIRST', {
    x: 0.55, y: 0.4, w: 5, h: 0.28,
    fontSize: 12, bold: true, color: C.accentSoft, fontFace: FONT, charSpacing: 3,
  })
  s.addText('Cài trên máy —\ndữ liệu thuộc về bạn', {
    x: 0.55, y: 0.75, w: 6.2, h: 1.2,
    fontSize: 28, bold: true, color: C.white, fontFace: FONT,
  })
  s.addText('Không bắt buộc đưa cuộc sống lên đám mây bên thứ ba để “được dùng app”.', {
    x: 0.55, y: 2.1, w: 6.0, h: 0.55,
    fontSize: 14, color: '94A3B8', fontFace: FONT,
  })

  const pts = [
    ['Desktop-native', 'Electron trên macOS / Windows / Linux. File .docx .xlsx .pptx .pdf trên ổ đĩa bạn.'],
    ['Workbench local', 'Việc, lịch, email nháp, khách, tài chính, sức khỏe lưu trên thiết bị.'],
    ['AI có kiểm soát', 'Token / Hub chỉ khi bạn xác nhận. Đọc excerpt có consent.'],
    ['Backup do bạn chọn', 'Xuất / nhập trên máy. Cloud sync là lựa chọn — không bắt buộc.'],
  ]
  pts.forEach((p, i) => {
    const y = 2.85 + i * 0.95
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.55, y, w: 6.1, h: 0.85,
      fill: { color: C.slate },
      line: { color: '334155', width: 1 },
      rectRadius: 0.1,
    })
    s.addText(p[0], {
      x: 0.8, y: y + 0.1, w: 5.6, h: 0.28,
      fontSize: 14, bold: true, color: C.accentSoft, fontFace: FONT,
    })
    s.addText(p[1], {
      x: 0.8, y: y + 0.42, w: 5.6, h: 0.32,
      fontSize: 12, color: 'CBD5E1', fontFace: FONT,
    })
  })

  shot(s, 'sheets-qa.png', 7.0, 0.85, 5.85, 5.75)
  footer(s, 4, 10, true)
}

// ─── 5. Cost — before/after with product ────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.paper)
  s.addText('GIÁ TRỊ', {
    x: 0.5, y: 0.35, w: 4, h: 0.28,
    fontSize: 12, bold: true, color: C.accentDark, fontFace: FONT, charSpacing: 3,
  })
  s.addText('Giảm chi phí bản quyền Microsoft Office', {
    x: 0.5, y: 0.68, w: 12, h: 0.5,
    fontSize: 26, bold: true, color: C.ink2, fontFace: FONT,
  })
  s.addText('Một bộ Office đủ dùng hàng ngày — không khóa bạn vào thuê bao theo ghế ngồi.', {
    x: 0.5, y: 1.25, w: 12, h: 0.4,
    fontSize: 14, color: C.inkSoft, fontFace: FONT,
  })

  // Before
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 1.85, w: 5.9, h: 4.85,
    fill: { color: C.white },
    line: { color: C.line, width: 1 },
    rectRadius: 0.12,
  })
  s.addText('Trước đây', {
    x: 0.8, y: 2.1, w: 5.3, h: 0.35,
    fontSize: 16, bold: true, color: C.warm, fontFace: FONT,
  })
  ;[
    'Thuê bao Microsoft 365 / Office theo năm',
    'Phụ thuộc OneDrive & tài khoản Microsoft',
    'Chi phí nhân theo máy & người dùng',
    '“Đời sống” phải mua thêm app khác',
  ].forEach((t, i) => {
    s.addText(`—  ${t}`, {
      x: 0.8, y: 2.65 + i * 0.55, w: 5.3, h: 0.45,
      fontSize: 14, color: C.inkSoft, fontFace: FONT,
    })
  })

  // After with image
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 6.85, y: 1.85, w: 5.95, h: 4.85,
    fill: { color: C.accentSoft },
    line: { color: C.accent, width: 1.5 },
    rectRadius: 0.12,
  })
  s.addText('Với UniWork Office', {
    x: 7.15, y: 2.05, w: 5.4, h: 0.35,
    fontSize: 16, bold: true, color: C.accentDark, fontFace: FONT,
  })
  s.addImage({
    path: A('slides-cover.png'),
    x: 7.15, y: 2.5, w: 5.4, h: 2.55,
    sizing: { type: 'cover', w: 5.4, h: 2.55 },
  })
  ;[
    'Docs · Sheets · Slides · PDF trên máy',
    'File OOXML — trao đổi bình thường',
    'AI khi cần, có xác nhận Token',
  ].forEach((t, i) => {
    s.addText(`▸  ${t}`, {
      x: 7.15, y: 5.25 + i * 0.35, w: 5.4, h: 0.32,
      fontSize: 13, color: C.ink2, fontFace: FONT,
    })
  })
  footer(s, 5)
}

// ─── 6. Office gallery — 4 real shots ───────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.ink)
  s.addText('OFFICE & MY AI', {
    x: 0.5, y: 0.28, w: 6, h: 0.26,
    fontSize: 12, bold: true, color: C.accentSoft, fontFace: FONT, charSpacing: 3,
  })
  s.addText('Làm việc đủ nhịp — bằng ảnh thật sản phẩm', {
    x: 0.5, y: 0.55, w: 12, h: 0.4,
    fontSize: 24, bold: true, color: C.white, fontFace: FONT,
  })

  const gallery = [
    { f: 'docs-ai.png', t: 'UniWork Docs', d: 'Soạn thảo Word + panel AI' },
    { f: 'sheets-qa.png', t: 'UniWork Sheets', d: 'Excel + phân tích có trích dẫn ô' },
    { f: 'slides-ai.png', t: 'UniWork Slides', d: 'PPTX · pitch · giáo án' },
    { f: 'pdf-edit.png', t: 'UniWork PDF', d: 'Xem / chỉnh PDF trên máy' },
  ]
  gallery.forEach((g, i) => {
    const x = 0.4 + (i % 2) * 6.45
    const y = 1.15 + Math.floor(i / 2) * 2.85
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 6.2, h: 2.65,
      fill: { color: C.slate },
      line: { color: '334155', width: 1 },
      rectRadius: 0.12,
    })
    s.addImage({
      path: A(g.f),
      x: x + 0.12, y: y + 0.12, w: 6.0 - 0.04, h: 1.85,
      sizing: { type: 'cover', w: 5.96, h: 1.85 },
    })
    s.addText(g.t, {
      x: x + 0.25, y: y + 2.05, w: 3.5, h: 0.28,
      fontSize: 14, bold: true, color: C.white, fontFace: FONT,
    })
    s.addText(g.d, {
      x: x + 0.25, y: y + 2.32, w: 5.6, h: 0.24,
      fontSize: 12, color: '94A3B8', fontFace: FONT,
    })
  })
  footer(s, 6, 10, true)
}

// ─── 7. Workbench / life OS ─────────────────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.paper)
  s.addText('WORKBENCH', {
    x: 0.5, y: 0.3, w: 5, h: 0.26,
    fontSize: 12, bold: true, color: C.accentDark, fontFace: FONT, charSpacing: 3,
  })
  s.addText('Hệ điều hành hàng ngày', {
    x: 0.5, y: 0.58, w: 6, h: 0.45,
    fontSize: 26, bold: true, color: C.ink2, fontFace: FONT,
  })
  s.addText('Một “My Space” gom việc làm và đời sống — không bắt bạn sống trong mười ứng dụng.', {
    x: 0.5, y: 1.1, w: 6.0, h: 0.55,
    fontSize: 13, color: C.inkSoft, fontFace: FONT,
  })

  const mods = [
    'Desk', 'Tasks / Notes', 'Calendar',
    'Email local', 'Clients', 'Finance',
    'Health', 'Family / Pets', 'Travel / Growth',
  ]
  mods.forEach((m, i) => {
    const x = 0.5 + (i % 3) * 2.05
    const y = 1.85 + Math.floor(i / 3) * 0.7
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 1.95, h: 0.55,
      fill: { color: C.white },
      line: { color: C.line, width: 1 },
      rectRadius: 0.1,
    })
    s.addText(m, {
      x, y, w: 1.95, h: 0.55,
      fontSize: 12, bold: true, color: C.accentDark, fontFace: FONT,
      align: 'center', valign: 'middle',
    })
  })

  s.addText('Dashboard / HTML workspace — minh họa bề mặt đời sống & số liệu cá nhân trên máy.', {
    x: 0.5, y: 4.15, w: 6.0, h: 0.55,
    fontSize: 12, color: C.mute, fontFace: FONT,
  })
  s.addText('My AI trên Home điều phối: tạo file · mở Recent · thêm việc · playbook nhiều bước.', {
    x: 0.5, y: 4.75, w: 6.0, h: 0.55,
    fontSize: 13, color: C.inkSoft, fontFace: FONT,
  })
  pill(s, 'Local storage', 0.5, 5.55, 1.55)
  pill(s, 'Theo Practice', 2.2, 5.55, 1.5)
  pill(s, 'Có consent', 3.85, 5.55, 1.35)

  shot(s, 'html-dashboard.png', 6.85, 0.85, 5.95, 5.75)
  footer(s, 7)
}

// ─── 8. Audiences — with product strip ──────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.white)
  s.addImage({
    path: A('cli-slides-grid.png'),
    x: 0, y: 0, w: 13.333, h: 2.35,
    sizing: { type: 'cover', w: 13.333, h: 2.35 },
  })
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.333, h: 2.35,
    fill: { color: C.ink, transparency: 35 },
    line: { color: C.ink, transparency: 100 },
  })
  s.addText('ĐỐI TƯỢNG', {
    x: 0.55, y: 0.55, w: 5, h: 0.28,
    fontSize: 12, bold: true, color: C.accentSoft, fontFace: FONT, charSpacing: 3,
  })
  s.addText('Cá nhân & nhóm nhỏ — vừa làm nghề, vừa quản trị đời sống', {
    x: 0.55, y: 0.95, w: 12, h: 0.55,
    fontSize: 24, bold: true, color: C.white, fontFace: FONT,
  })

  const audiences = [
    { t: 'Freelancer & doanh nhân', d: 'Báo giá, pitch, hóa đơn, follow-up khách.' },
    { t: 'Giáo viên & nhà trường', d: 'Giáo án, slide, skill sư phạm, Hub khi cần.' },
    { t: 'Sales · CSKH · Marketing', d: 'Playbook quote / campaign / Clients.' },
    { t: 'Legal · Procurement · BĐS', d: 'Hợp đồng, RFP, listing trên máy.' },
    { t: 'HR · Kế toán · IT', d: 'Offer, onboarding, hóa đơn, runbook.' },
    { t: 'Cá nhân có hệ thống', d: 'Việc + sức khỏe + gia đình + tài chính.' },
  ]
  audiences.forEach((a, i) => {
    const x = 0.45 + (i % 3) * 4.25
    const y = 2.65 + Math.floor(i / 3) * 2.0
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 4.05, h: 1.8,
      fill: { color: C.paper },
      line: { color: C.line, width: 1 },
      shadow: { type: 'outer', color: '0F172A', blur: 10, opacity: 0.07, offset: 2 },
      rectRadius: 0.12,
    })
    s.addText(a.t, {
      x: x + 0.25, y: y + 0.35, w: 3.55, h: 0.55,
      fontSize: 15, bold: true, color: C.ink2, fontFace: FONT,
    })
    s.addText(a.d, {
      x: x + 0.25, y: y + 1.0, w: 3.55, h: 0.5,
      fontSize: 13, color: C.inkSoft, fontFace: FONT,
    })
  })
  footer(s, 8)
}

// ─── 9. Flexibility — AI shot ───────────────────────────────
{
  const s = pptx.addSlide()
  bg(s, C.paper)
  shot(s, 'slides-generate.png', 7.0, 0.9, 5.85, 5.7)

  s.addText('LINH HOẠT', {
    x: 0.5, y: 0.4, w: 5, h: 0.28,
    fontSize: 12, bold: true, color: C.accentDark, fontFace: FONT, charSpacing: 3,
  })
  s.addText('Dùng theo nhịp\ncủa bạn', {
    x: 0.5, y: 0.75, w: 6.2, h: 1.15,
    fontSize: 28, bold: true, color: C.ink2, fontFace: FONT,
  })
  s.addText('Không ép quy trình doanh nghiệp. Bạn chọn độ sâu.', {
    x: 0.5, y: 2.05, w: 6.0, h: 0.4,
    fontSize: 14, color: C.inkSoft, fontFace: FONT,
  })

  const rows = [
    { t: 'Theo vai (Practice)', d: 'Sales → Teacher → IT: Workbench & playbook đổi theo nghề.' },
    { t: 'Theo gói Tri thức', d: 'Mỗi dự án / lớp / vụ việc là một pack tài liệu & skill.' },
    { t: 'Theo mức AI', d: 'Soạn tay miễn phí; AI chỉ khi Cho phép / dùng Token.' },
    { t: 'Theo nhịp online', d: 'Offline đầy đủ; Hub / cloud là lớp bổ sung khi sẵn sàng.' },
  ]
  rows.forEach((r, i) => {
    const y = 2.6 + i * 1.0
    s.addShape(pptx.shapes.OVAL, {
      x: 0.55, y: y + 0.2, w: 0.38, h: 0.38,
      fill: { color: C.accent }, line: { color: C.accent },
    })
    s.addText(String(i + 1), {
      x: 0.55, y: y + 0.22, w: 0.38, h: 0.34,
      fontSize: 12, bold: true, color: C.white, fontFace: FONT, align: 'center',
    })
    s.addText(r.t, {
      x: 1.15, y: y + 0.08, w: 5.4, h: 0.3,
      fontSize: 15, bold: true, color: C.ink2, fontFace: FONT,
    })
    s.addText(r.d, {
      x: 1.15, y: y + 0.42, w: 5.4, h: 0.35,
      fontSize: 12, color: C.inkSoft, fontFace: FONT,
    })
  })
  footer(s, 9)
}

// ─── 10. Close — full-bleed product ─────────────────────────
{
  const s = pptx.addSlide()
  s.addImage({
    path: A('hero-dark.png'),
    x: 0, y: 0, w: 13.333, h: 7.5,
    sizing: { type: 'cover', w: 13.333, h: 7.5 },
  })
  // Heavy veil so product photo stays atmospheric without competing brand text
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.333, h: 7.5,
    fill: { color: C.ink, transparency: 18 },
    line: { color: C.ink, transparency: 100 },
  })
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.14, h: 7.5,
    fill: { color: C.accent }, line: { color: C.accent },
  })
  s.addText('KẾT LẠI', {
    x: 0.7, y: 1.35, w: 11, h: 0.3,
    fontSize: 13, bold: true, color: C.accentSoft, fontFace: FONT, charSpacing: 4,
  })
  s.addText('Một hệ điều hành cho\ncông việc và cuộc sống', {
    x: 0.7, y: 1.8, w: 11.5, h: 1.4,
    fontSize: 34, bold: true, color: C.white, fontFace: FONT,
  })

  const closes = [
    'Cài trên máy — không bị cầm tù bởi trình duyệt',
    'Dữ liệu cá nhân ưu tiên ở lại thiết bị của bạn',
    'Office đủ dùng + Workbench đời sống + My AI có kiểm soát',
    'Giảm phụ thuộc thuê bao Microsoft Office cho cá nhân & nhóm nhỏ',
  ]
  closes.forEach((t, i) => {
    s.addText(`▸   ${t}`, {
      x: 0.7, y: 3.55 + i * 0.5, w: 11.5, h: 0.42,
      fontSize: 16, color: 'E2E8F0', fontFace: FONT,
    })
  })
  s.addText('UniWork Office  ·  10 / 10', {
    x: 0.7, y: 7.05, w: 11.5, h: 0.28,
    fontSize: 11, color: '94A3B8', fontFace: FONT,
  })
}

await pptx.writeFile({ fileName: outPath })
console.log(`Wrote ${outPath}`)
