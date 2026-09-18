import { fontOptions } from '../../../shared/cms-fonts'
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import {
  STYLE_KEYS,
  type CmsDocument,
  type CmsLang,
  type CmsMode,
  type CssMap,
  type CmsAsset,
  type CopyGroup,
} from '../../../shared/cms'
import {
  contentValue,
  setContent,
  baseCopy,
  copyBinding,
  COPY_LABELS,
  SETTING_LABELS,
} from './catalog'
import { Field, Select } from './controls'
import type { CanvasNode } from './Preview'
import { fontAssetForFamily, resourceFontOptions } from './resourceLifecycle'

type Change = (operation: (draft: CmsDocument) => void, group?: string) => void
export function NativeInspector({
  document,
  node,
  lang,
  mode,
  edit,
  select,
  pickImage,
}: {
  document: CmsDocument
  node: CanvasNode | null
  lang: CmsLang
  mode: CmsMode
  edit: Change
  select: (id: string) => void
  pickImage: (choose: (asset: CmsAsset) => void) => void
}): JSX.Element {
  const [scope, setScope] = useState<'base' | CmsMode | 'mobile' | 'desktop'>('base'),
    [expanded, setExpanded] = useState(false)
  if (!node)
    return (
      <div class="cms-empty-inspector">
        <h2>Välj ett element</h2>
        <p>
          Klicka i förhandsvisningen för att redigera text, bilder och utseende. Dubbelklicka på
          text för direktredigering. Boknings- och inloggningsfunktioner behåller sina befintliga
          kopplingar.
        </p>
      </div>
    )
  const values = document.presentation.styles[node.id]?.[scope] ?? {}
  const set = (key: string, value: string): void =>
    edit((draft) => {
      draft.presentation.styles[node.id] ??= {}
      const variants = draft.presentation.styles[node.id]
      if (!variants) return
      const next: CssMap = { ...(variants[scope] ?? {}) }
      if (value.trim()) next[key] = value.trim()
      else Reflect.deleteProperty(next, key)
      if (Object.keys(next).length) variants[scope] = next
      else Reflect.deleteProperty(variants, scope)
      if (Object.keys(variants).length === 0)
        Reflect.deleteProperty(draft.presentation.styles, node.id)
    }, `style:${node.id}:${scope}:${key}`)
  return (
    <>
      <div class="cms-inspector-title">
        <span>{node.tag}</span>
        <strong>{node.label || node.id}</strong>
      </div>
      {node.parent && (
        <button type="button" onClick={() => select(node.parent ?? '')}>
          Välj överordnat lager
        </button>
      )}
      {node.binding && (
        <Field
          label={`Text · ${lang.toUpperCase()}`}
          value={contentValue(document, node.binding, lang)}
          onChange={(value) =>
            edit(
              (draft) => setContent(draft, node.binding ?? '', lang, value),
              `copy:${node.binding}:${lang}`,
            )
          }
          multiline
        />
      )}
      {node.image && (
        <>
          <button
            type="button"
            onClick={() =>
              pickImage((asset) => {
                if (!asset.mime.startsWith('image/'))
                  throw new Error('Välj en bild, inte ett typsnitt.')
                edit((draft) => {
                  draft.presentation.images[node.id] = {
                    ref: { bucket: asset.bucket, path: asset.path },
                    alt: { sv: asset.alt, en: asset.alt },
                  }
                })
              })
            }
          >
            Byt bild
          </button>
          {document.presentation.images[node.id] && (
            <>
              <Field
                label={`Alttext · ${lang.toUpperCase()}`}
                value={document.presentation.images[node.id]?.alt[lang] ?? ''}
                onChange={(value) =>
                  edit((draft) => {
                    const image = draft.presentation.images[node.id]
                    if (image) image.alt[lang] = value
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  edit((draft) => {
                    Reflect.deleteProperty(draft.presentation.images, node.id)
                  })
                }
              >
                Återställ ursprunglig bild
              </button>
            </>
          )}
        </>
      )}
      <Select
        label="Gäller för"
        value={scope}
        options={[
          ['base', 'Alla lägen'],
          ['light', 'Ljust tema'],
          ['dark', 'Mörkt tema'],
          ['desktop', 'Dator'],
          ['mobile', 'Mobil'],
        ]}
        onChange={(value) => setScope(value as typeof scope)}
      />
      <p class="cms-help">
        Förhandsvisning: {mode === 'dark' ? 'mörkt' : 'ljust'}. Tomt värde behåller webbplatsens
        originalstil.
      </p>
      <div class="cms-property-grid">
        {(
          [
            ['fontSize', 'Textstorlek'],
            ['fontWeight', 'Textvikt'],
            ['lineHeight', 'Radhöjd'],
            ['letterSpacing', 'Teckenavstånd'],
            ['color', 'Textfärg'],
            ['backgroundColor', 'Bakgrund'],
            ['width', 'Bredd'],
            ['height', 'Höjd'],
            ['maxWidth', 'Maxbredd'],
            ['gap', 'Mellanrum'],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            label={label}
            value={values[key] ?? ''}
            onChange={(value) => set(key, value)}
            maxLength={160}
            hint={node.styles[key]}
          />
        ))}
      </div>
      <Select
        label="Typsnitt"
        value={values['fontFamily'] ?? ''}
        options={fontOptions(document.presentation)}
        onChange={(value) => set('fontFamily', value)}
      />
      <Select
        label="Textjustering"
        value={values['textAlign'] ?? ''}
        options={[
          ['', 'Original'],
          ['left', 'Vänster'],
          ['center', 'Centrerad'],
          ['right', 'Höger'],
          ['justify', 'Marginaljusterad'],
        ]}
        onChange={(value) => set('textAlign', value)}
      />
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>Layout, avstånd och fler egenskaper</summary>
        <div class="cms-property-grid">
          {STYLE_KEYS.filter(
            (key) =>
              ![
                'fontSize',
                'fontWeight',
                'lineHeight',
                'letterSpacing',
                'color',
                'backgroundColor',
                'width',
                'height',
                'maxWidth',
                'gap',
                'textAlign',
              ].includes(key),
          ).map((key) => (
            <Field
              key={key}
              label={key}
              value={values[key] ?? ''}
              onChange={(value) => set(key, value)}
              maxLength={160}
            />
          ))}
        </div>
      </details>
      <button
        type="button"
        onClick={() =>
          edit((draft) => {
            Reflect.deleteProperty(draft.presentation.styles, node.id)
          })
        }
      >
        Återställ elementets alla stiländringar
      </button>
    </>
  )
}
export function CopyInspector({
  document,
  lang,
  edit,
}: {
  document: CmsDocument
  lang: CmsLang
  edit: Change
}): JSX.Element {
  const [group, setGroup] = useState<CopyGroup>('app'),
    [search, setSearch] = useState('')
  const fields = Object.keys(baseCopy(group, lang)).filter((key) =>
    `${key} ${contentValue(document, copyBinding(group, key), lang)}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  )
  return (
    <>
      <h2>Alla webbplatstexter</h2>
      <Select
        label="Område"
        value={group}
        options={Object.entries(COPY_LABELS)}
        onChange={(value) => setGroup(value as CopyGroup)}
      />
      <input
        type="search"
        class="cms-search"
        aria-label="Sök textfält"
        placeholder="Sök text eller fältnamn"
        value={search}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <p class="cms-help">
        Även felmeddelanden, tomma lägen, tillgänglighetstexter och etiketter som inte syns just nu
        kan ändras här. Behåll eventuella {'{variabler}'}.
      </p>
      {fields.map((key) => {
        const binding = copyBinding(group, key)
        return (
          <Field
            key={key}
            label={`${key} · ${lang.toUpperCase()}`}
            value={contentValue(document, binding, lang)}
            onChange={(value) =>
              edit(
                (draft) => setContent(draft, binding, lang, value),
                `copy:${group}:${key}:${lang}`,
              )
            }
            multiline
          />
        )
      })}
    </>
  )
}
export function BusinessInspector({
  document,
  edit,
}: {
  document: CmsDocument
  edit: Change
}): JSX.Element {
  return (
    <>
      <h2>Varumärke och kontakt</h2>
      <p class="cms-help">
        Dessa uppgifter används av hemsidan och de faktiska bokningsmejlen. Ändringar publiceras
        tillsammans med resten av utkastet.
      </p>
      {Object.entries(SETTING_LABELS).map(([key, label]) => (
        <Field
          key={key}
          label={label}
          value={document.settings[key] ?? ''}
          onChange={(value) =>
            edit((draft) => {
              draft.settings[key] = value
            }, `setting:${key}`)
          }
          multiline={key.startsWith('seo_description')}
          maxLength={500}
        />
      ))}
    </>
  )
}
export function ThemeInspector({
  document,
  assets,
  mode,
  edit,
}: {
  document: CmsDocument
  assets: CmsAsset[]
  mode: CmsMode
  edit: Change
}): JSX.Element {
  const theme = document.presentation.themes[mode]
  return (
    <>
      <h2>{mode === 'dark' ? 'Mörkt' : 'Ljust'} tema</h2>
      <p class="cms-help">
        Färgerna är separata för ljust och mörkt läge. Utan egna värden behålls webbplatsens
        original.
      </p>
      {(
        [
          ['background', 'Sidbakgrund'],
          ['surface', 'Ytor'],
          ['text', 'Text'],
          ['muted', 'Sekundär text'],
          ['accent', 'Accent'],
          ['accentText', 'Text på accent'],
          ['border', 'Kantlinjer'],
        ] as const
      ).map(([key, label]) => (
        <div class="cms-theme-color" key={key}>
          <Field
            label={label}
            type="color"
            value={theme[key] ?? (mode === 'dark' ? '#1c1c1e' : '#ffffff')}
            onChange={(value) =>
              edit((draft) => {
                draft.presentation.themes[mode][key] = value
              })
            }
          />
          <button
            type="button"
            disabled={!theme[key]}
            aria-label={`Återställ ${label}`}
            onClick={() =>
              edit((draft) => {
                Reflect.deleteProperty(draft.presentation.themes[mode], key)
              })
            }
          >
            Återställ
          </button>
        </div>
      ))}
      <Select
        label="Sidans typsnitt"
        value={theme['fontFamily'] ?? ''}
        options={resourceFontOptions(document.presentation, assets)}
        onChange={(value) =>
          edit((draft) => {
            const font = fontAssetForFamily(assets, value)
            if (font) {
              draft.presentation.fonts ??= {}
              draft.presentation.fonts[font.id] = {
                ref: { bucket: font.bucket, path: font.path },
                name: font.name,
              }
            }
            if (value) draft.presentation.themes[mode]['fontFamily'] = value
            else delete draft.presentation.themes[mode]['fontFamily']
          })
        }
      />
    </>
  )
}
