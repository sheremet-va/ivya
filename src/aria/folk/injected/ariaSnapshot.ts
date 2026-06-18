/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Forked from vendor/playwright/packages/injected/src/ariaSnapshot.ts
// Stripped: AI-mode features (refs, cursor, compareSnapshots, filterSnapshotDiff,
//           convertToBestGuessRegex, textContributesInfo, AriaTreeOptions modes
//           other than 'expect'). Only 'expect' mode is supported.

import type * as aria from '../isomorphic/ariaSnapshot'
import { yamlEscapeValueIfNeeded } from '../isomorphic/yaml'
import { getElementComputedStyle } from '../../../domUtils'
import * as roleUtils from '../../../roleUtils'
import { normalizeWhiteSpace } from '../../../stringUtils'

// Stub box for expect mode — visibility/cursor/inline are not used for matching.
const defaultBox: aria.AriaBox = { visible: true, inline: false }

// ---------------------------------------------------------------------------
// capture – DOM -> AriaNode tree
// ---------------------------------------------------------------------------

/**
 * Captures the ARIA tree for a DOM subtree.
 *
 * The returned tree is the low-level structure used by ARIA snapshot matching.
 */
export function generateAriaTree(rootElement: Element): aria.AriaNode {
  const visited = new Set<Node>()

  const root: aria.AriaNode = {
    role: 'fragment',
    name: '',
    children: [],
    props: {},
    box: defaultBox,
    receivesPointerEvents: true,
  }

  const visit = (
    ariaNode: aria.AriaNode,
    node: Node,
    parentElementVisible: boolean
  ) => {
    if (visited.has(node)) return
    visited.add(node)

    if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
      if (!parentElementVisible) return

      const text = node.nodeValue
      // <textarea>AAA</textarea> should not report AAA as a child of the textarea.
      if (ariaNode.role !== 'textbox' && text)
        ariaNode.children.push(node.nodeValue || '')
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as Element
    const visible = !roleUtils.isElementHiddenForAria(element)

    // Optimization: if not visible for aria, skip child elements too.
    if (!visible) return

    const ariaChildren: Element[] = []
    if (element.hasAttribute('aria-owns')) {
      const ids = element.getAttribute('aria-owns')!.split(/\s+/)
      for (const id of ids) {
        const ownedElement = rootElement.ownerDocument.getElementById(id)
        if (ownedElement) ariaChildren.push(ownedElement)
      }
    }

    const childAriaNode = toAriaNode(element)
    if (childAriaNode) ariaNode.children.push(childAriaNode)
    processElement(childAriaNode || ariaNode, element, ariaChildren, visible)
  }

  function processElement(
    ariaNode: aria.AriaNode,
    element: Element,
    ariaChildren: Element[],
    parentElementVisible: boolean
  ) {
    // Surround every element with spaces for the sake of concatenated text nodes.
    const display = getElementComputedStyle(element)?.display || 'inline'
    const treatAsBlock = display !== 'inline' || element.nodeName === 'BR' ? ' ' : ''
    if (treatAsBlock) ariaNode.children.push(treatAsBlock)

    ariaNode.children.push(roleUtils.getPseudoContent(element, '::before'))
    const assignedNodes =
      element.nodeName === 'SLOT' ? (element as HTMLSlotElement).assignedNodes() : []
    if (assignedNodes.length) {
      for (const child of assignedNodes) visit(ariaNode, child, parentElementVisible)
    } else {
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (!(child as Element | Text).assignedSlot)
          visit(ariaNode, child, parentElementVisible)
      }
      if (element.shadowRoot) {
        for (
          let child = element.shadowRoot.firstChild;
          child;
          child = child.nextSibling
        )
          visit(ariaNode, child, parentElementVisible)
      }
    }

    for (const child of ariaChildren) visit(ariaNode, child, parentElementVisible)

    ariaNode.children.push(roleUtils.getPseudoContent(element, '::after'))

    if (treatAsBlock) ariaNode.children.push(treatAsBlock)

    if (ariaNode.children.length === 1 && ariaNode.name === ariaNode.children[0])
      ariaNode.children = []

    if (ariaNode.role === 'link' && element.hasAttribute('href')) {
      const href = element.getAttribute('href')!
      ariaNode.props.url = href
    }

    if (
      ariaNode.role === 'textbox' &&
      element.hasAttribute('placeholder') &&
      element.getAttribute('placeholder') !== ariaNode.name
    ) {
      const placeholder = element.getAttribute('placeholder')!
      ariaNode.props.placeholder = placeholder
    }
  }

  roleUtils.beginAriaCaches()
  try {
    visit(root, rootElement, true)
  } finally {
    roleUtils.endAriaCaches()
  }

  normalizeStringChildren(root)
  return root
}

