/**
 * Built-in deck templates for the AI gallery.
 * Each template provides a fixed page structure + style hint; the user's topic
 * fills the briefs, then generate_deck(builtin_template + topic) produces the deck.
 */

export type DeckTemplatePageType = 'cover' | 'content' | 'data' | 'closing'

export interface DeckTemplatePage {
  /** Default title; `{topic}` is replaced with the user topic */
  title: string
  type: DeckTemplatePageType
  layout: string
  /** Brief the page designer follows; `{topic}` substituted */
  brief: string
  image_queries?: string[]
}

export interface DeckTemplate {
  id: string
  /** Accent for gallery card (CSS color — only used in chrome, not slide content) */
  accent: string
  labelVi: string
  labelEn: string
  labelZh: string
  descVi: string
  descEn: string
  descZh: string
  /** Approx page count shown in the gallery */
  approxPages: number
  /** Design-system hint passed to generate_deck as `style` */
  style: string
  /** Narrative anchor; `{topic}` substituted */
  coreHook: string
  pages: DeckTemplatePage[]
}

function sub(text: string, topic: string): string {
  return text.split('{topic}').join(topic.trim() || 'this presentation')
}

export const DECK_TEMPLATES: readonly DeckTemplate[] = [
  {
    id: 'pitch-deck',
    accent: '#2563eb',
    labelVi: 'Pitch deck startup',
    labelEn: 'Startup pitch deck',
    labelZh: '创业路演',
    descVi: 'Vấn đề → giải pháp → thị trường → sản phẩm → đội ngũ → kêu gọi',
    descEn: 'Problem → solution → market → product → team → ask',
    descZh: '问题→方案→市场→产品→团队→融资诉求',
    approxPages: 8,
    style:
      'Modern startup pitch: deep navy (#0f172a) + electric blue (#2563eb) accents, white cards, bold sans titles (Inter/Segoe), generous margins, high-contrast KPIs, minimal decoration.',
    coreHook: 'A crisp investor narrative for {topic}',
    pages: [
      {
        title: '{topic}',
        type: 'cover',
        layout: 'title-hero',
        brief: 'Cover for {topic}: punchy one-line value prop + subtitle for audience (investors).',
        image_queries: ['startup innovation abstract'],
      },
      {
        title: 'The problem',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Pain points {topic} solves — 3 concrete customer pains with stakes.',
      },
      {
        title: 'Our solution',
        type: 'content',
        layout: 'three-column-cards',
        brief: 'How {topic} solves it — 3 pillars with short outcomes, not features dump.',
      },
      {
        title: 'Market opportunity',
        type: 'data',
        layout: 'big-number-hero',
        brief: 'TAM/SAM/SOM style opportunity for {topic}; use dataSource sample if no real figures.',
      },
      {
        title: 'Product',
        type: 'content',
        layout: 'left-text-right-image',
        brief: 'Product walkthrough for {topic}: what users do in 3 steps.',
        image_queries: ['saas product dashboard'],
      },
      {
        title: 'Traction',
        type: 'data',
        layout: 'kpi-row',
        brief: 'Traction / milestones for {topic} — 4 KPIs (sample OK if disclosed).',
      },
      {
        title: 'Team',
        type: 'content',
        layout: 'two-column',
        brief: 'Team slide for {topic}: roles and why this team wins.',
      },
      {
        title: 'The ask',
        type: 'closing',
        layout: 'closing-cta',
        brief: 'Closing ask for {topic}: what you need and contact CTA.',
      },
    ],
  },
  {
    id: 'quarterly-report',
    accent: '#0d9488',
    labelVi: 'Báo cáo quý',
    labelEn: 'Quarterly report',
    labelZh: '季度汇报',
    descVi: 'Tóm tắt kết quả, KPI, highlight, rủi ro, kế hoạch tiếp',
    descEn: 'Results, KPIs, highlights, risks, next plan',
    descZh: '业绩总览、KPI、亮点、风险、下季计划',
    approxPages: 6,
    style:
      'Executive business report: teal (#0d9488) + charcoal text on white, clean tables/KPI cards, Calibri/Segoe body, formal but scannable.',
    coreHook: 'Quarterly business review for {topic}',
    pages: [
      {
        title: '{topic} — quarterly review',
        type: 'cover',
        layout: 'title-hero',
        brief: 'Cover: quarterly review title for {topic}, period label, presenter role.',
      },
      {
        title: 'Executive summary',
        type: 'content',
        layout: 'three-column-cards',
        brief: '3 headline outcomes for {topic} this quarter.',
      },
      {
        title: 'Key metrics',
        type: 'data',
        layout: 'kpi-row',
        brief: '4–6 KPIs for {topic} with trend vs prior period (sample OK if disclosed).',
      },
      {
        title: 'Highlights',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Wins and shipped work for {topic}.',
      },
      {
        title: 'Risks & blockers',
        type: 'content',
        layout: 'two-column',
        brief: 'Risks/blockers for {topic} and mitigations.',
      },
      {
        title: 'Next quarter',
        type: 'closing',
        layout: 'closing-cta',
        brief: 'Priorities and asks for next quarter on {topic}.',
      },
    ],
  },
  {
    id: 'product-launch',
    accent: '#c026d3',
    labelVi: 'Ra mắt sản phẩm',
    labelEn: 'Product launch',
    labelZh: '产品发布',
    descVi: 'Câu chuyện sản phẩm, tính năng, demo, định giá, CTA',
    descEn: 'Story, features, demo, pricing, CTA',
    descZh: '产品故事、功能、演示、定价、行动号召',
    approxPages: 7,
    style:
      'Launch event energy: magenta/violet accents on near-black or white, large typography, product-shot friendly layouts, bold CTAs.',
    coreHook: 'Launch narrative for {topic}',
    pages: [
      {
        title: 'Introducing {topic}',
        type: 'cover',
        layout: 'title-hero',
        brief: 'Launch cover for {topic} with a memorable tagline.',
        image_queries: ['product launch stage'],
      },
      {
        title: 'Why now',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Market timing / why {topic} matters now.',
      },
      {
        title: 'What it is',
        type: 'content',
        layout: 'left-text-right-image',
        brief: 'Product definition of {topic} in plain language + visual.',
        image_queries: ['modern product photograph'],
      },
      {
        title: 'Key features',
        type: 'content',
        layout: 'three-column-cards',
        brief: '3 hero features of {topic} with benefits.',
      },
      {
        title: 'How it works',
        type: 'content',
        layout: 'timeline',
        brief: '3–4 step user journey for {topic}.',
      },
      {
        title: 'Plans',
        type: 'data',
        layout: 'two-column',
        brief: 'Pricing / packaging for {topic} (sample OK if disclosed).',
      },
      {
        title: 'Get started',
        type: 'closing',
        layout: 'closing-cta',
        brief: 'CTA and next steps for {topic}.',
      },
    ],
  },
  {
    id: 'training',
    accent: '#ea580c',
    labelVi: 'Đào tạo / onboarding',
    labelEn: 'Training / onboarding',
    labelZh: '培训入职',
    descVi: 'Mục tiêu học, nội dung, quy trình, checklist, Q&A',
    descEn: 'Learning goals, content, process, checklist, Q&A',
    descZh: '学习目标、内容、流程、清单、问答',
    approxPages: 7,
    style:
      'Friendly training deck: warm orange accents, soft cards, clear hierarchy, icon-friendly sections, readable body ≥16pt equivalent.',
    coreHook: 'Practical training session on {topic}',
    pages: [
      {
        title: 'Training: {topic}',
        type: 'cover',
        layout: 'title-hero',
        brief: 'Training cover for {topic}: audience and duration.',
      },
      {
        title: 'Learning goals',
        type: 'content',
        layout: 'three-column-cards',
        brief: '3 measurable learning goals for {topic}.',
      },
      {
        title: 'Agenda',
        type: 'content',
        layout: 'timeline',
        brief: 'Session agenda for {topic}.',
      },
      {
        title: 'Core concepts',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Core concepts learners must know about {topic}.',
      },
      {
        title: 'Process',
        type: 'content',
        layout: 'two-column',
        brief: 'Step-by-step process / workflow for {topic}.',
      },
      {
        title: 'Checklist',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Practical checklist to apply {topic} on the job.',
      },
      {
        title: 'Q&A',
        type: 'closing',
        layout: 'closing-cta',
        brief: 'Q&A / resources closing for {topic}.',
      },
    ],
  },
  {
    id: 'meeting-brief',
    accent: '#475569',
    labelVi: 'Tóm tắt họp',
    labelEn: 'Meeting brief',
    labelZh: '会议纪要',
    descVi: 'Bối cảnh, quyết định, action items, chủ sở hữu',
    descEn: 'Context, decisions, action items, owners',
    descZh: '背景、决议、行动项、负责人',
    approxPages: 5,
    style:
      'Neutral meeting brief: slate gray accents, dense but clear bullets, status tags, minimal imagery.',
    coreHook: 'Meeting outcomes for {topic}',
    pages: [
      {
        title: '{topic}',
        type: 'cover',
        layout: 'title-hero',
        brief: 'Meeting title slide for {topic}: date, attendees roles.',
      },
      {
        title: 'Context',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Why this meeting on {topic} was needed.',
      },
      {
        title: 'Decisions',
        type: 'content',
        layout: 'three-column-cards',
        brief: 'Key decisions made about {topic}.',
      },
      {
        title: 'Action items',
        type: 'content',
        layout: 'two-column',
        brief: 'Action items for {topic} with owners and due dates.',
      },
      {
        title: 'Next check-in',
        type: 'closing',
        layout: 'closing-cta',
        brief: 'Follow-up meeting / open questions for {topic}.',
      },
    ],
  },
  {
    id: 'lesson',
    accent: '#1d4ed8',
    labelVi: 'Bài giảng',
    labelEn: 'Lesson / lecture',
    labelZh: '教学课件',
    descVi: 'Mở bài, kiến thức, ví dụ, luyện tập, tổng kết',
    descEn: 'Hook, teach, examples, practice, summary',
    descZh: '导入、讲解、例题、练习、总结',
    approxPages: 8,
    style:
      'Classroom lecture: clear blue accents, large titles, example callouts, whiteboard-friendly layouts.',
    coreHook: 'Teach {topic} clearly in one sitting',
    pages: [
      {
        title: '{topic}',
        type: 'cover',
        layout: 'title-hero',
        brief: 'Lesson cover for {topic}: grade/level and duration.',
      },
      {
        title: 'Today we will',
        type: 'content',
        layout: 'three-column-cards',
        brief: 'Learning objectives for {topic}.',
      },
      {
        title: 'Warm-up',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Hook / prior knowledge prompt for {topic}.',
      },
      {
        title: 'Concept',
        type: 'content',
        layout: 'left-text-right-image',
        brief: 'Teach the core concept of {topic} simply.',
        image_queries: ['classroom teaching illustration'],
      },
      {
        title: 'Worked example',
        type: 'content',
        layout: 'two-column',
        brief: 'Worked example applying {topic}.',
      },
      {
        title: 'Try it',
        type: 'content',
        layout: 'left-text-right-bullets',
        brief: 'Practice prompt for learners on {topic}.',
      },
      {
        title: 'Common mistakes',
        type: 'content',
        layout: 'two-column',
        brief: 'Pitfalls when learning {topic}.',
      },
      {
        title: 'Summary',
        type: 'closing',
        layout: 'closing-cta',
        brief: 'Recap + homework for {topic}.',
      },
    ],
  },
] as const

