import type { zh } from './zh'

export const ja = {
  setSecSkills: 'スキル',
  intgSkillsDesc:
    'UniWork Office は自身のスキルフォルダ内のスキルのみ使用します。フォルダまたは zip からの読み込みはスキル全体をコピーします。読み込み時に何も実行されません。',
  intgSkillsEmpty: 'スキルはまだインストールされていません。',
  intgSkillsImportFolder: 'フォルダを読み込む…',
  intgSkillsImportZip: 'スキルパッケージを読み込む（zip / .md）…',
  intgSkillsImportFolderTitle: 'スキルフォルダを選択',
  intgSkillsImportZipTitle: 'スキルの zip または .md を選択',
  intgSkillsImportDone: '{name} を読み込みました',
  intgSkillsImportFailed: '読み込みに失敗しました：{reason}',
  intgSkillsRemove: '削除',
  intgSkillsRemoveConfirm:
    'スキル「{name}」を削除しますか？フォルダーは UniWork Office から削除されます。',
  intgSkillsRemoved: '{name} を削除しました',
  intgSkillsRead: '詳細',
  intgSkillsMine: 'マイスキル',
  intgSkillsRecommended: 'おすすめ',
  intgSkillsCatOffice: 'オフィス',
  intgSkillsCatBusiness: 'ビジネス',
  intgSkillsCatData: 'データ',
  intgSkillsCatFinance: '財務',
  intgSkillsCatHr: '人事',
  intgSkillsCatLegal: '法務',
  intgSkillsCatMarketing: 'マーケティング',
  intgSkillsCatEducation: '教育',
  intgSkillsCatOther: 'その他',
  intgSkillsInstall: 'インストール',
  intgSkillsUpdate: '更新',
  intgSkillsInstalledTag: 'インストール済み',
} satisfies Record<keyof typeof zh, string>
