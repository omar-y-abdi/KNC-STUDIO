---
version: alpha
name: Blade & Blend Studio CMS
description: A calm editing workspace based on the owner's O-Y-A Studio reference.
colors:
  primary: '#234ce7'
  background: '#f2f4ee'
  surface: '#fffef9'
  text: '#252a24'
  muted: '#5e6856'
  border: '#dbe2d2'
  selected: '#edf0ff'
typography:
  sans:
    fontFamily: 'Inter Variable, Inter, system-ui, sans-serif'
  mono:
    fontFamily: 'ui-monospace, monospace'
rounded:
  DEFAULT: '7px'
  dialog: '14px'
spacing:
  sidebar: '220px'
  inspector: '292px'
  header: '72px'
components:
  button: {}
  input: {}
  workspace: {}
  dialog: {}
---

# CMS design

## Purpose and visual direction

Scope: `/admin/cms` only. The existing BNB mark anchors a paper-colored editor with a pale sage canvas, blue selection and a dark olive command dock. The working page stays central; chrome must not compete with salon content. Swedish controls edit separate Swedish and English content. Website branding and light/dark variants remain independent of the editor theme.

## Canonical tokens

`studio.css` owns the tokens above: `primary → --accent`, `background → --bg`, `surface → --panel`, `text → --ink`, `muted → --muted`, `border → --line`, `selected → --selected`. GrapesJS manager tokens map to the same surfaces and text colors; inherited-property indicators use darker amber on paper, never the vendor's dark-theme yellow. The canvas iframe does not inherit chrome tokens. No token generator or new UI dependency is involved.

## Typography and hierarchy

The application's existing Inter Variable is used at 13px/1.5. Supporting labels are 11–12px; property values retain normal 400 weight, even inside GrapesJS sectors. Inputs use 16px on compact touch layouts. Paths use monospace. Publication is the only persistent filled blue action. Selection, text, icon and focus indicators accompany color; errors use a persistent textual alert.

## Layout and responsive behavior

Above 900px: a 220px page library, flexible canvas and 292px inspector. The header is at least 72px, the canvas toolbar at least 58px. Below 1100px the side panels tighten. Resource, business, email, theme and history destinations overlay the canvas without destroying its mounted state.

At 900px and below, pages and properties become mutually exclusive modal drawers with their own close control, trapped focus and inert background. The page library uses one scroll flow with a sticky heading, not a shrinking nested list. The full-width dock has a navigation row and command row; phone landscape condenses it into one row. Short workspaces scroll as a whole so headings cannot consume the form's only scrolling area.

The initial canvas follows the operator's device. Dator/Mobil remains an explicit independent choice thereafter. Fit considers both viewport dimensions. Comparison keeps a second, independently sized viewport. History review follows the selected device; palette and email editors have explicit touch preview destinations. The block catalogue is a two-column grid of named, keyboard-operable controls with restrained structural icons.

## Components and states

`useResponsivePanels.ts` owns compact drawer behavior. `focus.ts`, `Modal.tsx` and `WorkspaceView.tsx` keep focus inside active tasks and restore it to a visible opener. `editorAccessibility.ts` names externally rendered manager controls and provides keyboard activation without changing page models.

Publication stays in the header across destinations. Loading, unpublished changes, conflicts and failures remain explicit. Empty page search offers reset. Resources distinguish active, archived and trashed assets; an invalid reference scan displays an unchecked state rather than a false zero. Local usage inspection observes the same native-page allowances as publication while authored content retains its narrower limits.

## Review and regression evidence

Run browser verification against isolated fixture APIs, not production credentials. `cms-workspace.mjs` checks drawer semantics, keyboard navigation, touch-sized commands, single-flow navigation and phone landscape. `cms-workspace-views.mjs` captures every destination, long-content scroll positions, dialogs, error states, both content themes and historical previews, with optional axe audits via `AXE_PATH`. `cms-owner.mjs` exercises keyboard block insertion, publication, reload, media lifecycle, real email rendering and revision restoration in Chromium and WebKit.

The public-layout breakpoint is separate from chrome: mobile through 768px, desktop above it. Mobile canvas folding uses temporary display geometry outside the saved page model. Existing native, responsive, scene, projection, conflict and public reload suites remain required. Screenshots are evidence for a named source tree, not substitutes for interaction tests.
