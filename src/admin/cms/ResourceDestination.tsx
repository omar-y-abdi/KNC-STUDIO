import type { JSX } from 'preact'
import type { CmsBarber } from '../../../shared/cms'
import {
  RESOURCE_PURPOSES,
  type ResourceDestination,
  type ResourcePurpose,
} from '../../../shared/cms-resource-assignment'

export function destinationFor(purpose: ResourcePurpose, barberId = ''): ResourceDestination {
  return purpose === 'profile' ? { purpose, barberId } : { purpose }
}

export function ResourceDestinationFields({
  label,
  value,
  onChange,
  barbers,
  files = 'all',
}: {
  label: string
  value: ResourceDestination
  onChange: (destination: ResourceDestination) => void
  barbers: readonly CmsBarber[]
  files?: 'all' | 'image' | 'font'
}): JSX.Element {
  const purposes = Object.entries(RESOURCE_PURPOSES).filter(([purpose]) =>
    files === 'font'
      ? ['library', 'fonts'].includes(purpose)
      : files === 'image'
        ? purpose !== 'fonts'
        : true,
  )
  return (
    <>
      <label>
        {label}
        <select
          aria-label={label}
          value={value.purpose}
          onChange={(event) => {
            const purpose = event.currentTarget.value as ResourcePurpose
            onChange(
              destinationFor(
                purpose,
                value.purpose === 'profile' ? value.barberId : barbers[0]?.id,
              ),
            )
          }}
        >
          {purposes.map(([purpose, title]) => (
            <option key={purpose} value={purpose}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {value.purpose === 'profile' && (
        <label>
          Barberare
          <select
            aria-label="Barberare för profilbild"
            value={value.barberId}
            onChange={(event) =>
              onChange({ purpose: 'profile', barberId: event.currentTarget.value })
            }
          >
            <option value="" disabled>
              Välj barberare
            </option>
            {barbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}