function toAriaNode(element: Element): aria.AriaNode | null {
  const role = roleUtils.getAriaRole(element) ?? null
  if (!role || role === 'presentation' || role === 'none') return null

  const name = normalizeWhiteSpace(
    roleUtils.getElementAccessibleName(element, false) || ''
  )

  const result: aria.AriaNode = {
    role: role as aria.AriaRole,
    name,
    children: [],
    props: {},
    box: defaultBox,
    receivesPointerEvents: true,
  }

  if (roleUtils.kAriaCheckedRoles.includes(role))
    result.checked = roleUtils.getAriaChecked(element)

  if (roleUtils.kAriaDisabledRoles.includes(role))
    result.disabled = roleUtils.getAriaDisabled(element) || undefined

  if (roleUtils.kAriaExpandedRoles.includes(role)) {
    const expanded = roleUtils.getAriaExpanded(element)
    // ivya returns 'none' when aria-expanded is absent; normalize to undefined
    result.expanded = expanded === 'none' ? undefined : expanded
  }

  if (roleUtils.kAriaLevelRoles.includes(role))
    result.level = roleUtils.getAriaLevel(element)

  if (roleUtils.kAriaPressedRoles.includes(role))
    result.pressed = roleUtils.getAriaPressed(element)

  if (roleUtils.kAriaSelectedRoles.includes(role))
    result.selected = roleUtils.getAriaSelected(element)

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (
      element.type !== 'checkbox' &&
      element.type !== 'radio' &&
      element.type !== 'file'
    )
      result.children = [element.value]
  }

  return result
}

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

function normalizeStringChildren(rootA11yNode: aria.AriaNode) {
  const flushChildren = (
    buffer: string[],
    normalizedChildren: (aria.AriaNode | string)[]
  ) => {
    if (!buffer.length) return
    const text = normalizeWhiteSpace(buffer.join(''))
    if (text) normalizedChildren.push(text)
    buffer.length = 0
  }

  const visit = (ariaNode: aria.AriaNode) => {
    const normalizedChildren: (aria.AriaNode | string)[] = []
    const buffer: string[] = []
    for (const child of ariaNode.children || []) {
      if (typeof child === 'string') {
        buffer.push(child)
      } else {
        flushChildren(buffer, normalizedChildren)
        visit(child)
        normalizedChildren.push(child)
      }
    }
    flushChildren(buffer, normalizedChildren)
    ariaNode.children = normalizedChildren.length ? normalizedChildren : []
    if (ariaNode.children.length === 1 && ariaNode.children[0] === ariaNode.name)
      ariaNode.children = []
  }
  visit(rootA11yNode)
}

// ---------------------------------------------------------------------------
// render – AriaNode tree -> YAML-like string
// ---------------------------------------------------------------------------

// Renders AriaProps as attribute annotations (e.g. " [checked] [level=2]").
//
// expanded=false is omitted by default, following Playwright's convention:
// ARIA expanded has three states: undefined (not expandable), false (collapsed),
// true (expanded). Rendering omits false because most nodes are collapsed and
// annotating every one is noisy. Matching still distinguishes false from
// undefined — so rendering is intentionally lossy. This means a render→parse
// round-trip cannot assert expanded=false. Pass renderExpandedFalse to override
// (e.g. when rendering a user-authored template that explicitly specifies it).
export function renderAriaProps(
  props: aria.AriaProps,
  options?: { renderExpandedFalse?: boolean }
): string {
  let s = ''
  if (props.level) s += ` [level=${props.level}]`
  if (props.checked === true) s += ' [checked]'
  if (props.checked === 'mixed') s += ' [checked=mixed]'
  if (props.disabled) s += ' [disabled]'
  if (props.expanded === true) s += ' [expanded]'
  if (props.expanded === false && options?.renderExpandedFalse) {
    s += ' [expanded=false]'
  }
  if (props.pressed === true) s += ' [pressed]'
  if (props.pressed === 'mixed') s += ' [pressed=mixed]'
  if (props.selected) s += ' [selected]'
  return s
}

export function createAriaKey(ariaNode: aria.AriaNode): string {
  let key = ariaNode.role
  if (ariaNode.name && ariaNode.name.length <= 900) {
    key += ` ${JSON.stringify(ariaNode.name)}`
  }
  key += renderAriaProps(ariaNode)
  return key
}

export function renderNodeLines(
  node: aria.AriaNode,
  indent: string,
  lines: string[]
): void {
  const key = createAriaKey(node)
  const hasProps = Object.keys(node.props).length > 0
  const singleTextChild =
    node.children.length === 1 && typeof node.children[0] === 'string' && !hasProps
      ? node.children[0]
      : undefined

  if (!node.children.length && !hasProps) {
    lines.push(`${indent}- ${key}`)
  } else if (singleTextChild !== undefined) {
    lines.push(`${indent}- ${key}: ${yamlEscapeValueIfNeeded(singleTextChild)}`)
  } else {
    lines.push(`${indent}- ${key}:`)
    for (const [name, value] of Object.entries(node.props))
      lines.push(`${indent}  - /${name}: ${yamlEscapeValueIfNeeded(value)}`)

    for (const child of node.children) {
      if (typeof child === 'string') {
        if (child) lines.push(`${indent}  - text: ${yamlEscapeValueIfNeeded(child)}`)
      } else {
        renderNodeLines(child, `${indent}  `, lines)
      }
    }
  }
}

/**
 * Renders a captured ARIA tree to the textual snapshot format.
 */
export function renderAriaTree(root: aria.AriaNode): string {
  const lines: string[] = []
  const nodesToRender = root.role === 'fragment' ? root.children : [root]

  for (const nodeToRender of nodesToRender) {
    if (typeof nodeToRender === 'string') {
      if (nodeToRender)
        lines.push(`- text: ${yamlEscapeValueIfNeeded(nodeToRender)}`)
    } else {
      renderNodeLines(nodeToRender, '', lines)
    }
  }
  return lines.join('\n')
}
