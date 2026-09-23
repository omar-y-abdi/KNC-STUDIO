import { expect, it } from 'vitest'
import { CmsEditorBoundary } from '../../src/admin/cms/EditorBoundary'

it('retains a caught canvas failure while leaving the parent workspace outside the boundary', () => {
  const boundary = new CmsEditorBoundary({ children: 'editor', contextKey: 'home' }, {})
  expect(boundary.render()).toBe('editor')
  boundary.state = CmsEditorBoundary.getDerivedStateFromError(new Error('Invalid page metadata'))
  expect(boundary.state.failure).toBe('Invalid page metadata')
  expect(boundary.render()).not.toBe('editor')
  expect(CmsEditorBoundary.getDerivedStateFromError(null).failure).toBe('Okänt renderingsfel')
})
