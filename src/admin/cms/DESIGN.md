---
version: alpha
name: Blade & Blend Studio CMS
description: A calm editing workspace based on the owner's O-Y-A Studio reference.
colors:
  primary: '#234ce7'
  background: '#f2f4ee'
  surface: '#fffef9'
  text: '#252a24'
  muted: '#697260'
  border: '#e0e5d9'
  selected: '#edf0ff'
typography:
  sans:
    fontFamily: 'Inter Variable, Inter, system-ui, sans-serif'
  mono:
    fontFamily: 'ui-monospace, monospace'
rounded:
  DEFAULT: '6px'
  dialog: '14px'
spacing:
  sidebar: '220px'
  inspector: '284px'
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

Inter is already shipped by the application. Default 13px/1.45; secondary labels 11–12px; workspace headings 24–34px with restrained negative tracking. Technical paths use monospace. The compact BNB serif mark identifies the editor. Content in frames keeps its own typography.

## Layout

Desktop: 220px page library, flexible canvas, 284px contextual inspector. Header 65px; canvas toolbar 58px. Page settings appear only when no element is selected. Resources, history, business and email are full workspace destinations. New-page, backup, image selection and revision review are focused dialogs. Canvas state stays mounted while visiting another destination.

Below 900px, page library and inspector become explicit drawers; workspace views fill available width. Forms stack and the dock becomes an independently scrollable bottom row. Compare uses two adjacent viewports, not an overlay. Fit considers viewport width and height (1440×900 desktop, 390×844 mobile).

## Elevation and shapes

Borders and surface tones carry hierarchy. Only the floating dock, mobile drawers and modal backdrop use elevation. Controls use the 6px radius; dialogs use 14px. No decorative cards around every setting, gradients or entrance animation.

## Components and states

Buttons retain semantic disabled/pressed states and visible keyboard focus. The header owns publication status; errors remain readable until dismissed. Language/theme switches affect page content only. Workspace headings receive focus on navigation; Escape returns to the editor. Native dialogs trap focus and return it to their opener. Resources have explicit empty/search-empty states and show dimensions/type before selection. Forms use persistent labels. Default loading is textual and keeps the surrounding shell stable. Scrollbars inherit tokenized colors, with system colors in forced-colors mode.

## Verification

`tools/e2e/cms-owner.mjs` exercises full workspace destinations at 1440px and 390px in Chromium/WebKit, verifies reachable controls, no horizontal overflow, keyboard dismissal, real email rendering, custom page publication and editing behavior. `DESIGN.md` lint plus the skill's scoped audit are static checks; screenshots and behavior remain release evidence.
