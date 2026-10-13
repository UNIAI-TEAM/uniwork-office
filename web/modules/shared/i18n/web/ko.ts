import type { zh } from './zh'

export const ko = {
  webCancel: '취소',
  webConflictTitle: '이 문서는 다른 곳에서 변경되었습니다',
  webConflictBody: '변경 사항은 아직 UniWork에 없으며 로그아웃할 때까지 이 브라우저에 보관됩니다.',
  webConflictOverwrite: '덮어쓰기…',
  webConflictReload: '최신 버전 다시 불러오기',
  webConflictNotSaved: '문서가 다른 곳에서 변경되었습니다',
  webFatalTitle: '문서를 열 수 없습니다',
  webFatalBody:
    '편집과 저장이 비활성화되었습니다. 페이지를 새로 고치거나 UniWork에서 문서를 다시 여세요.',
  webNoHost: '이 편집기는 UniWork 안에서 실행됩니다. UniWork에서 문서를 여세요.',
  webViewOnly: '보기 전용',
  webViewOnlyNotSaved: '이 문서는 보기 전용이라 저장할 수 없습니다',
  webNotUtf8:
    '이 파일은 UTF-8 텍스트가 아닙니다. 저장으로 내용이 바뀌지 않도록 보기 전용으로 엽니다',
  webDraftTitle: '저장하지 않은 변경 내용을 복원할까요?',
  webDraftBody:
    '이 브라우저에 이 문서의 저장하지 않은 변경 내용 사본이 남아 있습니다. 복원하거나 삭제하시겠습니까?',
  webDraftOlder: '이 사본은 문서의 이전 버전을 기반으로 합니다. 저장하면 최신 버전이 대체됩니다.',
  webDraftSavedAt: '사본 저장 시각',
  webDraftKept: '이 사본은 로그아웃할 때까지 이 브라우저에 보관됩니다.',
  webDraftRestore: '복원',
  webDraftDiscard: '삭제',
  webSaveNetwork: 'UniWork에 연결할 수 없습니다. 연결을 확인한 후 다시 시도하세요.',
  webSaveTimeout: '저장에 너무 오래 걸렸습니다. 연결을 확인한 후 다시 시도하세요.',
  webClose: '닫기',
  webSaveUnauthorized: 'UniWork 세션이 종료되었습니다. 다시 로그인한 뒤 저장해 주세요.',
  webSaveForbidden: '이 문서를 저장할 권한이 없습니다.',
  webSaveNotFound: '이 문서가 더 이상 없거나 이동되었습니다.',
  webSaveTooLarge: '문서가 너무 커서 저장할 수 없습니다.',
  webSaveRateLimited: '요청이 너무 많습니다. 잠시 기다린 후 다시 시도해 주세요.',
  webSaveServer: 'UniWork에서 저장하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  webSaveFailedGeneric: '문서를 저장할 수 없습니다. 다시 시도해 주세요.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    '변경 사항은 아직 UniWork에 없으며 로그아웃할 때까지 이 브라우저에 보관됩니다.',
  uwConflictReloadWebBody:
    '브라우저는 충돌 초안을 보관하지 않습니다. 나중에 복사할 수 있도록 내 버전을 다운로드하거나 변경 사항을 버리세요.',
  uwConflictDownloadThenReload: '내 버전을 다운로드한 다음 다시 불러오기',
  uwConflictDiscardThenReload: '변경 사항 버리고 다시 불러오기',
  uwConflictMineFileSuffix: '(내 버전)',
  uwConflictDownloadCheck:
    '브라우저가 파일을 받았습니다. 저장되었는지 확인한 후 다시 불러오기를 선택하세요.',
  uwConflictSessionWeb:
    '세션이 만료되어 덮어쓰지 못했습니다. 변경 사항은 이 브라우저에 남아 있습니다. 다시 로그인한 후 다시 시도하세요.',
  uwConflictTooLarge: '내 버전이 UniWork의 크기 제한을 넘어 덮어쓸 수 없습니다.',
  uwConflictDownloadTooLarge:
    '내 버전이 UniWork의 크기 제한을 넘어 여기서는 다운로드할 수 없습니다.',
  uwConflictDownloadFailed:
    '내 버전을 다운로드하지 못해 문서를 다시 불러오지 않았습니다. 다시 시도하세요.',
  uwConflictOfflineWeb:
    '오프라인 상태입니다. 웹에서는 연결이 필요하며, 변경 사항은 이 브라우저에 남아 있습니다.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: '내 버전',
  uwConflictColServer: 'UniWork의 버전',
  uwConflictRowVersion: '버전',
  uwConflictRowTime: '시간',
  uwConflictRowBy: '저장한 사람',
  uwConflictMineUnsaved: '나 (저장 안 됨)',
  uwConflictBasedOn: '버전 {n} 기준',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: '차이 보기',
  uwConflictNoEdit: '이 문서에 대한 편집 권한이 더 이상 없습니다.',
  uwConflictOverwriteTitle: '내 버전으로 덮어쓸까요?',
  uwConflictOverwriteConfirm:
    'UniWork가 내 사본으로 버전 {next}을(를) 만듭니다. {author}님의 버전 {server}은(는) 기록에 남습니다.',
  uwConflictOverwriteGo: '덮어쓰기',
  uwConflictBack: '뒤로',
  uwConflictHeadMoved:
    '그사이 UniWork에 버전 {n}이(가) 생겼습니다. 표가 업데이트되었으니 다시 선택하세요.',
  uwConflictReloadTitle: '최신 버전 다시 불러오기',
  uwConflictReloadGo: '다시 불러오기',
  uwConflictSaveCopy: '사본으로 저장…',
  uwConflictSaveCopyTitle: '사본으로 저장할까요?',
  uwConflictSaveCopyConfirm:
    'UniWork가 내 버전으로 이 문서와 소유자 및 액세스 권한이 같은 새 문서를 만듭니다. 현재 문서와 {author}님의 버전 {server}은(는) 그대로 유지됩니다.',
  uwConflictSaveCopyGo: '사본 만들기',
  uwConflictSaveCopyDone:
    '내 버전을 새 문서로 저장했습니다: {title}. 이 문서는 바뀌지 않았으며, 여전히 다시 불러오거나 덮어쓸 수 있습니다.',
  uwConflictSaveCopyFailed:
    '사본을 만들지 못했습니다. 변경 사항은 여전히 안전합니다. 다시 시도하세요.',
  uwConflictSaveCopyOffline:
    '오프라인 상태입니다. 사본을 만들려면 연결이 필요하며, 변경 사항은 보관됩니다.',
  uwConflictReloadFailed:
    '최신 버전을 불러오지 못했습니다. 문서는 바뀌지 않았습니다. 다시 시도하세요.',
  uwConflictOverwriteFailed: '아직 덮어쓰지 못했습니다. 문서는 바뀌지 않았습니다. 다시 시도하세요.',
  uwConflictClose: '닫기',

  // S6 new-version bar
  uwRemoteRegion: '새 버전',
  uwRemoteUpdated: '버전 {n}(으)로 업데이트했습니다. {author}님이 {time}에 저장했습니다.',
  uwRemoteUpdatedNoRev: 'UniWork의 최신 버전으로 업데이트했습니다.',
  uwRemoteNewerDirty:
    'UniWork에 최신 버전이 있습니다(버전 {n}). 저장하지 않은 변경 사항이 있어 문서를 다시 불러오지 않았습니다.',
  uwRemoteNewerAi:
    'UniWork에 최신 버전이 있습니다(버전 {n}). UniWork AI가 실행 중이라 문서를 다시 불러오지 않았으며, AI 결과는 열린 사본에만 적용됩니다.',
  uwRemoteNowClean:
    '모든 변경 사항을 실행 취소했습니다. UniWork의 버전 {n}이(가) 열린 사본보다 최신입니다.',
  uwRemoteStopAiConfirm:
    '다시 불러오기 위해 실행 중인 UniWork AI를 중지할까요? AI가 이미 적용한 변경 사항은 열린 사본에 속합니다.',
  uwRemoteWaitCommit: '진행 중인 저장이 끝나기를 기다리는 중입니다. 그 후 다시 불러올 수 있습니다.',
  uwRemoteReload: '최신 버전 다시 불러오기…',
  uwRemoteLater: '나중에',
  uwRemoteClose: '닫기',
  uwRemoteReloadFailed: '버전 {n}을(를) 불러오지 못했습니다. 아직 이전 버전을 보고 있습니다.',
  uwRemoteDeleted: '이 문서가 UniWork에서 삭제되었습니다. 대기 중인 저장이 중지되었습니다.',
  uwAuthorFallback: '구성원',
  uwLockRegion: '문서 상태',
  uwActRetry: '다시 시도',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    '이 문서에 더 이상 액세스할 수 없습니다. 저장이 중지되었으며, 저장하지 않은 변경 사항은 로그아웃할 때까지 이 브라우저에 보관됩니다.',
  uwRemoteOrgBlockedWeb:
    '저장하지 못했습니다: {reason}. 저장하지 않은 변경 사항은 로그아웃할 때까지 이 브라우저에 보관됩니다.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: '문서가 보관됨',
  uwReasonSuspended: '조직이 정지됨',
  uwReasonDeactivated: '이 조직에서 계정이 비활성화됨',
} satisfies Record<keyof typeof zh, string>
