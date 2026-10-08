import { describe, expect, it } from 'vitest'
import {
  describeRouteDone,
  describeRouteOutcome,
  routeNeedsConsent,
} from '../src/renderer/src/my-ai-consent'
import { matchPracticePlaybook, practiceMyAiChips } from '../src/renderer/src/my-ai-playbooks'
import { routeMyAiText } from '../src/renderer/src/my-ai-router'

describe('Phase C / P1 practice playbooks', () => {
  it('matches sales quote → Word + task + Clients', () => {
    const hit = matchPracticePlaybook(
      'sales',
      'Soạn báo giá Word và thêm việc follow-up, mở tab Clients',
    )
    expect(hit?.playbook.id).toBe('sales-quote')
    expect(hit?.steps).toHaveLength(3)
    expect(hit?.steps[0]).toMatchObject({ kind: 'fill_template', templateId: 'sales-quote' })
    expect(hit?.steps[1]?.kind).toBe('workbench')
    expect(hit?.steps[2]?.kind).toBe('workbench')
  })

  it('routes via practiceId in routeMyAiText', () => {
    const r = routeMyAiText('Soạn báo giá cho gói Pro', { practiceId: 'sales' })
    expect(r.kind).toBe('plan')
    if (r.kind === 'plan') {
      expect(r.playbookId).toBe('sales-quote')
      expect(r.steps.length).toBeGreaterThanOrEqual(2)
      expect(r.steps[0]).toMatchObject({ kind: 'fill_template', templateId: 'sales-quote' })
    }
  })

  it('does not apply sales playbook on teacher practice', () => {
    const r = routeMyAiText('Soạn báo giá cho gói Pro', { practiceId: 'teacher' })
    // May still be create_file or clause plan, but not sales-quote playbook
    if (r.kind === 'plan') expect(r.playbookId).not.toBe('sales-quote')
  })

  it('exposes practice chips', () => {
    const chips = practiceMyAiChips('sales')
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.some((c) => c.id === 'sales-quote')).toBe(true)
  })

  it('marketing campaign → brief + slides + task + calendar', () => {
    const hit = matchPracticePlaybook(
      'marketing',
      'Soạn brief chiến dịch ra mắt sản phẩm mới',
    )
    expect(hit?.playbook.id).toBe('marketing-campaign')
    expect(hit?.steps[0]).toMatchObject({ kind: 'fill_template', templateId: 'marketing-campaign' })
    expect(hit?.steps[1]).toMatchObject({ kind: 'create_file', app: 'slides' })
    expect(hit?.steps.length).toBe(4)
  })

  it('accounting invoice → sheets + email draft + task', () => {
    const hit = matchPracticePlaybook('accounting', 'Tạo hóa đơn Excel cho khách ABC')
    expect(hit?.playbook.id).toBe('accounting-invoice')
    expect(hit?.steps[0]).toMatchObject({ kind: 'create_file', app: 'sheets' })
    expect(hit?.steps[1]?.kind).toBe('workbench')
    expect(hit?.steps[2]?.kind).toBe('workbench')
  })

  it('IT runbook → docs + task + notes', () => {
    const hit = matchPracticePlaybook('it', 'Soạn runbook xử lý sự cố API timeout')
    expect(hit?.playbook.id).toBe('it-runbook')
    expect(hit?.steps[0]).toMatchObject({ kind: 'create_file', app: 'docs' })
    expect(hit?.steps).toHaveLength(3)
  })

  it('construction / content / entrepreneur / procurement / hr / re playbooks match', () => {
    expect(matchPracticePlaybook('construction', 'Soạn nhật ký giám sát hôm nay')?.playbook.id).toBe(
      'construction-site',
    )
    expect(matchPracticePlaybook('content-creator', 'Soạn kịch bản video tuần này')?.playbook.id).toBe(
      'content-calendar',
    )
    expect(matchPracticePlaybook('entrepreneur', 'Tạo pitch gọi vốn seed')?.playbook.id).toBe(
      'entrepreneur-pitch',
    )
    expect(matchPracticePlaybook('procurement', 'Soạn RFP nhà cung cấp phần mềm')?.playbook.id).toBe(
      'procurement-rfp',
    )
    expect(matchPracticePlaybook('hr', 'Soạn JD và checklist onboarding')?.playbook.id).toBe(
      'hr-onboard',
    )
    expect(matchPracticePlaybook('real-estate', 'Soạn mô tả listing căn hộ Q2')?.playbook.id).toBe(
      're-listing',
    )
  })

  it('routes new playbooks through routeMyAiText', () => {
    const mkt = routeMyAiText('Brief chiến dịch brand Q4', { practiceId: 'marketing' })
    expect(mkt.kind).toBe('plan')
    if (mkt.kind === 'plan') expect(mkt.playbookId).toBe('marketing-campaign')

    const acc = routeMyAiText('Xuất hóa đơn tháng này', { practiceId: 'accounting' })
    expect(acc.kind).toBe('plan')
    if (acc.kind === 'plan') expect(acc.playbookId).toBe('accounting-invoice')

    const it = routeMyAiText('Incident runbook database failover', { practiceId: 'it' })
    expect(it.kind).toBe('plan')
    if (it.kind === 'plan') expect(it.playbookId).toBe('it-runbook')
  })
})

