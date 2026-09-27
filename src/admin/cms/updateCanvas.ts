import { configureComponent } from './editorPolicy'
import type { Component, ComponentDefinitionDefined, CssRuleJSON, Editor } from 'grapesjs'

type Definition = ComponentDefinitionDefined
const children = (value: Definition | Definition[] | undefined): Definition[] =>
  value ? (Array.isArray(value) ? value : [value]) : []
const equalAttributes = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((key) => a[key] === b[key])

/** Reuse native models for text/attribute/theme changes. Structural changes keep
 * the normal GrapesJS import path; never reconcile different native identities. */
export function updateNativeCanvas(editor: Editor, html: string, rules: CssRuleJSON[]): boolean {
  const wrapper = editor.getWrapper()
  if (!wrapper || !html.includes('data-knc-native="1"')) return false
  const parsed = editor.Parser.parseHtml(html, { asDocument: false })
  if (parsed.css?.length) return false
  const changes: (() => void)[] = []
  const inline: (() => void)[] = []
  const plan = (parent: Component, definitions: Definition[]): boolean => {
    const models: Component[] = parent.components().models
    const sameIdentity = (model: Component, definition: Definition | undefined): boolean => {
      if (!definition) return false
      const attributes = model.getAttributes({ noClass: true, noStyle: true })
      return (
        (definition['type'] ?? '') === model.get('type') &&
        (model.is('textnode') ||
          attributes['data-knc-native'] === '1' ||
          model.get('attributes')?.['id'] === definition['attributes']?.['id']) &&
        (definition['type'] === 'textnode' ||
          (definition['tagName'] ?? 'div').toLowerCase() ===
            String(model.get('tagName')).toLowerCase()) &&
        [
          'data-knc-source',
          'data-knc-slot',
          'data-editor-about-slot',
          'data-knc-surface',
          'data-knc-required',
          'data-knc-native',
          'data-knc-fold',
        ].every((key) => attributes[key] === definition['attributes']?.[key])
      )
    }
    if (
      models.length !== definitions.length ||
      models.some((model, i) => !sameIdentity(model, definitions[i]))
    ) {
      // Plain copy can gain/lose text nodes or line breaks between languages.
      // No identified/styled element may be discarded by this fast path.
      const plain = (definition: Definition): boolean =>
        (definition['type'] === 'textnode' || definition['tagName'] === 'br') &&
        !Object.keys(definition['attributes'] ?? {}).length &&
        !Object.keys(definition['style'] ?? {}).length &&
        !definition['classes']?.length
      if (
        !definitions.every(plain) ||
        !models.every(
          (model) =>
            model.is('textnode') ||
            (model.get('tagName') === 'br' && !Object.keys(model.getAttributes()).length),
        )
      )
        return false
      changes.push(() => {
        parent.components(definitions)
        parent
          .components()
          .forEach((child: Component) => configureComponent(child, { silent: true }))
      })
      return true
    }
    for (const [index, model] of models.entries()) {
      const definition = definitions[index]
      if (!definition) return false
      if (!plan(model, children(definition.components))) return false
      const attributes = { ...definition['attributes'] }
      if (!model.is('textnode') && !equalAttributes(model.get('attributes') ?? {}, attributes))
        changes.push(() => model.setAttributes(attributes))
      const classes = (definition['classes'] ?? []).map((item: string | { name: string }) =>
        typeof item === 'string' ? item : item.name,
      )
      if (model.getClasses().join(' ') !== classes.join(' '))
        changes.push(() => model.setClass(classes))
      const content = definition['content'] ?? ''
      if (model.get('content') !== content)
        changes.push(() => {
          model.set('content', content)
          // GrapesJS text-node views do not handle content changes like element views.
          if (model.is('textnode')) model.getView()?.render()
        })
      if (definition['style'] && Object.keys(definition['style']).length)
        inline.push(() => model.setStyle(definition['style']))
    }
    return true
  }
  if (!plan(wrapper, children(parsed.html))) return false
  editor.UndoManager.skip(() => {
    for (const change of changes) change()
    // One collection reset renders CSS into a fragment instead of appending every
    // new rule into the live canvas. Preserve rule order and GrapesJS media handling.
    editor.Css.getAll().reset(rules)
    for (const apply of inline) apply()
  })
  return true
}
