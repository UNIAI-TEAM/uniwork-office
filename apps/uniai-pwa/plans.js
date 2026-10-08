/**
 * UniWork commercial plans — source for PWA Settings / Pricing UI.
 * Keep in sync with docs/pricing/UNIWORK_PLANS.md
 */
;(() => {
  /** @typedef {'free'|'personal'|'pro'|'team'} PlanId */

  /**
   * @typedef {{
   *   id: PlanId
   *   nameVi: string
   *   nameEn: string
   *   blurbVi: string
   *   blurbEn: string
   *   priceUsdMonth: number
   *   priceUsdYear: number
   *   priceVndMonth: number
   *   priceVndYear: number
   *   perSeat?: boolean
   *   minSeats?: number
   *   devices: number
   *   tokensMonth: number
   *   features: string[]
   *   bridge: boolean
   *   teamAdmin: boolean
   * }} Plan
   */

  /** @type {readonly Plan[]} */
  const PLANS = [
    {
      id: 'free',
      nameVi: 'Free',
      nameEn: 'Free',
      blurbVi: 'Cài máy · sửa file local · PWA trên thiết bị này',
      blurbEn: 'Install on device · local files · on-device PWA',
      priceUsdMonth: 0,
      priceUsdYear: 0,
      priceVndMonth: 0,
      priceVndYear: 0,
      devices: 1,
      tokensMonth: 10_000,
      bridge: false,
      teamAdmin: false,
      features: [
        'Docs / Sheets / Slides / PDF trên máy',
        'Workbench & uniAI local',
        '1 thiết bị',
        '10 000 token AI / tháng',
      ],
    },
    {
      id: 'personal',
      nameVi: 'Personal',
      nameEn: 'Personal',
      blurbVi: 'Freelancer / cá nhân — Bridge cloud + 2 máy',
      blurbEn: 'Solo pros — cloud Bridge + 2 devices',
      priceUsdMonth: 9.99,
      priceUsdYear: 79,
      priceVndMonth: 249_000,
      priceVndYear: 1_990_000,
      devices: 2,
      tokensMonth: 50_000,
      bridge: true,
      teamAdmin: false,
      features: [
        'Mọi quyền Free',
        'Office Bridge mở/lưu UniWork',
        '2 thiết bị',
        '50 000 token AI / tháng',
      ],
    },
    {
      id: 'pro',
      nameVi: 'Pro',
      nameEn: 'Pro',
      blurbVi: 'Chuyên nghiệp — AI cao + hỗ trợ ưu tiên',
      blurbEn: 'Power users — higher AI + priority support',
      priceUsdMonth: 19.99,
      priceUsdYear: 159,
      priceVndMonth: 499_000,
      priceVndYear: 3_990_000,
      devices: 3,
      tokensMonth: 200_000,
      bridge: true,
      teamAdmin: false,
      features: [
        'Mọi quyền Personal',
        '3 thiết bị',
        '200 000 token AI / tháng',
        'Hỗ trợ ưu tiên',
      ],
    },
    {
      id: 'team',
      nameVi: 'Team',
      nameEn: 'Team',
      blurbVi: 'Theo ghế · admin tenant · tối thiểu 3 seat',
      blurbEn: 'Per seat · tenant admin · min 3 seats',
      priceUsdMonth: 12,
      priceUsdYear: 99,
      priceVndMonth: 299_000,
      priceVndYear: 2_490_000,
      perSeat: true,
      minSeats: 3,
      devices: 2,
      tokensMonth: 50_000,
      bridge: true,
      teamAdmin: true,
      features: [
        'Bridge + phiên bản cloud',
        '2 máy / seat',
        '50 000 token / seat / tháng',
        'Admin & quyền file (tenant)',
      ],
    },
  ]

  /** @param {number} n */
  function formatVnd(n) {
    if (!n) return '0đ'
    return `${n.toLocaleString('vi-VN')}đ`
  }

  /** @param {number} n */
  function formatUsd(n) {
    if (!n) return '$0'
    return n % 1 ? `$${n.toFixed(2)}` : `$${n}`
  }

  /** @param {Plan} plan @param {'vi'|'en'} [lang] */
  function priceLabel(plan, lang = 'vi') {
    const seat = plan.perSeat ? (lang === 'vi' ? '/ seat' : '/ seat') : ''
    if (!plan.priceVndMonth && !plan.priceUsdMonth) {
      return lang === 'vi' ? 'Miễn phí' : 'Free'
    }
    if (lang === 'vi') {
      return `${formatVnd(plan.priceVndMonth)}${seat}/tháng · ${formatVnd(plan.priceVndYear)}${seat}/năm`
    }
    return `${formatUsd(plan.priceUsdMonth)}${seat}/mo · ${formatUsd(plan.priceUsdYear)}${seat}/yr`
  }

  /** @param {string} id */
  function getPlan(id) {
    return PLANS.find((p) => p.id === id) || PLANS[0]
  }

  window.UniAIPlans = {
    PLANS,
    getPlan,
    priceLabel,
    formatVnd,
    formatUsd,
  }
})()
