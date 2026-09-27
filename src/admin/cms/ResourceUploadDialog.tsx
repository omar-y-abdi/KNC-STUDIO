import type { JSX } from 'preact'
import type { CmsBarber } from '../../../shared/cms'
import type { ResourceDestination } from '../../../shared/cms-resource-assignment'
import { CmsModal } from './Modal'
import { ResourceDestinationFields } from './ResourceDestination'

interface Props {
  destination: ResourceDestination
  barbers: readonly CmsBarber[]
  busy: boolean
  error: string
  onChange: (destination: ResourceDestination) => void
  onClose: () => void
  onUpload: (files: File[], destination: ResourceDestination) => void
}
export function ResourceUploadDialog(props: Props): JSX.Element {
  const { destination, busy } = props
  return (
    <CmsModal
      title="Ladda upp resurs"
      onClose={() => {
        if (!busy) props.onClose()
      }}
    >
      <p>
        Välj var filen ska användas. Tilldelningen sparas i utkastet, inte på den publicerade sidan.
      </p>
      <ResourceDestinationFields
        label="Placera i"
        value={destination}
        onChange={props.onChange}
        barbers={props.barbers}
      />
      <label class="cms-file-choice">
        Välj filer
        <input
          type="file"
          multiple
          disabled={busy || (destination.purpose === 'profile' && !destination.barberId)}
          accept={
            destination.purpose === 'fonts'
              ? '.woff2'
              : destination.purpose === 'library'
                ? 'image/*,.woff2'
                : 'image/*'
          }
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (files.length) props.onUpload(files, destination)
          }}
        />
      </label>
      {busy && <p role="status">Laddar upp…</p>}
      {props.error && <p role="alert">{props.error}</p>}
    </CmsModal>
  )
}
