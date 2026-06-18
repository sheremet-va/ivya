import { renderNodeLines } from './folk/injected/ariaSnapshot'
import {
  matchesNode,
  matchesTextValue,
  matchesStringOrRegex,
  cachedRegex,
  type AriaNode,
  type AriaRegex,
  type AriaTemplateNode,
  type AriaTemplateRoleNode,
  type ContainerMode,
} from './folk/isomorphic/ariaSnapshot'
import { formatTextValue, formatNameValue } from './template'

// ---------------------------------------------------------------------------
// matchAriaTree — three-way merge matching (vitest-specific)
//
// Architecture — separation of pass/fail and rendering:
//   pass/fail is decided exclusively at the *list* level (mergeChildLists)
//   using folk's matchesNode, which is a full-depth recursive boolean check.
//   mergeNode is purely a rendering function — it builds the resolved output
//   through the template's lens but has no say in pass/fail (returns string[],
//   not a boolean). This separation works because matchesNode already
//   traverses the full subtree; re-checking at the node level would be
//   redundant. The entry point (matchAriaTree) wraps root and template in
//   single-element lists so that mergeChildLists — and its pass/fail
//   authority — is always the top-level driver.
//
// folk's renderNodeLines is used for actual-side rendering. Only the merge
// assembly and template rendering (which Playwright doesn't need) are
// implemented here.
//
// Fragment semantics:
//   A fragment node has no semantics of its own — it exists only because
//   APIs must return a single root when the content is multiple siblings.
//   captureAriaTree always returns a fragment root; parseAriaTemplate may
//   or may not (it unwraps single-child fragments, following Playwright).
//
//   We normalize these synthetic root wrappers in matchAriaTree before
//   entering the recursive merge. User-authored `fragment` template roles are
//   rejected by the parser, so mergeChildLists never needs general fragment
//   semantics.
//
//   Playwright takes a different approach: instead of flattening, it treats
//   fragment as a wildcard role (matches any node) and relies on the entry
//   point to walk root.children directly. Our root normalization follows the
//   same boundary idea while keeping three-way merge decisions in
//   mergeChildLists.
//   See: vendor/playwright/packages/injected/src/ariaSnapshot.ts
//   (matchesNode, matchesNodeDeep)
//
// Differences from Playwright:
//   - Playwright adds matchesNodeDeep, which walks the entire actual tree
//     trying matchesNode at every node (locator-style "find this pattern
//     anywhere"). We always match from root.
//   - Playwright has no three-way merge — on --update it re-renders the
//     actual DOM with regex heuristics (renderStringsAsRegex /
//     convertToBestGuessRegex) and overwrites the snapshot wholesale.
//     Our merge preserves user-edited patterns from the expected side.
//
// Complexity: matchesNode is always full-depth (recurses the subtree),
//   so each call is O(subtree × template). The contain-mode pass 2
//   (pairChildrenFull) adds a factor of T at the failing level only.
//   This only triggers on failure and sibling lists are small in practice.
// ---------------------------------------------------------------------------

/**
 * The match algorithm resolves a DOM tree through the template's lens:
 *
 *   resolved — DOM tree rendered through the template's lens. Where the
 *              template uses regexes or omits names, the resolved output
 *              adopts those patterns. Where the template doesn't match,
 *              the resolved output uses literal DOM values.
 *
 * This is NOT a raw rendering of either input:
 *   actual   = renderAriaTree(root)       — DOM as-is
 *   expected = the original YAML string   — template as-is
 * Both are independent of the match algorithm and available to the
 * caller without matchAriaTree.
 *
 * Invariant:
 *   pass = true <=> resolved = expected
 *                   TODO:
 *                   This holds all cases except `aria-expanded` tri-state behaviors,
 *                   which we inherited from playwright. We leave this case for now.
 *
 * Diff display (pass: false):
 *   Use resolved vs expected. The user sees their original assertion
 *   on the right side. The left side (resolved) normalizes matched
 *   regions so the diff highlights only genuine mismatches, not
 *   pattern-vs-literal noise.
 *
 * Snapshot update (pass: false):
 *   Write resolved. It preserves user patterns (regexes, omitted names)
 *   from matched regions while incorporating actual DOM structure for
 *   mismatched/unpaired regions.
 *
 * Round-trip invariant:
 *   element → captureAriaTree → renderAriaTree → parseAriaTemplate
 *   → matchAriaTree(captured, parsed) → pass: true.
 *   A rendered snapshot must always match its own source tree.
 *   (Tested via runPipeline in aria.test.ts.)
 */
