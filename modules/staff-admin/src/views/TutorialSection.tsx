// The "Tutorial" box in Settings: run the staff tutorial again, or remove it.

import type { JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import type { Lang } from '@bladeblend/public-web/localization'
import { adminText } from '../adminStrings'
import type { TutorialControls } from '../tour/useStaffTour'
import type { AdminStylesBundle } from './viewTypes'

export interface TutorialSectionProps {
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly headingStyle: JSX.CSSProperties
  readonly controls: TutorialControls
}

type SaveState = 'idle' | 'saving' | 'failed'

export function TutorialSection(props: TutorialSectionProps): JSX.Element {
  const { s, controls } = props
  const t = adminText(props.lang)
  const [save, setSave] = useState<SaveState>('idle')
  const saving = save === 'saving'
  // Two clicks in one turn both see the old render's `saving`.
  const inFlight = useRef(false)

  const run = async (action: () => Promise<boolean>): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setSave('saving')
    const saved = await action()
    inFlight.current = false
    setSave(saved ? 'idle' : 'failed')
  }

  return (
    <section aria-labelledby="settings-tutorial-heading">
      <h3 id="settings-tutorial-heading" style={props.headingStyle}>
        {t.tutorialTitle}
      </h3>
      <p aria-live="polite" style={{ ...s.mutedText, margin: '0 0 16px', lineHeight: 1.5 }}>
        {controls.removed ? t.tutorialRemovedLead : t.tutorialLead}
      </p>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
        <button
          type="button"
          style={{ ...s.primaryBtn, opacity: saving ? 0.6 : 1 }}
          disabled={saving}
          onClick={() => void run(controls.replay)}
        >
          {t.tutorialReplay}
        </button>
        {controls.removed ? null : (
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: saving ? 0.6 : 1 }}
            disabled={saving}
            onClick={() => void run(controls.remove)}
          >
            {t.tutorialRemove}
          </button>
        )}
      </div>
      {save === 'failed' ? (
        <p role="alert" style={{ ...s.errorText, margin: '10px 0 0' }}>
          {t.tutorialSaveError}
        </p>
      ) : null}
    </section>
  )
}
