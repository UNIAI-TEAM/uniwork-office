import type { zh } from './zh'

export const ko = {
  setSecSkills: '스킬',
  intgSkillsDesc:
    'UniWork Office는 자체 스킬 폴더의 스킬만 사용합니다. 폴더나 zip에서 가져오면 스킬 전체가 복사되며, 가져오기 시 아무것도 실행되지 않습니다.',
  intgSkillsEmpty: '설치된 스킬이 없습니다.',
  intgSkillsImportFolder: '폴더 가져오기…',
  intgSkillsImportZip: '스킬 패키지 가져오기(zip / .md)…',
  intgSkillsImportFolderTitle: '스킬 폴더 선택',
  intgSkillsImportZipTitle: '스킬 zip 또는 .md 선택',
  intgSkillsImportDone: '{name} 가져옴',
  intgSkillsImportFailed: '가져오기 실패: {reason}',
  intgSkillsRemove: '제거',
  intgSkillsRemoveConfirm:
    '스킬 "{name}"을(를) 제거할까요? 해당 폴더가 UniWork Office에서 삭제됩니다.',
  intgSkillsRemoved: '{name} 제거됨',
  intgSkillsRead: '상세',
  intgSkillsMine: '내 스킬',
  intgSkillsRecommended: '추천',
  intgSkillsCatOffice: '사무',
  intgSkillsCatBusiness: '비즈니스',
  intgSkillsCatData: '데이터',
  intgSkillsCatFinance: '재무',
  intgSkillsCatHr: '인사',
  intgSkillsCatLegal: '법무',
  intgSkillsCatMarketing: '마케팅',
  intgSkillsCatEducation: '교육',
  intgSkillsCatOther: '기타',
  intgSkillsInstall: '설치',
  intgSkillsUpdate: '업데이트',
  intgSkillsInstalledTag: '설치됨',
} satisfies Record<keyof typeof zh, string>