export function getDeckTemplate(id: string): DeckTemplate | undefined {
  return DECK_TEMPLATES.find((t) => t.id === id)
}

export function deckTemplateLabel(tpl: DeckTemplate, lang: string): string {
  if (lang === 'vi' || lang.startsWith('vi')) return tpl.labelVi
  if (lang === 'zh' || lang.startsWith('zh')) return tpl.labelZh
  return tpl.labelEn
}

export function deckTemplateDesc(tpl: DeckTemplate, lang: string): string {
  if (lang === 'vi' || lang.startsWith('vi')) return tpl.descVi
  if (lang === 'zh' || lang.startsWith('zh')) return tpl.descZh
  return tpl.descEn
}

export interface BuiltinTemplateFill {
  topic: string
  style: string
  core_hook: string
  approx_pages: number
  pages: Array<{
    title: string
    type: string
    brief: string
    layout: string
    image_queries: string[]
  }>
}

/** Expand a gallery template + user topic into generate_deck arguments. */
export function fillBuiltinTemplate(id: string, topic: string): BuiltinTemplateFill | null {
  const tpl = getDeckTemplate(id)
  if (!tpl) return null
  const t = topic.trim() || tpl.labelEn
  return {
    topic: t,
    style: tpl.style,
    core_hook: sub(tpl.coreHook, t),
    approx_pages: tpl.pages.length || tpl.approxPages,
    pages: tpl.pages.map((p) => ({
      title: sub(p.title, t),
      type: p.type,
      brief: sub(p.brief, t),
      layout: p.layout,
      image_queries: [...(p.image_queries ?? [])],
    })),
  }
}

