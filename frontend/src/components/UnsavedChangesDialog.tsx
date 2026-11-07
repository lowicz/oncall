import { useMessages } from '../i18n'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { ConfirmDialog } from './ConfirmDialog'

/** The one question `useUnsavedChanges` asks; `detail` names what would be lost. */
export function UnsavedChangesDialog({ guard, detail }: {
  guard: ReturnType<typeof useUnsavedChanges>
  detail?: string
}) {
  const t = useMessages().common.unsavedChanges
  return (
    <ConfirmDialog
      open={guard.open}
      title={t.title}
      description={detail ? <>{detail}<br />{t.description}</> : t.description}
      confirmLabel={t.confirm}
      confirmColor="warning"
      onCancel={guard.cancel}
      onConfirm={guard.discard}
    />
  )
}
