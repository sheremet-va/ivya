import { getByRoleSelector, Ivya } from '../src'
import { expect, test } from 'vitest'

test('works correctly', () => {
  const button = document.createElement('button')
  button.textContent = 'Click me'
  document.body.appendChild(button)

  const ivya = Ivya.create({
    browser: 'chromium',
  })

  const buttonSelector = getByRoleSelector('button', { name: 'Click me' })

  expect(
    ivya.queryLocatorSelector(buttonSelector)
  ).toBe(button)

  expect(
    ivya.queryLocatorSelector(`css=body >> ${buttonSelector}`)
  ).toBe(button)
})
