// ---------------------------------------------------------------------------
// renderAriaTemplate — AriaTemplateNode → YAML string
//
// Counterpart to parseAriaTemplate. Playwright doesn't have this since
// they never re-serialize templates.
// ---------------------------------------------------------------------------

import { renderAriaProps } from './folk/injected/ariaSnapshot'
import { cachedRegex } from './folk/isomorphic/ariaSnapshot'
import { yamlEscapeValueIfNeeded } from './folk/isomorphic/yaml'
import type {
  AriaRegex,
  AriaTextValue,
  AriaTemplateNode,
  AriaTemplateRoleNode,
} from './folk/isomorphic/ariaSnapshot'

export function formatTextValue(tv: AriaTextValue): string {
  if (cachedRegex(tv)) return `/${tv.raw.slice(1, -1)}/`
  return yamlEscapeValueIfNeeded(tv.normalized)
}

export function formatNameValue(name: AriaRegex | string): string {
  if (typeof name === 'string') return JSON.stringify(name)
  return `/${name.pattern}/`
}

/**
 * Renders an ARIA template back to its textual snapshot representation.
 */
export function renderAriaTemplate(template: AriaTemplateNode): string {
  const lines: string[] = []
  if (template.kind === 'text') {
    lines.push(`- text: ${formatTextValue(template.text)}`)
  } else if (template.role === 'fragment') {
    if (template.containerMode && template.containerMode !== 'contain') {
      lines.push(`- /children: ${template.containerMode}`)
    }
    for (const child of template.children || [])
      renderTemplateLines(child, '', lines)
  } else {
    renderTemplateLines(template, '', lines)
  }
  return lines.join('\n')
}

function renderTemplateKey(tmpl: AriaTemplateRoleNode): string {
  let key = tmpl.role as string
  if (tmpl.name !== undefined) key += ` ${formatNameValue(tmpl.name)}`
  key += renderAriaProps(tmpl)
  return key
}

function renderTemplateLines(
  node: AriaTemplateNode,
  indent: string,
  lines: string[]
): void {
  if (node.kind === 'text') {
    lines.push(`${indent}- text: ${formatTextValue(node.text)}`)
    return
  }

  const key = renderTemplateKey(node)
  const children = node.children || []

  const pseudoLines: string[] = []
  if (node.containerMode && node.containerMode !== 'contain') {
    pseudoLines.push(`${indent}  - /children: ${node.containerMode}`)
  }
  if (node.props) {
    for (const [name, tv] of Object.entries(node.props)) {
      pseudoLines.push(`${indent}  - /${name}: ${formatTextValue(tv)}`)
    }
  }

  if (children.length === 0 && pseudoLines.length === 0) {
    lines.push(`${indent}- ${key}`)
    return
  }
  if (
    children.length === 1 &&
    children[0].kind === 'text' &&
    pseudoLines.length === 0
  ) {
    lines.push(`${indent}- ${key}: ${formatTextValue(children[0].text)}`)
    return
  }
  lines.push(`${indent}- ${key}:`)
  lines.push(...pseudoLines)
  for (const child of children) {
    renderTemplateLines(child, `${indent}  `, lines)
  }
}
