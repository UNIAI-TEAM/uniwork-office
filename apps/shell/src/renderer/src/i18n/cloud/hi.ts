import type { zh } from './zh'

export const hi = {
  cloudTitle: 'UniWork क्लाउड AI',
  cloudStateReady: 'उपलब्ध',
  cloudStateNotEntitled: 'आपके प्लान में शामिल नहीं',
  cloudStateExhausted: 'AI क्रेडिट खत्म',
  cloudStateUnavailable: 'अभी उपलब्ध नहीं',
  cloudStateInactive: 'सदस्यता सक्रिय नहीं है',
  cloudCredits: 'AI क्रेडिट',
  cloudCreditsLeft: '{remaining} / {limit} शेष',
  cloudCreditsUnlimited: 'असीमित',
  cloudCreditsRenews: '{date} को रीन्यू',
  cloudToolsToggle: 'UniWork क्लाउड टूल इस्तेमाल करें',
  cloudToolsToggleDesc:
    'अपना प्रदाता न होने पर वेब सर्च, इमेज जनरेशन और मीडिया विश्लेषण UniWork क्लाउड से चलते हैं (AI क्रेडिट खर्च होते हैं)।',
} satisfies Record<keyof typeof zh, string>