export interface MatchAriaResult {
  /** Whether the actual tree satisfies the template. */
  pass: boolean
  /** DOM tree resolved through the template's lens. Written on --update. */
  resolved: string
}

/**
 * Matches a captured ARIA tree against a parsed template.
 *
 * Returns whether the match passed and the resolved output used for diffing
 * and snapshot updates.
 */
export function matchAriaTree(
  root: AriaNode,
  template: AriaTemplateNode
): MatchAriaResult {
  // Normalize synthetic root fragments before entering the recursive merge.
  // The template root fragment may own /children metadata, so lift its
  // containerMode before unwrapping it into template roots.
  const normalizedRoot = root.role === 'fragment' ? root.children : [root]
  const normalizedTemplate = isAriaTemplateFragement(template)
    ? (template.children ?? [])
    : [template]
  const containerMode = isAriaTemplateFragement(template)
    ? template.containerMode
    : undefined
  const result = mergeChildLists(
    normalizedRoot,
    normalizedTemplate,
    '',
    containerMode
  )
  if (result.pass && containerMode && containerMode !== 'contain') {
    result.resolved.unshift(`- /children: ${containerMode}`)
  }

  return {
    pass: result.pass,
    resolved: result.resolved.join('\n'),
  }
}

function isAriaTemplateFragement(
  template: AriaTemplateNode
): template is AriaTemplateRoleNode {
  return template.kind === 'role' && template.role === 'fragment'
}

// ---------------------------------------------------------------------------
// Merge internals
// ---------------------------------------------------------------------------

/** Result of mergeChildLists — decides pass/fail and builds resolved lines. */
interface MergeResult {
  resolved: string[]
  pass: boolean
}

function isRegexName(name?: AriaRegex | string): name is AriaRegex {
  return typeof name === 'object' && name !== null && 'pattern' in name
}

/** Build the resolved key through the template's lens:
 *  only include name/attributes that the template mentions. */
function renderResolvedKey(node: AriaNode, template: AriaTemplateRoleNode): string {
  let key = node.role as string

  // Name: omit if template omits, adopt regex if matched, literal otherwise
  if (template.name === undefined) {
    // template doesn't care about name → omit
  } else if (
    isRegexName(template.name) &&
    matchesStringOrRegex(node.name, template.name)
  ) {
    key += ` ${formatNameValue(template.name)}`
  } else {
    if (node.name) {
      key += ` ${JSON.stringify(node.name)}`
    }
  }

  // Attributes: only render what the template mentions
  if (template.level !== undefined) key += ` [level=${node.level}]`
  if (template.checked !== undefined) {
    if (node.checked === true) key += ' [checked]'
    else if (node.checked === 'mixed') key += ' [checked=mixed]'
  }
  if (template.disabled !== undefined && node.disabled) {
    key += ' [disabled]'
  }
  if (template.expanded !== undefined) {
    if (node.expanded === true) key += ' [expanded]'
    else if (node.expanded === false) key += ' [expanded=false]'
  }
  if (template.pressed !== undefined) {
    if (node.pressed === true) key += ' [pressed]'
    else if (node.pressed === 'mixed') key += ' [pressed=mixed]'
  }
  if (template.selected !== undefined && node.selected) {
    key += ' [selected]'
  }

  return key
}

// --- Contain-mode pairing helpers ---

