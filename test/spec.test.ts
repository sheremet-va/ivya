import { getByRoleSelector, Ivya } from 'ivya'
import { expect, test } from 'vitest'

test('works correctly', () => {
  const button = document.createElement('button')
  button.textContent = 'Click me'
  document.body.appendChild(button)

  const ivya = Ivya.create({
    browser: 'chromium',
  })

  expect(
    ivya.queryLocatorSelector(getByRoleSelector('button', { name: 'Click me' }))
  ).toBe(button)
})
