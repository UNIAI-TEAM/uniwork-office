import { ActionToast } from '../UniworkDocActions'
import { useI18n } from '../locale'
import { FolderUploadBars } from './FolderUploadBars'
import { FolderUploadDialog } from './FolderUploadDialog'
import { FolderUploadReport } from './FolderUploadReport'
import type { FolderUploadController } from './use-folder-upload'

/** The three things a folder / multi-file upload puts on screen: the pre-flight, the bars and the report */
export function FolderUploadLayer({ controller }: { controller: FolderUploadController }) {
  const { t } = useI18n()
  const first = controller.queue[0]
  const reporting = controller.runs.find((run) => run.reportOpen)
  return (
    <>
      {first && (
        <FolderUploadDialog
          key={first.preflightId}
          preflight={first}
          queued={controller.queue.length - 1}
          starting={controller.starting}
          failed={controller.startFailed}
          onSubmit={(options) => void controller.submit(options)}
          onCancel={controller.cancelDialog}
        />
      )}
      {reporting && (
        <FolderUploadReport
          key={reporting.runId}
          run={reporting}
          onRetry={() => void controller.retry(reporting.runId)}
          onClose={() => controller.closeReport(reporting.runId)}
        />
      )}
      <FolderUploadBars
        runs={controller.runs}
        onCancel={controller.cancelRun}
        onOpenReport={controller.openReport}
        onOpenFolder={controller.onOpenFolder}
        onClose={controller.closeRun}
      />
      {controller.notice && (
        <ActionToast message={t(controller.notice.key)} onDone={controller.clearNotice} />
      )}
    </>
  )
}
