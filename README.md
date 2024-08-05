# ivya

`ivya` is a fork of Playwright's [locator resolution](https://github.com/microsoft/playwright/blob/71e614dc5ad667efdb4fe7c8f60e161aee3a94d8/packages/playwright-core/src/server/injected/injectedScript.ts). It is only available in the browser or browser-like environments.

```ts
import { Ivya, getByRoleSelector } from 'ivya'

// Ivya is a singleton, so it will always return the same constructor
const ivya = Ivya.create({
  browser: 'chromium',
  testIdAttribute: 'data-test-id',
})

// using locator selector (a string)
const element = ivya.queryLocatorSelector(
  getByRoleSelector('button', { name: 'Click Me!' })
)

// using parsed locator (good for caching)
const selector = ivya.parseSelector(
  getByRoleSelector('button', { name: 'Click Me!' })
)
const elements = ivya.querySelector(selector, document.body, false)
```

## See more

- [Locators guide in PLaywright's documentation](https://playwright.dev/docs/locators#locator-operators)
