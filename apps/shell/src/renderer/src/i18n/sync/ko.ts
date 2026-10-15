import type { zh } from './zh'

export const ko = {
  // S1 save pill: chips and tooltips
  uwChipQueued: '저장 대기 중 — 아직 UniWork에 없음',
  uwChipQueuedNewer: '저장 대기 중 · 새 편집 있음',
  uwChipPausedAdmin: '저장 대기 중 · 전송 일시 중지됨',
  uwChipReconciling: '마지막 저장을 확인하는 중…',
  uwChipReconcileStuck: '저장 확인에 지원이 필요함',
  uwChipRemoteNewer: 'UniWork에 최신 버전 있음',
  uwTipQueued: '{time}의 저장 내용은 이 컴퓨터에 안전하게 보관되며 온라인이 되면 전송됩니다.',
  uwTipQueuedNewer: '{time}의 저장 내용이 전송을 기다리고 있습니다. 이후 편집은 포함되지 않습니다.',
  uwTipPausedAdmin: '관리자가 전송을 일시 중지했습니다. 저장 내용은 이 컴퓨터에 보관됩니다.',
  uwTipPausedUser:
    '전송을 일시 중지했습니다. {time}의 저장 내용은 이 컴퓨터에 보관됩니다. 동기화 센터에서 전송 재개를 선택하세요.',
  uwTipReconciling:
    '마지막 저장이 UniWork에 도달했는지 아직 확실하지 않습니다. 앱이 확인 중이며 중복을 만들지 않습니다.',
  uwTipRemoteNewer: '저장하지 않은 변경 사항이 있어 문서를 다시 불러오지 않았습니다.',
  uwTipFailed:
    '이 저장은 자동으로 다시 시도되지 않습니다: {reason}. 변경 사항은 이 컴퓨터에 남아 있습니다.',
  uwTipWaitAi: 'AI가 현재 단계를 마칠 때까지 기다린 후 저장합니다.',
  uwTipWaitAiLong: 'AI가 현재 단계를 아직 마치지 않았습니다. 지금 저장하려면 AI 실행을 중지하세요.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: '대기열 보기',
  uwActSaveAgain: '다시 저장',
  uwActStopAi: 'AI 중지',
  uwActBack: '뒤로',
  uwQueuePopWaiting: '저장 대기: {time} 내용 (버전 {base} 기준)',
  uwQueuePopNewer: '그 이후 새 편집 — 전송 안 됨',
  uwQueueBlockedSave: '마지막 저장이 아직 대기 중입니다. 완료되면 다시 저장할 수 있습니다.',
  uwQueueFull:
    '이 컴퓨터의 동기화 저장소가 가득 차서 저장이 대기열에 추가되지 않았습니다. 변경 사항은 열린 창에 남아 있습니다. 동기화 센터에서 공간을 확보하세요.',
  uwQueueOpenCenter: '동기화 센터 열기',
  uwQueueCancel: '저장 취소…',
  uwQueueCancelConfirm:
    '대기 중인 저장을 취소할까요? 변경 사항은 이 컴퓨터에 남고 UniWork의 문서는 바뀌지 않습니다.',
  uwQueueCancelled: '대기 중인 저장을 취소했습니다. 변경 사항은 이 컴퓨터에 남아 있습니다.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: '다시 로그인 필요',
  uwReasonSignedOut: '로그아웃됨',
  uwReasonForeign: '다른 계정 소유',
  uwReasonArchived: '문서가 보관됨',
  uwReasonSuspended: '조직이 정지됨',
  uwReasonDeactivated: '이 조직에서 계정이 비활성화됨',
  uwReasonLease: '오프라인 액세스 만료됨',
  uwReasonKeystore: '이 컴퓨터의 키체인이 잠김',
  uwReasonClock: '시계가 뒤로 조정됨',
  uwReasonStoreFull: '이 컴퓨터의 동기화 저장소가 가득 참',
  uwReasonStoreNewer: '최신 버전의 앱이 필요함',

  // S2 queue-row badges
  uwBadgeQueued: '대기 중',
  uwBadgeWaitNetwork: '네트워크 대기 중',
  uwBadgePausedUser: '내가 일시 중지함',
  uwBadgePausedAdmin: '관리자가 일시 중지함',
  uwBadgeSending: '전송 중',
  uwBadgeReconciling: '확인 중',
  uwBadgeReconcileStuck: '지원 필요',
  uwBadgeConflict: '충돌',
  uwBadgeBlocked: '차단됨',
  uwBadgeLocked: '잠김',
  uwBadgeRevoked: '액세스 권한 없음',
  uwBadgeDeleted: '삭제됨',
  uwBadgeReconnect: '다시 연결 필요',
  uwBadgeKeystore: '키체인 잠김',
  uwBadgeFailed: '전송 실패',
  uwBadgeSaved: '저장됨',
  uwBadgeKeptDraft: '보관된 초안',
  uwBadgeMoved: '이동됨',
  uwBadgeArchived: '보관됨',

  // S2 queue-row details
  uwRowQueued: '{time} 저장 · 버전 {base} 기준 · {size}',
  uwRowWaitNetwork: '온라인이 되면 전송됨',
  uwRowPausedUser: '전송 재개를 선택하면 전송됨',
  uwRowPausedAdmin: '관리자가 전송을 다시 켜면 전송됨',
  uwRowUploading: '업로드 중 {done} / {total}',
  uwRowCommitting: '버전 만드는 중',
  uwRowReconciling: '{time} 전송 결과가 아직 확실하지 않습니다. UniWork에 확인하는 중입니다.',
  uwRowReconcileStuck:
    '확인 시도 횟수: {count}, 아직 결과가 없습니다. 앱은 다시 전송하지 않습니다. 지원 코드를 관리자에게 보내세요.',
  uwStuckDiscardConfirm:
    '이 저장을 버릴까요? 이미 UniWork에 도달했다면 해당 버전은 남고, 내 사본은 동기화 센터에 초안으로 보관됩니다.',
  uwRowConflict: '버전 {n}은(는) {author}님이 {time}에 저장했습니다',
  uwRowFailed: '전송 실패: {reason}',
  uwRowBlocked: '저장할 수 없음: {reason}',
  uwRowCommitted: '버전 {n} · {time}',
  uwRowKeptDraft: '{time}에 다시 불러올 때 보관됨',
  uwRowMoved: '문서가 {workspace}(으)로 이동됨',
  uwRowArchived: '문서가 UniWork에서 보관됨',

  // S2 row actions
  uwActDiscard: '버리기',
  uwActDiscardSave: '저장 버리기…',
  uwActSendNow: '지금 전송',
  uwActRecheck: '다시 확인',
  uwActGuide: '안내',
  uwActOpenToResolve: '열어서 해결',
  uwActCopySupport: '지원 코드 복사',
  uwActDownloadMine: '내 버전 다운로드',
  uwActOpenDraft: '초안 열기',
  uwActDiscardDraft: '초안 버리기…',
  uwActSignInAgain: '다시 로그인',
  uwActSignIn: '로그인',
  uwActSwitchAccount: '계정 전환',
  uwActReconnect: '다시 연결',
  uwActDetails: '세부 정보',
  uwActOpen: '열기',
  uwDiscardDraftConfirm:
    '이 초안을 버릴까요? 변경 사항이 이 컴퓨터에서 삭제되며 복구할 수 없습니다.',

  // Sign-out prompt
  uwSignOutTitle: 'UniWork에서 로그아웃할까요?',
  uwSignOutBody:
    '저장하지 않은 변경 사항이나 대기 중인 저장이 있는 문서: {count}. 이 문서들은 이 컴퓨터에 잠긴 채 보관되며 내 계정으로만 다시 열 수 있습니다.',
  uwSignOutKeystore:
    '컴퓨터의 키체인이 잠겨 있어 저장하지 않은 변경 사항은 열린 창에만 있습니다. 지금 로그아웃하면 해당 변경 사항이 삭제되며, 이미 암호화되어 보관된 내용은 남습니다. 보관하려면 먼저 컴퓨터 잠금을 해제하세요.',
  uwSignOutGo: '로그아웃',
  uwSignOutWaiting: '로그아웃하기 전에 진행 중인 저장을 마치는 중…',

  // S2 sync center
  uwSyncTitle: '동기화 센터',
  uwSyncOpenFromSettings: '동기화 센터',
  uwSyncOnline: 'UniWork에 연결됨 · {time} 동기화',
  uwSyncOffline: '오프라인 · 마지막 동기화 {time}',
  uwSyncPaused: '전송 일시 중지됨 — 새 저장은 대기합니다',
  uwSyncAdminPaused: '관리자가 전송을 일시 중지했습니다. 저장 내용은 이 컴퓨터에 보관됩니다.',
  uwSyncFeedOff:
    '새 버전 알림이 일시 중지되었습니다. 저장할 때 UniWork는 여전히 충돌을 확인합니다.',
  uwSyncResynced: '{time}에 전체 다시 동기화됨',
  uwSyncResyncFailed:
    '여러 번 시도했지만 다시 동기화하지 못했습니다. 새 버전 알림이 일시 중지되었으며, 저장할 때 UniWork는 여전히 충돌을 확인합니다.',
  uwSyncSignedOut: '로그아웃했습니다. 이 컴퓨터에 잠긴 채 보관된 항목: {count}.',
  uwSyncSignedOutEmpty: '로그아웃했습니다.',
  uwSyncSessionExpired: '세션이 만료되었습니다. 계속 전송하려면 다시 로그인하세요.',
  uwSyncOtherOrg: '다른 조직에서 대기 중인 저장: {count}',
  uwSyncStoreBudget: '이 컴퓨터의 동기화 저장소: {used} / {cap}',
  uwSyncStoreError: '이 컴퓨터의 대기열을 읽을 수 없습니다. 삭제된 것은 없습니다.',
  uwSyncNow: '지금 동기화',
  uwSyncPause: '전송 일시 중지',
  uwSyncResume: '전송 재개',
  uwSyncNowOffline: '동기화하려면 연결이 필요합니다.',
  uwSyncTabAttention: '조치 필요',
  uwSyncTabQueue: '저장 대기',
  uwSyncTabOffline: '오프라인 사용 가능',
  uwSyncTabRecent: '최근 저장됨',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: '문서',
  uwSyncColState: '상태',
  uwSyncColDetail: '세부 정보',
  uwSyncColActions: '작업',
  uwSyncMoreActions: '{doc}에 대한 추가 작업',
  uwSyncEmptyQueue: '저장 대기 중인 항목이 없습니다.',
  uwSyncEmptyAttention: '조치가 필요한 항목이 없습니다.',
  uwSyncEmptyRecent: '최근 저장이 없습니다.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: '오프라인으로 사용 가능하게 설정',
  uwOfflineUnpin: '오프라인 사본 제거',
  uwOfflineUnpinShort: '고정 해제',
  uwOfflineAdd: '문서 추가…',
  uwOfflineUsage: '이 컴퓨터에서 {cap} 중 {used} 사용 중',
  uwOfflineEmpty: '아직 오프라인으로 사용할 수 있는 문서가 없습니다.',
  uwOfflineCapReached:
    '이 컴퓨터의 오프라인 라이브러리가 한도에 도달했습니다: 용량 {cap}, 최대 문서 수 {maxDocs}. 다른 문서를 추가하려면 오프라인 사본 하나를 제거하세요.',
  uwOfflineReady: '오프라인 사용 가능',
  uwOfflineBadgeWaiting: '네트워크 대기 중',
  uwOfflineBadgeDownloading: '다운로드 중',
  uwOfflineBadgeVerifying: '확인 중',
  uwOfflineBadgeUpdate: '업데이트 있음',
  uwOfflineBadgeInterrupted: '준비 안 됨',
  uwOfflineBadgeDiskFull: '공간 부족',
  uwOfflineBadgeCorrupt: '다운로드 손상됨',
  uwOfflineBadgeLeaseSoon: '오프라인 액세스 곧 종료',
  uwOfflineBadgeViewOnly: '오프라인 사용 가능 · 보기 전용',
  uwOfflineRowWaiting: '온라인이 되면 다운로드됨',
  uwOfflineRowProgress: '{done} / {total}',
  uwOfflineRowProgressAria: '{total} 중 {done}',
  uwOfflineRowVerifying: '무결성 확인 중',
  uwOfflineRowReady: '버전 {n} · {size} · {datetime}까지 오프라인 액세스',
  uwOfflineRowUpdate:
    '버전 {n}은(는) 온라인이 되면 다운로드됩니다. 버전 {old}은(는) 계속 사용할 수 있습니다',
  uwOfflineRowUpdateKept:
    '버전 {n}(으)로 업데이트하지 못했습니다: {reason}. 버전 {old}은(는) 계속 사용할 수 있습니다.',
  uwOfflineRowInterrupted:
    '다운로드가 중단되었습니다. 이전 사본(있는 경우)은 계속 사용할 수 있습니다.',
  uwOfflineRowDiskFull: '{size}가 더 필요합니다. 이전 사본은 보관됩니다.',
  uwOfflineRowCorrupt: '손상된 사본을 제거했습니다. 다시 다운로드하세요.',
  uwOfflineRowLeaseSoon: '갱신하려면 {datetime} 전에 연결하세요',
  uwOfflineRowRevoked:
    '이 문서에 더 이상 액세스할 수 없습니다. 다운로드한 사본은 제거되었고 초안은 잠긴 채 보관됩니다.',
  uwOfflineRowDeleted:
    '문서가 UniWork에서 삭제되었습니다. 다운로드한 사본은 제거되었고 초안은 잠긴 채 보관됩니다.',
  uwOfflineRowArchived:
    '문서가 보관되었습니다. 이곳의 사본은 오프라인 액세스가 끝날 때까지 열 수 있습니다.',
  uwOfflineRowMoved: '{workspace}(으)로 이동했습니다. 이곳의 사본은 계속 사용할 수 있습니다.',
  uwOfflineRowViewOnly: '버전 {n} · 보기 전용 · {datetime}까지 오프라인 액세스',
  uwOfflineReadyAnnounce: '오프라인 사용 가능: {doc}',
  uwOfflineUnpinConfirm:
    '다운로드한 사본이 이 컴퓨터에서 제거됩니다. 초안과 대기 중인 저장은 보관됩니다.',
  uwOfflineCancelDownload: '다운로드 취소',
  uwOfflineDownloadNow: '지금 다운로드',
  uwOfflineOpenFolder: '저장 폴더 열기',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: '다시 연결 필요',
  uwLockKeystoreTitle: '이 컴퓨터의 키체인이 잠겨 있습니다',
  uwLockClockTitle: '시간 확인 필요',
  uwLockRevokedTitle: '액세스 권한 없음',
  uwLockDeletedTitle: '문서가 삭제됨',
  uwLockForeignTitle: '다른 계정의 문서',
  uwLockOrgTitle: '이 조직에서 열 수 없음',
  uwLockExpired:
    '오프라인 액세스가 만료되었습니다. 콘텐츠는 암호화된 상태로 유지됩니다. 다시 열려면 연결하세요.',
  uwLockLibraryOff:
    '관리자가 오프라인 문서를 꺼서 오프라인 액세스를 갱신할 수 없습니다. 초안은 동기화 센터에 잠긴 채 보관됩니다.',
  uwLockKeystore:
    '컴퓨터의 키체인이 잠겨 있어 암호화된 콘텐츠를 열 수 없습니다. 잠금을 해제하고 다시 시도하세요. 삭제된 것은 없습니다.',
  uwLockClock:
    '컴퓨터 시계가 뒤로 조정되어 오프라인 액세스가 잠겼습니다. UniWork가 시간을 확인할 수 있도록 연결하세요.',
  uwLockForeign: '이 문서는 이 컴퓨터의 다른 계정 소유입니다. 열려면 해당 계정으로 전환하세요.',
  uwLockSuspended:
    '조직이 정지되었습니다. 콘텐츠는 암호화된 상태로 유지됩니다. 관리자에게 문의하세요.',
  uwLockDeactivated:
    '이 조직에서 계정이 비활성화되었습니다. 콘텐츠는 암호화된 상태로 유지됩니다. 관리자에게 문의하세요.',
  uwLockSignedOutTitle: '로그아웃됨',
  uwLockSignedOut:
    '콘텐츠는 이 컴퓨터에 잠긴 채 보관됩니다. 다시 열려면 같은 계정으로 로그인하세요.',
  uwLockRegion: '문서 상태',
  uwLockWhileOpen:
    '문서가 열려 있는 동안 잠겼습니다. 저장하지 않은 변경 사항은 암호화되어 보관되며, 잠금이 해제될 때까지 저장하거나 복사할 수 없습니다.',
  uwLockWhileOpenRam:
    '문서가 열려 있는 동안 잠겼으며 이 컴퓨터는 아직 변경 사항을 안전하게 보관할 수 없습니다. 변경 사항은 이 창에만 있으며(보기 전용) 창을 닫으면 사라집니다.',
  uwLockOtherWindow: '이 문서는 다른 창에서 편집용으로 열려 있습니다. 이 창은 보기 전용입니다.',
  uwLockOtherWindowGone: '이 문서를 편집하던 창이 응답하지 않습니다. 이 창에서 편집할 수 있습니다.',
  uwLockGoToWindow: '해당 창으로 이동',
  uwLockTakeEdit: '이 창에서 편집',

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
  uwConflictSaveCopyNoSeat:
    '이 문서가 있는 작업 공간의 구성원이 아니어서 사본을 만들지 못했습니다. 변경 사항은 여전히 안전합니다. 내 버전을 다운로드할 수 있습니다.',
  uwConflictDownloadDone:
    '내 버전을 이 컴퓨터에 저장했습니다: {file}. 이 문서는 바뀌지 않았으며, 여전히 다시 불러오거나 덮어쓸 수 있습니다.',
  uwConflictDownloadFailedDesktop:
    '파일을 저장하지 못했습니다. 변경 사항은 여전히 안전합니다. 다시 시도하세요.',
  uwConflictSaveCopyOffline:
    '오프라인 상태입니다. 사본을 만들려면 연결이 필요하며, 변경 사항은 보관됩니다.',
  uwConflictReloadFailed:
    '최신 버전을 불러오지 못했습니다. 문서는 바뀌지 않았습니다. 다시 시도하세요.',
  uwConflictOverwriteFailed: '아직 덮어쓰지 못했습니다. 문서는 바뀌지 않았습니다. 다시 시도하세요.',
  uwConflictClose: '닫기',

  // S5 conflict dialog (desktop)
  uwConflictTitle: '이 문서가 다른 곳에서 변경되었습니다',
  uwConflictBody: '변경 사항은 아직 UniWork에 없으며 이 컴퓨터에 안전하게 있습니다.',
  uwConflictReload: '최신 버전 다시 불러오기',
  uwConflictOverwrite: '덮어쓰기…',
  uwConflictCancel: '취소',
  uwConflictKeepUnavailable:
    '이 컴퓨터는 지금 초안을 보관할 수 없습니다(동기화 저장소가 가득 찼거나 키체인이 잠김).',
  uwConflictOfflineDesktop:
    '오프라인 상태이고 최신 버전이 이 컴퓨터에 없어 아직 다시 불러올 수 없습니다.',
  uwConflictReloadDesktopBody: '버전 {n}을(를) 불러오기 전에 변경 사항을 어떻게 할지 선택하세요.',
  uwConflictKeepDraft: '내 버전을 초안으로 보관',
  uwConflictDiscard: '내 변경 사항 버리기',
  uwConflictKeepDraftHint:
    '초안은 동기화 센터에 남아 보거나 복사할 수 있으며, 새 버전에 자동으로 적용되지 않습니다.',
  uwConflictDraftCapReached:
    '이 문서에 보관할 수 있는 초안 수가 최대에 도달했습니다: {cap}. 다른 초안을 보관하려면 동기화 센터에서 이전 초안을 버리세요.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    '이전 저장에 지원이 필요해 아직 다시 불러오거나 덮어쓸 수 없습니다. 동기화 센터를 열어 해결하세요.',
  uwRemoteRevoked:
    '이 문서에 더 이상 액세스할 수 없습니다. 저장이 중지되었으며, 저장하지 않은 변경 사항은 이 컴퓨터에 잠긴 채 보관됩니다.',
} satisfies Record<keyof typeof zh, string>