function pairChildren(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[]
): Map<number, number> {
  // Greedy left-to-right: advance through children, when child[ci]
  // full-depth matches template[ti], pair them and advance ti.
  // Unmatched children are skipped (contain semantics).
  const pairs = new Map<number, number>()
  let ti = 0
  for (let ci = 0; ci < children.length && ti < templates.length; ci++) {
    if (matchesNode(children[ci], templates[ti], false)) {
      pairs.set(ci, ti)
      ti++
    }
  }
  return pairs
}

/** Pass 2: O(C × T) unordered exact match to recover pairs that pass 1's
 * greedy left-to-right scan missed (e.g. due to ordering differences).
 * Only affects merge output quality, not pass/fail. */
function pairChildrenFull(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[]
): Map<number, number> {
  const pairs = new Map<number, number>()
  const pairedChildren = new Set<number>()
  // For each template, scan all children for a full-depth match.
  for (let ti = 0; ti < templates.length; ti++) {
    for (let ci = 0; ci < children.length; ci++) {
      if (pairedChildren.has(ci)) continue
      if (matchesNode(children[ci], templates[ti], false)) {
        pairs.set(ci, ti)
        pairedChildren.add(ci)
        break
      }
    }
  }
  return pairs
}

function renderChildLines(child: AriaNode | string, indent: string): string[] {
  const lines: string[] = []
  if (typeof child === 'string') {
    lines.push(`${indent}- text: ${child}`)
  } else {
    renderNodeLines(child, indent, lines)
  }
  return lines
}

function mergeChildLists(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[],
  indent: string,
  containerMode?: ContainerMode
): MergeResult {
  if (
    children.some((c) => typeof c !== 'string' && c.role === 'fragment') ||
    templates.some((t) => isAriaTemplateFragement(t))
  ) {
    throw new Error(
      'Internal error: fragment wrappers must be unwrapped at matchAriaTree root'
    )
  }

  if (containerMode === 'equal' || containerMode === 'deep-equal') {
    return mergeChildListsEqual(
      children,
      templates,
      indent,
      containerMode === 'deep-equal'
    )
  }

  const resolved: string[] = []

  // Contain mode (default): subsequence match via two-pass pairing.
  const pairs = pairChildren(children, templates)
  const allTemplatesMatched = templates.length === pairs.size

  if (!allTemplatesMatched) {
    // Pass 2: O(C × T) unordered exact match to recover pairs that
    // pass 1's greedy scan missed. Preserves user patterns (e.g. regexes)
    // in the merge output instead of dumping full actual.
    const recoveredPairs = pairChildrenFull(children, templates)

    for (let ci = 0; ci < children.length; ci++) {
      const ti = recoveredPairs.get(ci)
      if (ti !== undefined) {
        // recursively merge for matched pairs to preserve template pattern on matched branches.
        resolved.push(...mergeNode(children[ci], templates[ti], indent))
      } else {
        // on unpaired child branch, we fully update with actual dom render.
        resolved.push(...renderChildLines(children[ci], indent))
      }
    }

    return { resolved, pass: false }
  }

  // All templates paired — render only matched children (contain = skip extras).
  for (let ci = 0; ci < children.length; ci++) {
    const ti = pairs.get(ci)
    if (ti !== undefined) {
      resolved.push(...mergeNode(children[ci], templates[ti], indent))
    }
  }

  return { resolved, pass: true }
}

/** Equal/deep-equal mode: positional 1:1 matching. Pass iff same count
 *  and every positional pair matches (full-depth). When isDeepEqual is
 *  true, descendant nodes without explicit containerMode inherit equal
 *  semantics. */
function mergeChildListsEqual(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[],
  indent: string,
  isDeepEqual: boolean
): MergeResult {
  const resolved: string[] = []

  const allPositionalMatched =
    children.length === templates.length &&
    children.every((c, i) => matchesNode(c, templates[i], isDeepEqual))

  for (let ci = 0; ci < children.length; ci++) {
    if (ci < templates.length) {
      resolved.push(...mergeNode(children[ci], templates[ci], indent, isDeepEqual))
    } else {
      resolved.push(...renderChildLines(children[ci], indent))
    }
  }

  return { resolved, pass: allPositionalMatched }
}

