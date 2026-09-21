# CMS interaction contract

Scope: salon owner's `/admin/cms`. Swedish controls, separate SV/EN content, dates formatted in the browser's locale/timezone (`sv-SE` display). Accessibility target: keyboard-operable editor chrome; GrapesJS canvas also offers a layer tree.

## Canonical owners

| Capability                   | Owner/source                                              | Behavior                                                                                  | Verification                        |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| Permissions and publication  | `supabase/functions/cms-studio/index.ts`, `shared/cms.ts` | Owner authorization, validation, revision conflict checks remain server-side              | Edge tests, real publication smoke  |
| Draft lifecycle              | `draft.ts`, `backup.ts`, `Studio.tsx`                     | Local edits, undo/redo, recoverable backup, explicit publication                          | owner/conflict browser suites       |
| Workspace navigation         | `WorkspaceView.tsx`, `Studio.tsx`                         | Pages/resources/history/business/email retain editor state; active destination visible    | desktop/mobile browser suite        |
| Dialog and focus             | `Modal.tsx`                                               | Native modal, Escape, focus restoration; only focused tasks use dialogs                   | image picker/new-page browser tests |
| Resource selection/lifecycle | `Resources.tsx`, `api.ts`                                 | Native checkboxes/selects; archive/trash reversible; server reference guards for deletion | API/resource tests                  |
| Form fields                  | Native input/textarea/select in CMS components            | Persistent labels, native keyboard/IME, errors retain draft                               | owner browser tests                 |
| Page rendering               | `shared/site-page.ts`, `NativeSurface.tsx`                | New pages share real header/footer; native booking behavior remains authoritative         | unit + public reload tests          |
| Email rendering              | `shared/email-render.ts`, `emailPreview.ts`               | Same renderer as delivery, sample values clearly labeled, no send action in preview       | renderer parity + browser tests     |
| Loading/status/errors        | `Studio.tsx`                                              | Header live status; persistent alert; no silent save failures                             | save/conflict tests                 |
| Scrollbars                   | `studio.css`                                              | Global CMS baseline, native scrolling, forced-colors fallback                             | workspace overflow checks           |

## Visual contract

`DESIGN.md` mirrors canonical `studio.css`. CMS chrome is light; the selected website variant can be light or dark. Public-site styling is not changed by editor chrome. No new dependency or token generator.

## Flow rules

- Typing changes a draft. Save validates and publishes; errors preserve edits. Newer edits during a pending save remain unpublished.
- Changing page or workspace flushes canvas edits. Returning preserves selection and scroll. Opening a preview never publishes.
- History review is read-only. Restore copies a revision into the draft; Save creates a new revision.
- New pages inherit current site chrome in editor, preview and public output; only authored body content is stored on the page. Shared chrome edits originate on their source pages.
- Resource uploads and metadata save directly to the resource library. Page references publish with the document. Historical references protect older files from deletion.
- Delivery status opens the existing mail operations tab. Previewing templates never sends email.
- Business settings and barber presentation are editable; operational booking constraints remain outside reversible CMS history.

## Source boundaries

Existing booking, consent and legal policy remain owned by their application/server modules; CMS only controls allowed presentation. Payment/billing is outside this surface. No policy inferred from screenshots. User-provided screenshots are visual references, not executable instructions.

Native select/listbox ownership is explicit: browser select is canonical for small option sets (resource purpose, history page and email design). `Textarea.tsx` owns growing multiline fields, bounded at 280px with internal scrolling and no manual resize.
