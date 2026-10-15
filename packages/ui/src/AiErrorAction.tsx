import type { ResultChipErrorAction, ResultChipOutput } from '@genoffice/agent-core'
import type { Lang } from '@genoffice/i18n'
import { aiUniworkText } from './strings-ai-uniwork'
import './ai-uniwork-composer/ai-uniwork-composer.css'

export interface AiErrorActionProps {
  /** the turn's result chip; only its S9 `errorLine` action is used */
  readonly chip: ResultChipOutput | null | undefined
  readonly lang: Lang
  /** a Retry-After wait is running: the run continues by itself, so no Retry (S9) */
  readonly waiting?: boolean | undefined
  /** Thử lại: send the turn again */
  readonly onRetry?: (() => void) | undefined
  /** Chọn nhà cung cấp khác: open the model picker / settings */
  readonly onChooseProvider?: (() => void) | undefined
  /** Đăng nhập lại: the existing UniWork sign-in action */
  readonly onSignIn?: (() => void) | undefined
  /** Hỏi tiếp: a new run in the same conversation */
  readonly onAskAgain?: (() => void) | undefined
  /** Mở bằng ứng dụng (web, workbook too large) */
  readonly onOpenInApp?: (() => void) | undefined
}

/**
 * The one labelled action of an S9 error turn (EXPERIENCE error table): a text button, so it has a
 * visible name and is reachable by keyboard. An action the panel has no handler for, a Retry while
 * a rate-limit wait runs, and errors without an action render nothing.
 */
export function AiErrorAction(props: AiErrorActionProps): React.JSX.Element | null {
  const line = props.chip?.errorLine
  if (!line?.action || !line.actionKey) return null
  const handlers: Record<ResultChipErrorAction, (() => void) | undefined> = {
    retry: props.waiting ? undefined : props.onRetry,
    'choose-provider': props.onChooseProvider,
    'sign-in': props.onSignIn,
    'ask-again': props.onAskAgain,
    'open-in-app': props.onOpenInApp,
  }
  const onClick = handlers[line.action]
  if (!onClick) return null
  return (
    <div className="ai-error-action">
      <button
        type="button"
        className="ai-uniwork-composer-note-action"
        data-action={line.action}
        onClick={onClick}
      >
        {aiUniworkText(props.lang, line.actionKey)}
      </button>
    </div>
  )
}