/** Render a single actual node through the template's lens.
 *
 *  Intentionally returns only resolved lines, not pass/fail. This is
 *  the unusual part of the design: pass/fail is decided *before* this
 *  function is called, by mergeChildLists (which uses matchesNode to
 *  pair children and determine pass). mergeNode is called only after
 *  pairing is settled — it doesn't need to re-decide, and couldn't
 *  change the outcome if it tried, because list-level decisions (which
 *  children to pair, which to skip) have already been made. */
function mergeNode(
  node: AriaNode | string,
  template: AriaTemplateNode,
  indent: string,
  isDeepEqual = false
): string[] {
  // Both text node
  if (typeof node === 'string' && template.kind === 'text') {
    const matched = matchesTextValue(node, template.text)
    const resolvedText =
      matched && cachedRegex(template.text) ? formatTextValue(template.text) : node
    return [`${indent}- text: ${resolvedText}`]
  }

  // One text node and the other not
  if (typeof node === 'string' || template.kind === 'text') {
    return renderChildLines(node, indent)
  }

  // Resolved key (e.g. `- heading "Hello" [level=1]`):
  // adopt the template's lens for both name and attributes.
  //   template omits name (e.g. `- heading`)        → resolved omits it
  //   template has regex  (e.g. `- button /\d+/`)   → resolved adopts regex if matched
  //   template has literal (e.g. `- button "Save"`) → resolved uses literal
  //   template omits attr (e.g. no [level])          → resolved omits it
  //   template has attr   (e.g. [level=1])           → resolved includes it
  const resolvedKey = renderResolvedKey(node, template)

  // Recurse into children.
  // `childResult.pass` can be ignored since parent `mergeChildLists` already decided pass/fail.
  const childResult = mergeChildLists(
    node.children,
    template.children || [],
    `${indent}  `,
    template.containerMode ?? (isDeepEqual ? 'equal' : 'contain')
  )

  // Build directive line (/children) rendered before children,
  // and prop pseudo-lines rendered after children.
  const resolvedPseudo: string[] = []
  if (template.containerMode && template.containerMode !== 'contain') {
    resolvedPseudo.push(`${indent}  - /children: ${template.containerMode}`)
  }

  const allPropKeys = new Set([
    ...Object.keys(node.props),
    ...Object.keys(template.props || {}),
  ])

  for (const prop of allPropKeys) {
    const nodeVal = node.props[prop]
    const tmplVal = template.props?.[prop]
    if (nodeVal !== undefined) {
      const matched = tmplVal === undefined || matchesTextValue(nodeVal, tmplVal)
      const display =
        matched && tmplVal && cachedRegex(tmplVal)
          ? formatTextValue(tmplVal)
          : nodeVal
      resolvedPseudo.push(`${indent}  - /${prop}: ${display}`)
    }
  }

  const resolved: string[] = []

  if (!childResult.resolved.length && !resolvedPseudo.length) {
    // one liner node with no props, e.g. `- role "name" [aria]`
    resolved.push(`${indent}- ${resolvedKey}`)
  } else if (
    childResult.resolved.length === 1 &&
    childResult.resolved[0].trimStart().startsWith('- text: ') &&
    !resolvedPseudo.length
  ) {
    // one liner node with text child, e.g. `- role "name" [aria]: text`
    const text = childResult.resolved[0].trimStart().slice('- text: '.length)
    resolved.push(`${indent}- ${resolvedKey}: ${text}`)
  } else {
    // multi-line node with children and/or props, e.g.
    // - role "name" [aria]:
    //    - /children: equal
    //    - /prop: value
    //    - child
    resolved.push(`${indent}- ${resolvedKey}:`)
    resolved.push(...resolvedPseudo)
    resolved.push(...childResult.resolved)
  }

  return resolved
}
