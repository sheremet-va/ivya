import {
  getByAltTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByRoleSelector,
  getByTextSelector,
  getByTitleSelector,
  Ivya,
  asLocator,
} from '../src'
import { beforeEach, expect, test } from 'vitest'

beforeEach(() => {
  // the default
  Ivya.options.exact = false
})

test('works correctly', () => {
  const button = document.createElement('button')
  button.textContent = 'Click me'
  document.body.appendChild(button)

  const ivya = Ivya.create({
    browser: 'chromium',
  })

  const buttonSelector = getByRoleSelector('button', { name: 'Click me' })

  expect(ivya.queryLocatorSelector(buttonSelector)).toBe(button)

  expect(ivya.queryLocatorSelector(`css=body >> ${buttonSelector}`)).toBe(button)
})

test('file input', () => {
  const input = document.createElement('input')
  input.type = 'file'
  document.body.appendChild(input)

  const ivya = Ivya.create({
    browser: 'chromium',
  })

  expect(ivya.generateSelectorSimple(input)).toMatchInlineSnapshot(
    `"input[type="file"]"`
  )

  input.id = 'test1'
  expect(ivya.generateSelectorSimple(input)).toMatchInlineSnapshot(`"#test1"`)

  input.dataset.testid = 'test2'
  expect(ivya.generateSelectorSimple(input)).toMatchInlineSnapshot(
    `"internal:testid=[data-testid="test2"s]"`
  )
})

test('asLocator generates "exact" correctly dependning on the default', () => {
  Ivya.options.exact = false

  expect(asLocator('javascript', getByTextSelector('Hello'))).toMatchInlineSnapshot(
    `"getByText('Hello')"`
  )
  expect(
    asLocator('javascript', getByTextSelector('Hello', { exact: true }))
  ).toMatchInlineSnapshot(`"getByText('Hello', { exact: true })"`)
  expect(
    asLocator('javascript', getByTextSelector('Hello', { exact: false }))
  ).toMatchInlineSnapshot(`"getByText('Hello')"`)

  expect(
    asLocator('javascript', getByRoleSelector('alert', { name: 'Hello' }))
  ).toMatchInlineSnapshot(`"getByRole('alert', { name: 'Hello' })"`)
  expect(
    asLocator(
      'javascript',
      getByRoleSelector('alert', { name: 'Hello', exact: true })
    )
  ).toMatchInlineSnapshot(`"getByRole('alert', { name: 'Hello', exact: true })"`)
  expect(
    asLocator(
      'javascript',
      getByRoleSelector('alert', { name: 'Hello', exact: false })
    )
  ).toMatchInlineSnapshot(`"getByRole('alert', { name: 'Hello' })"`)

  Ivya.options.exact = true

  expect(asLocator('javascript', getByTextSelector('Hello'))).toMatchInlineSnapshot(
    `"getByText('Hello')"`
  )
  expect(
    asLocator('javascript', getByTextSelector('Hello', { exact: true }))
  ).toMatchInlineSnapshot(`"getByText('Hello')"`)
  expect(
    asLocator('javascript', getByTextSelector('Hello', { exact: false }))
  ).toMatchInlineSnapshot(`"getByText('Hello', { exact: false })"`)

  expect(
    asLocator('javascript', getByRoleSelector('alert', { name: 'Hello' }))
  ).toMatchInlineSnapshot(`"getByRole('alert', { name: 'Hello' })"`)
  expect(
    asLocator(
      'javascript',
      getByRoleSelector('alert', { name: 'Hello', exact: true })
    )
  ).toMatchInlineSnapshot(`"getByRole('alert', { name: 'Hello' })"`)
  expect(
    asLocator(
      'javascript',
      getByRoleSelector('alert', { name: 'Hello', exact: false })
    )
  ).toMatchInlineSnapshot(`"getByRole('alert', { name: 'Hello', exact: false })"`)
})

test('global exact option affects all selector helpers', () => {
  Ivya.options.exact = true

  expect(getByTextSelector('Hello')).toBe('internal:text="Hello"s')
  expect(getByLabelSelector('Hello')).toBe('internal:label="Hello"s')
  expect(getByPlaceholderSelector('Hello')).toBe(
    'internal:attr=[placeholder="Hello"s]'
  )
  expect(getByAltTextSelector('Hello')).toBe('internal:attr=[alt="Hello"s]')
  expect(getByTitleSelector('Hello')).toBe('internal:attr=[title="Hello"s]')
  expect(getByRoleSelector('button', { name: 'Hello' })).toBe(
    'internal:role=button[name="Hello"s]'
  )

  // per-call exact: false overrides the global option
  expect(getByTextSelector('Hello', { exact: false })).toBe('internal:text="Hello"i')
  expect(getByLabelSelector('Hello', { exact: false })).toBe(
    'internal:label="Hello"i'
  )
  expect(getByPlaceholderSelector('Hello', { exact: false })).toBe(
    'internal:attr=[placeholder="Hello"i]'
  )
  expect(getByAltTextSelector('Hello', { exact: false })).toBe(
    'internal:attr=[alt="Hello"i]'
  )
  expect(getByTitleSelector('Hello', { exact: false })).toBe(
    'internal:attr=[title="Hello"i]'
  )
  expect(getByRoleSelector('button', { name: 'Hello', exact: false })).toBe(
    'internal:role=button[name="Hello"i]'
  )

  Ivya.options.exact = false
})

test('vitest components with specific test id', () => {
  const div = document.createElement('div')
  div.dataset.testid = '__vitest_1__'
  document.body.appendChild(div)

  const ivya = Ivya.create({
    browser: 'chromium',
  })
  expect(ivya.generateSelectorSimple(div)).toBe(
    'internal:testid=[data-testid="__vitest_1__"s]'
  )
  expect(asLocator('javascript', ivya.generateSelectorSimple(div))).toBe('page')
})