describe('My AI consent P0/P1', () => {
  it('requires consent for summarize / AI brief, not blank create or soft mutate', () => {
    expect(
      routeNeedsConsent({ kind: 'summarize_recents', limit: 8 }).map((n) => n.reason),
    ).toContain('deep_read')
    expect(
      routeNeedsConsent({
        kind: 'create_file',
        app: 'docs',
        blank: true,
      }),
    ).toEqual([])

    // Workbench add_item is soft — no hard consent
    expect(
      routeNeedsConsent({
        kind: 'workbench',
        intent: {
          intentId: 't',
          action: 'add_item',
          target: { kind: 'module', id: 'notes' },
          summary: 'add note',
          text: 'hello',
          scope: 'local',
          source: 'desktop',
          requireConsent: false,
          createdAt: new Date().toISOString(),
        },
      }),
    ).toEqual([])

    const sales = routeMyAiText('Soạn báo giá Pro', { practiceId: 'sales' })
    expect(sales.kind).toBe('plan')
    if (sales.kind === 'plan') {
      const reasons = routeNeedsConsent(sales).map((n) => n.reason)
      expect(reasons).not.toContain('mutate')
      expect(reasons).toContain('ai_token')
    }
  })

  it('requires Token consent for create-with-brief and continue_active', () => {
    expect(
      routeNeedsConsent({
        kind: 'create_file',
        app: 'docs',
        blank: false,
        brief: 'Thư mời họp',
      }).map((n) => n.reason),
    ).toContain('ai_token')
    expect(
      routeNeedsConsent({ kind: 'continue_active', brief: 'Làm rõ kết luận' }).map((n) => n.reason),
    ).toContain('ai_token')
  })

  it('P2/P3 result card: one goal, no step jargon', () => {
    const plan = {
      kind: 'plan' as const,
      steps: [
        { kind: 'summarize_recents' as const, limit: 8 },
        {
          kind: 'workbench' as const,
          intent: {
            intentId: 't',
            action: 'add_item' as const,
            target: { kind: 'module' as const, id: 'notes' as const },
            summary: 'note',
            text: 'hello',
            scope: 'local' as const,
            source: 'desktop' as const,
            requireConsent: false,
            createdAt: new Date().toISOString(),
          },
        },
      ],
      goalVi: 'Tóm tắt ngữ cảnh và lưu vào Ghi chú',
      goalEn: 'Summarize context and save to Notes',
      summaryVi: 'Tóm tắt ngữ cảnh và lưu vào Ghi chú',
      summaryEn: 'Summarize context and save to Notes',
    }
    const ahead = describeRouteOutcome(plan, true)
    expect(ahead).toBe('Tôi sẽ: Tóm tắt ngữ cảnh và lưu vào Ghi chú.')
    expect(ahead).not.toMatch(/bước|→/)
    const done = describeRouteDone(plan, true)
    expect(done).toBe('Đã xong: Tóm tắt ngữ cảnh và lưu vào Ghi chú.')
    expect(done).not.toMatch(/bước|Plan|✓/)
    expect(describeRouteDone(plan, true, { paused: true })).toBe('Mở file nào?')
    expect(describeRouteDone(plan, false, { paused: true })).toBe('Which file?')
    expect(describeRouteDone(plan, true, { paused: true })).not.toMatch(
      /dừng|plan|tiếp tục|bên dưới/i,
    )
  })
})
