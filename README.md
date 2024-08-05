# ivya

`ivya` is a fork of Playwright's [locator resolution](https://github.com/microsoft/playwright/blob/71e614dc5ad667efdb4fe7c8f60e161aee3a94d8/packages/playwright-core/src/server/injected/injectedScript.ts). It is only available in the browser or browser-like environments.

- Supports all Playwright selectors
- Supports Shadow DOM
- CSS and Xpath support out of the box
- TypeScript support
- `getBy*` selectors helpers
- Locator generator support

```ts
import { Ivya, getByRoleSelector } from 'ivya'

// Ivya is a singleton, so it will always return the same instance
const ivya = Ivya.create({
  browser: 'chromium',
  testIdAttribute: 'data-test-id',
})

// using locator selector (a string)
const element = ivya.queryLocatorSelector(
  getByRoleSelector('button', { name: 'Click Me!' })
)

const element = ivya.queryLocatorSelector('text=Click Me!')
const element = ivya.queryLocatorSelector('css=button[data-click]')

// using parsed locator (good for caching)
const selector = ivya.parseSelector(
  getByRoleSelector('button', { name: 'Click Me!' })
)
const elements = ivya.querySelector(selector, document.body, false)
```

## See more

- [Locators guide in Playwright's documentation](https://playwright.dev/docs/locators#locator-operators)
