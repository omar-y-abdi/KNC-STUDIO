import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

export function integrate(root) {
  const ts = createRequire(resolve(root, 'package.json'))('typescript')
  const path = resolve(root, 'supabase/functions/_shared/email.ts')
  const original = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = new Set(['EmailLanguage', 'EmailTemplateName', 'EmailTemplateCopy', 'EmailDetailRow', 'EmailMessage', 'EmailBuildInput', 'EmailBusiness', 'SITE_URL', 'SENDING_MAILBOX', 'DEFAULTS', 'defaultEmailTemplate', 'interpolate', 'escapeHtml', 'htmlText', 'rowsHtml', 'buildEmailMessage'])
  const selected = source.statements.filter(node => names.has(node.name?.text ?? (ts.isVariableStatement(node) ? node.declarationList.declarations[0]?.name.getText(source) : '')))
  if (selected.length !== names.size) throw new Error('Email extraction does not match the pinned renderer')
  let shared = selected.map(node => node.getText(source)).join('\n\n')
  shared = shared.replace('interface EmailBuildInput {', 'export interface EmailBuildInput {\n  readonly previewMode?: CmsMode')
  shared = shared.replace('export interface EmailTemplateCopy {', 'export interface EmailTemplateCopy {\n  readonly design?: EmailDesign\n  readonly designLogoUrl?: string')
  shared = shared.replace('  const html = `<!doctype html>', '  const defaultHtml = `<!doctype html>')
  shared = shared.replace('    html,\n', '    html: input.copy.design ? renderDesignedEmail(input, input.copy.design, input.previewMode) : defaultHtml,\n')
  if (!shared.includes('const defaultHtml') || !shared.includes('html: input.copy.design')) throw new Error('Email renderer integration anchor changed')
  shared = "import type { CmsMode, EmailDesign } from './cms.ts'\nimport { renderDesignedEmail } from './cms-email.ts'\n\n" + shared + '\n'
  mkdirSync(resolve(root, 'shared'), { recursive: true })
  writeFileSync(resolve(root, 'shared/email.ts'), shared)

  let server = original
  for (const node of [...selected].reverse()) server = server.slice(0, node.getFullStart()) + server.slice(node.end)
  server = server.replace('const fallback = DEFAULTS[template][lang]', 'const fallback = defaultEmailTemplate(template, lang)')
  const anchor = '    contactLead: nonEmpty(row.contact_lead) ? row.contact_lead : null,\n'
  if (!server.includes(anchor)) throw new Error('Email loader integration anchor changed')
  server = server.replace(anchor, anchor + '    ...deliveryDesign(row.design, client),\n')
  const types = ['EmailLanguage', 'EmailTemplateName', 'EmailTemplateCopy', 'EmailDetailRow', 'EmailMessage', 'EmailBuildInput', 'EmailBusiness'].filter(name => new RegExp(`\\b${name}\\b`).test(server))
  server = "import { defaultEmailTemplate, " + types.map(name => `type ${name}`).join(', ') + " } from '../../../shared/email.ts'\nexport * from '../../../shared/email.ts'\nimport { validateEmailDesign, mediaUrl } from '../../../shared/cms.ts'\n" + server
  server += `\nfunction deliveryDesign(raw: unknown, client: SupabaseClient): Partial<EmailTemplateCopy> {
  if (raw === null || raw === undefined) return {}
  try {
    validateEmailDesign(raw)
    if (!raw.logo) return { design: raw }
    const origin = typeof Deno !== 'undefined' ? Deno.env.get('PUBLIC_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') : undefined
    const url = origin ? mediaUrl(raw.logo, origin) : client.storage.from(raw.logo.bucket).getPublicUrl(raw.logo.path).data.publicUrl
    return { design: raw, designLogoUrl: url }
  } catch {
    // A corrupt legacy design never creates executable mail or drops a transactional message.
    return {}
  }
}\n`
  writeFileSync(path, server)
  console.log('Email preview and delivery now import the same pure renderer; no sending code enters the browser bundle.')
}
