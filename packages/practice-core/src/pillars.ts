import type { PracticePillarLabels } from './types.js'

/** Neutral 4-pillar chrome shared by every practice (labels localized per practice override optional). */
export const DEFAULT_PILLARS: readonly PracticePillarLabels[] = [
  {
    id: 'knowledge',
    labelVi: 'Tri thức',
    labelEn: 'Knowledge',
    hintVi: 'Thư viện gói công việc',
    hintEn: 'Work-pack library',
  },
  {
    id: 'materials',
    labelVi: 'Tài liệu',
    labelEn: 'Materials',
    hintVi: 'File theo vai trò trong gói',
    hintEn: 'Role-tagged files in the pack',
  },
  {
    id: 'skills',
    labelVi: 'Kỹ năng',
    labelEn: 'Skills',
    hintVi: 'Prompt AI tái sử dụng',
    hintEn: 'Reusable AI prompts',
  },
  {
    id: 'compose',
    labelVi: 'Soạn mới',
    labelEn: 'Compose',
    hintVi: 'Tạo gói + mẫu',
    hintEn: 'Create pack + templates',
  },
] as const
