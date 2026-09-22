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
  header: '65px'
components:
  button: {}
  input: {}
  workspace: {}
  dialog: {}
---

# CMS design

## Overview

Scope: `/admin/cms` only. Owner-provided O-Y-A screenshots and `/Users/k/dev/o-y-a/src/cms/styles.css` define the visual direction: quiet paper panels, pale green canvas, blue selection, contextual inspector and a floating dark command dock. This is a working editor for a Swedish salon owner; Swedish UI edits separate Swedish and English website content. Website branding and light/dark variants remain independent from editor chrome.

## Colors and token ownership

Model B: `studio.css` is canonical. This file mirrors its tokens. `primary → --accent`, `background → --bg`, `surface → --panel`, `text → --ink`, `muted → --muted`, `border → --line`, `selected → --selected`. Every CMS component consumes these variables directly; no framework adapter or generated theme exists. Review token changes together with this mapping and browser screenshots. Blue identifies selection, focus and publication. Errors include text and use the existing notice surface.

## Typography

Inter is already shipped by the application. Default 13px/1.5; secondary labels 11–12px; workspace headings 24–34px with restrained negative tracking. Technical paths use monospace. The compact BNB serif mark identifies the editor. Content in frames keeps its own typography.

## Layout

Desktop: 220px page library, flexible canvas, 292px contextual inspector. Header 65px; canvas toolbar 58px. Page settings appear only when no element is selected. Resources, history, business, email and website style are full workspace destinations. Website style pairs a 300px palette/type form with a live public preview; below 1100px these stack. New-page, backup, image selection and revision review are focused dialogs. Canvas state stays mounted while visiting another destination.

Below 900px, page library and inspector become explicit drawers; workspace views fill available width. Forms stack and the dark command dock uses six touch-sized cells; secondary draft actions live in Utkast & backup. Drawers isolate the canvas with declarative inert, trap keyboard focus and restore the opener on dismissal. Compare uses two adjacent viewports, not an overlay. Fit considers viewport width and height (1440×900 desktop, 390×844 mobile).

## Elevation and shapes

Borders and surface tones carry hierarchy. Only the floating dock, mobile drawers and modal backdrop use elevation. Controls use the 7px radius; dialogs use 14px. No decorative cards around every setting, gradients or entrance animation.

## Components and states

Buttons retain semantic disabled/pressed states and visible keyboard focus. The header owns publication status; errors remain readable until dismissed. Language/theme switches affect page content only. Workspace headings receive focus on navigation; Escape returns to the editor. Native dialogs trap focus and return it to their opener. Resources have explicit empty/search-empty states and show dimensions/type before selection. Forms use persistent labels. Native preview loading, timeout and retry are explicit. Readiness is accepted only from the current same-origin frame and matching request; obsolete responses cannot clear newer feedback. Desktop email controls scroll independently so the actual delivery preview stays visible. GrapesJS chrome maps its own semantic variables to the editor palette; property values, traits and layers use a readable normal body weight rather than nested lighter weights. Resource actions follow the selected asset’s actual lifecycle, and collection changes clear stale single/bulk selections. Default loading is textual and keeps the surrounding shell stable. Scrollbars inherit tokenized colors, with system colors in forced-colors mode.

## Verification

`tools/e2e/cms-owner.mjs` exercises full workspace destinations at 1440px and 390px in Chromium/WebKit, verifies reachable controls, no horizontal overflow, keyboard dismissal, real email rendering, custom page publication and editing behavior. `cms-workspace.mjs` covers compact drawers, keyboard tabs, toolbar geometry and first-device selection. `cms-workspace-edge.mjs` covers first-publication discard, resource lifecycle selection, property text weight/contrast and native-preview loading/error/retry, including obsolete or unrelated messages. `cms-workspace-views.mjs` captures every workspace and scroll region, runs axe on editor chrome, verifies persistent email preview and waits for actual native readiness before screenshots. Chromium covers 320, 390, 1024 and 1440px; WebKit covers 390 and 1440px plus the focused contracts. These are emulated viewports, not physical-device certification. `.github/workflows/cms-workspace.yml` preserves images, JSON checks and Furl-compacted logs with the tested Git tree. Screenshots require human/model visual inspection; a green automated audit is not a visual approval.

Device layout is independent: desktop uses min-width 769px; mobile uses max-width 768px. Geometry carries between light/dark; appearance remains theme-specific. Text is shared between responsive views. Home derives its About preview from the current draft. Editable mobile snapshots share the public folding geometry through a temporary DOM-only stylesheet. Selecting a flow scene applies its visibility before paint; no hidden-state or scroll geometry is saved into the editor model. Locked preview retains the real public runtime. Reverting an unpublished first draft restores source-derived editing templates while retaining the empty authoritative publication base.