/**
 * User-visible chat text + model instruction when generating from the gallery.
 * Display shows a short line; the model gets an explicit generate_deck call recipe.
 */
export function buildGalleryGenerateMessages(
  templateId: string,
  topic: string,
  lang: string,
): { displayText: string; instruction: string } | null {
  const tpl = getDeckTemplate(templateId)
  const fill = fillBuiltinTemplate(templateId, topic)
  if (!tpl || !fill) return null
  const name = deckTemplateLabel(tpl, lang)
  const displayText =
    lang === 'vi' || lang.startsWith('vi')
      ? `Tạo slide theo mẫu “${name}”: ${fill.topic}`
      : lang === 'zh' || lang.startsWith('zh')
        ? `按模板「${name}」生成：${fill.topic}`
        : `Generate from template “${name}”: ${fill.topic}`

  const instruction =
    `Create a whole new presentation from the built-in gallery template.\n` +
    `Call generate_deck ONCE with:\n` +
    `- builtin_template: "${templateId}"\n` +
    `- topic: ${JSON.stringify(fill.topic)}\n` +
    `- insert_mode: "replace"\n` +
    `- dataSource: "sample"\n` +
    `Do NOT call ask_clarification. Do NOT invent a different page structure — the builtin_template supplies style + pages. ` +
    `After generate_deck finishes, briefly confirm what was created.`

  return { displayText, instruction }
}
