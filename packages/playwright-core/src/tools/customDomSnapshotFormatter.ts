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

import type { AICustomDomFrameSnapshot, AICustomDomLocatorPlan, AICustomDomSnapshotEnvelope, AICustomDomTreeNode } from '../utils/isomorphic/aiSnapshotTypes';

export type CustomDomSnapshotRefAlias = {
  ref: string;
  stableId: string;
  frameId: string;
  framePath: number[];
};

export type FormattedCustomDomSnapshot = {
  snapshot: string;
  aliasToStableId: Map<string, CustomDomSnapshotRefAlias>;
  locatorPlans: Map<string, AICustomDomLocatorPlan>;
};

type NamingExtra = {
  key: string;
  value: string;
};

type ResolvedNodeName = {
  name?: string;
  source?: string;
  consumedChildAlt?: string;
  extras: NamingExtra[];
};

type NodeLabelOverrides = {
  inheritedName?: string;
  suppressHidden?: boolean;
};

type FormatterState = {
  nextRef: number;
  aliasToStableId: Map<string, CustomDomSnapshotRefAlias>;
  locatorPlans: Map<string, AICustomDomLocatorPlan>;
};

const kCustomDomVerificationMarker = '[custom-dom]';

const kInputTypeToRole: Record<string, string> = {
  button: 'button',
  checkbox: 'checkbox',
  color: 'colorpicker',
  date: 'datepicker',
  'datetime-local': 'datepicker',
  email: 'textbox',
  file: 'button',
  image: 'button',
  month: 'datepicker',
  number: 'spinbutton',
  password: 'textbox',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  tel: 'textbox',
  text: 'textbox',
  time: 'datepicker',
  url: 'textbox',
  week: 'datepicker',
};

// Formatter-side semantic fallback for non-interactive HTML5 tags that the serializer
// does not currently annotate with explicit roles. Alternative: serialize roles for
// non-interactive semantic nodes too, but that would also require revisiting ref exposure.
const kSemanticTagToRole: Record<string, string> = {
  article: 'article',
  aside: 'complementary',
  blockquote: 'blockquote',
  code: 'code',
  dd: 'definition',
  del: 'deletion',
  details: 'group',
  dfn: 'term',
  dialog: 'dialog',
  dt: 'term',
  em: 'emphasis',
  figure: 'figure',
  footer: 'contentinfo',
  form: 'form',
  header: 'banner',
  hr: 'separator',
  li: 'listitem',
  main: 'main',
  mark: 'mark',
  menu: 'list',
  meter: 'meter',
  nav: 'navigation',
  ol: 'list',
  output: 'status',
  p: 'paragraph',
  progress: 'progressbar',
  strong: 'strong',
  sub: 'subscript',
  summary: 'button',
  sup: 'superscript',
  table: 'table',
  tbody: 'rowgroup',
  td: 'cell',
  tfoot: 'rowgroup',
  thead: 'rowgroup',
  time: 'time',
  tr: 'row',
  ul: 'list',
};

const kNameAsSuffixRoles = new Set([
  'blockquote',
  'code',
  'definition',
  'deletion',
  'emphasis',
  'insertion',
  'mark',
  'paragraph',
  'strong',
  'subscript',
  'superscript',
  'term',
  'time',
]);

// Keep the tracked-listener plumbing in place for future use, but do not surface
// synthetic addEventListener-derived badges in snapshots for now.
const kShowTrackedEventListeners = false;

export function isCustomDomSnapshotEnvelope(value: unknown): value is AICustomDomSnapshotEnvelope {
  if (!value || typeof value !== 'object')
    return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.backend !== 'custom-dom')
    return false;
  const page = envelope.page;
  if (!page || typeof page !== 'object')
    return false;
  return !!(page as Record<string, unknown>).frameTree;
}

export function customDomStableLocatorKey(framePath: number[], stableId: string): string {
  return `${framePath.join('.') || 'root'}::${stableId}`;
}

export function formatCustomDomSnapshot(envelope: AICustomDomSnapshotEnvelope): FormattedCustomDomSnapshot {
  const state: FormatterState = {
    nextRef: 1,
    aliasToStableId: new Map(),
    locatorPlans: new Map(),
  };

  const lines = renderFrameSnapshot(envelope.page.frameTree, [], '', state);
  return {
    snapshot: lines.join('\n'),
    aliasToStableId: state.aliasToStableId,
    locatorPlans: state.locatorPlans,
  };
}

function renderFrameSnapshot(frame: AICustomDomFrameSnapshot, framePath: number[], indent: string, state: FormatterState): string[] {
  const root = asTreeNode(frame.dom);
  if (!root)
    return [];

  const remainingChildFrames = [...frame.childFrames];
  const lines = renderNode(root, true, indent, false);
  while (remainingChildFrames.length) {
    const childFrame = remainingChildFrames.shift()!;
    const pathIndex = childFrame.childFrameIndex ?? 0;
    lines.push(`${indent}- iframe:`);
    lines.push(...renderFrameSnapshot(childFrame, [...framePath, pathIndex], indent + '  ', state));
  }
  return lines;

  function renderNode(node: AICustomDomTreeNode, isRoot: boolean, lineIndent: string, ancestorHidden: boolean): string[] {
    const tag = readString((node as Record<string, unknown>).tag)?.toLowerCase() || 'node';
    const collapsedLabelControl = findCollapsibleLabelControl(node);
    if (collapsedLabelControl) {
      const collapsedTag = readString((collapsedLabelControl as Record<string, unknown>).tag)?.toLowerCase() || 'node';
      const collapsedRef = maybeAssignAlias(collapsedLabelControl, frame, framePath, state, false, collapsedTag);
      const collapsedName = readCollapsedLabelName(node);
      const { label, consumedChildAlt } = formatNodeLabel(collapsedLabelControl, collapsedTag, collapsedRef, {
        inheritedName: collapsedName,
        suppressHidden: ancestorHidden,
      });
      const nested: string[] = [];
      const childHidden = ancestorHidden || (collapsedLabelControl as Record<string, unknown>).isVisible === false;
      for (const child of readChildren(collapsedLabelControl)) {
        const compact = compactMediaChild(child, consumedChildAlt, lineIndent + '  ');
        if (compact !== undefined) {
          if (compact)
            nested.push(compact);
          continue;
        }
        nested.push(...renderNode(child, false, lineIndent + '  ', childHidden));
      }

      const hasNested = nested.length > 0;
      let line = `${lineIndent}- ${label}${hasNested ? ':' : ''}`;
      if (isRoot)
        line += ` ${kCustomDomVerificationMarker}`;
      return [line, ...nested];
    }

    const ref = maybeAssignAlias(node, frame, framePath, state, isRoot, tag);
    const { label, consumedChildAlt } = formatNodeLabel(node, tag, ref, { suppressHidden: ancestorHidden });

    const nested: string[] = [];
    const childHidden = ancestorHidden || (node as Record<string, unknown>).isVisible === false;
    for (const child of readChildren(node)) {
      const compact = compactMediaChild(child, consumedChildAlt, lineIndent + '  ');
      if (compact !== undefined) {
        if (compact)
          nested.push(compact);
        continue;
      }
      nested.push(...renderNode(child, false, lineIndent + '  ', childHidden));
    }

    if (tag === 'iframe') {
      const childFrame = takeChildFrameForNode(node);
      if (childFrame) {
        const pathIndex = childFrame.childFrameIndex ?? 0;
        nested.push(...renderFrameSnapshot(childFrame, [...framePath, pathIndex], lineIndent + '  ', state));
      }
    }

    const hasNested = nested.length > 0;
    let line = `${lineIndent}- ${label}${hasNested ? ':' : ''}`;
    if (isRoot)
      line += ` ${kCustomDomVerificationMarker}`;
    return [line, ...nested];
  }

  function takeChildFrameForNode(node: AICustomDomTreeNode): AICustomDomFrameSnapshot | undefined {
    const stableId = readString((node as Record<string, unknown>).id);
    if (stableId) {
      const identityIndex = remainingChildFrames.findIndex(childFrame => childFrame.frameElementStableId === stableId);
      if (identityIndex !== -1)
        return remainingChildFrames.splice(identityIndex, 1)[0];
    }
    return remainingChildFrames.shift();
  }
}

function maybeAssignAlias(node: AICustomDomTreeNode, frame: AICustomDomFrameSnapshot, framePath: number[], state: FormatterState, isRoot: boolean, tag: string): string | undefined {
  const stableId = readString((node as Record<string, unknown>).id);
  if (!stableId)
    return;
  if (!shouldExposeRef(node, isRoot, tag))
    return;
  const locatorPlan = readRecord(frame.locatorPlans)?.[stableId];
  if (!locatorPlan || typeof locatorPlan !== 'object')
    return;

  const key = customDomStableLocatorKey(framePath, stableId);
  if (!state.locatorPlans.has(key))
    state.locatorPlans.set(key, locatorPlan as AICustomDomLocatorPlan);

  const ref = `e${state.nextRef++}`;
  state.aliasToStableId.set(ref, {
    ref,
    stableId,
    frameId: frame.frameId,
    framePath: [...framePath],
  });
  return ref;
}

function shouldExposeRef(node: AICustomDomTreeNode, isRoot: boolean, tag: string): boolean {
  const nodeRecord = node as Record<string, unknown>;
  const attributes = readRecord(nodeRecord.attributes) || {};
  const explicitRole = readString(nodeRecord.role) || readString(attributes.role);
  if (isRoot)
    return true;
  if (readBoolean(nodeRecord.isInteractive))
    return true;
  if (tag === 'iframe')
    return true;
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'option')
    return true;
  if (explicitRole && explicitRole !== 'presentation' && explicitRole !== 'none')
    return true;
  if (readString(nodeRecord.text))
    return true;
  if (readString(nodeRecord.accessibleName))
    return true;
  return false;
}

function formatNodeLabel(node: AICustomDomTreeNode, tag: string, ref: string | undefined, overrides: NodeLabelOverrides = {}): { label: string, consumedChildAlt?: string } {
  const nodeRecord = node as Record<string, unknown>;
  const attributes = readRecord(nodeRecord.attributes) || {};
  const explicitRole = readString(nodeRecord.role) || readString(attributes.role);
  const semantic = inferRole(tag, explicitRole, attributes);
  const { name, consumedChildAlt, source: nameSource, extras: namingExtras } = resolveNodeName(node, tag, attributes, overrides.inheritedName);
  const text = readString(nodeRecord.text);
  const value = readString(attributes.value);
  const renderNameAsSuffix = shouldRenderNameAsSuffix(nodeRecord, semantic.role, nameSource, attributes);
  const displayName = renderNameAsSuffix ? undefined : name;

  const parts: string[] = [semantic.role];
  if (displayName)
    parts.push(quoteValue(displayName));
  if (semantic.level !== undefined)
    parts.push(`[level=${semantic.level}]`);
  if (ref)
    parts.push(`[ref=${ref}]`);
  parts.push(...formatNamingExtraBadges(namingExtras));
  parts.push(...formatStructuralHintBadges(nodeRecord, tag, semantic.role, attributes, displayName, explicitRole, new Set(namingExtras.map(extra => extra.key))));
  parts.push(...formatControlBadges(tag, attributes, displayName, nameSource));
  parts.push(...formatBehaviorBadges(nodeRecord, tag, semantic.role, attributes));
  if (nodeRecord.isVisible === false && !overrides.suppressHidden && tag !== 'option')
    parts.push('[hidden]');
  if (readBoolean(nodeRecord.isFocused))
    parts.push('[active]');
  if (readBoolean(nodeRecord.isDisabled))
    parts.push('[disabled]');
  if (readBoolean(nodeRecord.isChecked))
    parts.push('[checked]');
  if (readBoolean(nodeRecord.isSelected))
    parts.push('[selected]');
  parts.push(...formatAriaBadges(attributes));

  const suffix = formatTextSuffix(node, semantic.role, value, text, displayName);
  let label = parts.join(' ');
  if (suffix)
    label += `: ${suffix}`;
  return { label, consumedChildAlt };
}

function inferRole(tag: string, explicitRole: string | undefined, attributes: Record<string, unknown>): { role: string, level?: number } {
  const normalizedExplicitRole = normalizeExplicitRole(tag, explicitRole, attributes);
  if (normalizedExplicitRole === 'heading') {
    const headingLevel = readHeadingLevel(attributes['aria-level'], tag);
    return headingLevel === undefined ? { role: normalizedExplicitRole } : { role: normalizedExplicitRole, level: headingLevel };
  }
  if (normalizedExplicitRole)
    return { role: normalizedExplicitRole };
  if (tag === 'iframe')
    return { role: 'iframe' };
  const heading = tag.match(/^h([1-6])$/);
  if (heading)
    return { role: 'heading', level: Number(heading[1]) };
  if (tag === 'button')
    return { role: 'button' };
  if (tag === 'a')
    return { role: 'link' };
  if (tag === 'textarea')
    return { role: 'textbox' };
  if (tag === 'select')
    return { role: 'combobox' };
  if (tag === 'option')
    return { role: 'option' };
  if (tag === 'img' || tag === 'svg')
    return { role: 'img' };
  if (tag === 'input') {
    return { role: inferInputRole(attributes) };
  }
  const semanticRole = kSemanticTagToRole[tag];
  if (semanticRole)
    return { role: semanticRole };
  return { role: 'generic' };
}

function normalizeExplicitRole(tag: string, explicitRole: string | undefined, attributes: Record<string, unknown>): string | undefined {
  if (tag !== 'input')
    return explicitRole;

  const inferredInputRole = inferInputRole(attributes);
  if (!explicitRole)
    return inferredInputRole;

  // The serializer still reports some specialized input types as "textbox".
  if (explicitRole === 'textbox' && inferredInputRole !== 'textbox')
    return inferredInputRole;
  return explicitRole;
}

function inferInputRole(attributes: Record<string, unknown>): string {
  const inputType = (readString(attributes.type) || 'text').toLowerCase();
  return kInputTypeToRole[inputType] || 'textbox';
}

function formatTextSuffix(node: AICustomDomTreeNode, role: string, value: string | undefined, text: string | undefined, name?: string): string | undefined {
  const normalizedValue = normalizeText(value);
  const normalizedText = normalizeText(text);
  const inlineHint = buildInlineTextHint(node, normalizedText);

  let suffix: string | undefined;
  if (role === 'textbox' && normalizedValue !== undefined)
    suffix = /^\d+(\.\d+)?$/.test(normalizedValue) ? quoteValue(normalizedValue) : normalizedValue;
  else if (normalizedText !== undefined && normalizedText !== name)
    suffix = normalizedText;
  else if (normalizedValue !== undefined && normalizedValue !== name)
    suffix = normalizedValue;

  if (inlineHint) {
    if (!suffix)
      return inlineHint;
    if (!suffix.includes(inlineHint))
      return `${suffix} [inline: ${inlineHint}]`;
  }
  if (suffix !== undefined)
    return suffix;
  return;
}

function resolveNodeName(node: AICustomDomTreeNode, tag: string, attributes: Record<string, unknown>, inheritedName?: string): ResolvedNodeName {
  const nodeRecord = node as Record<string, unknown>;
  const accessibleName = normalizeText(readString(nodeRecord.accessibleName));
  const text = normalizeText(readString(nodeRecord.text));
  const ariaLabel = normalizeText(readString(attributes['aria-label']));
  const ariaLabelledBy = normalizeText(readString(attributes['aria-labelledby']));
  const alt = normalizeText(readString(attributes.alt));
  const childAlt = readImmediateChildAlt(node);
  const placeholder = normalizeText(readString(attributes.placeholder));
  const title = normalizeText(readString(attributes.title));
  const testIdHints = readPreferredTestIdHints(attributes);
  const testIdHint = testIdHints[0];
  const formFieldName = normalizeText(readString(attributes.name));
  const semanticClassName = readDescriptiveSemanticClassName(attributes.class);
  const srcName = extractSourceName(attributes.src);
  const inheritedLabel = normalizeText(inheritedName);

  const candidates: Array<{ value: string, source: string, badgeKey?: string }> = [];
  const pushCandidate = (value: string | undefined, source: string, badgeKey?: string) => {
    const normalized = normalizeText(value);
    if (!normalized)
      return;
    candidates.push({ value: normalized, source, badgeKey });
  };

  pushCandidate(ariaLabel, 'aria-label');
  if (ariaLabelledBy && accessibleName)
    pushCandidate(accessibleName, 'aria-labelledby');

  const explicitSources = [ariaLabel, alt, childAlt, placeholder, title, ...testIdHints.map(hint => hint.value), semanticClassName, srcName, text];
  if (accessibleName && !explicitSources.some(value => valuesEquivalent(accessibleName, value)))
    pushCandidate(accessibleName, 'accessibleName');

  pushCandidate(inheritedLabel, 'label-text');
  pushCandidate(alt, 'alt');
  pushCandidate(childAlt, 'child-alt');
  pushCandidate(placeholder, 'placeholder');
  pushCandidate(title, 'title', 'title');
  pushCandidate(text, 'text');
  for (const hint of testIdHints)
    pushCandidate(hint.value, hint.key, hint.key);
  pushCandidate(formFieldName, 'name', 'name');
  if (tag === 'img')
    pushCandidate(srcName, 'src', 'src');

  if (!candidates.length)
    return { extras: [] };

  const [winner, ...rest] = candidates;
  const extras: NamingExtra[] = [];
  for (const candidate of rest) {
    if (!candidate.badgeKey)
      continue;
    if (valuesEquivalent(candidate.value, winner.value))
      continue;
    if (extras.some(extra => extra.key === candidate.badgeKey && valuesEquivalent(extra.value, candidate.value)))
      continue;
    extras.push({ key: candidate.badgeKey, value: candidate.value });
  }
  if (semanticClassName && !valuesEquivalent(semanticClassName, winner.value) && !extras.some(extra => extra.key === 'class' && valuesEquivalent(extra.value, semanticClassName)))
    extras.push({ key: 'class', value: semanticClassName });

  const consumedChildAlt = childAlt && valuesEquivalent(childAlt, winner.value) ? childAlt : undefined;
  return {
    name: winner.value,
    source: winner.source,
    consumedChildAlt,
    extras,
  };
}

function readImmediateChildAlt(node: AICustomDomTreeNode): string | undefined {
  for (const child of readChildren(node)) {
    const childRecord = child as Record<string, unknown>;
    const childAttributes = readRecord(childRecord.attributes) || {};
    const childAlt = normalizeText(readString(childAttributes.alt));
    if (childAlt)
      return childAlt;
  }
  return;
}

function formatRawOnclick(value: unknown): string | undefined {
  const raw = readString(value);
  if (!raw)
    return;
  const normalized = raw.toLowerCase();
  if (normalized.includes('dropdown-list'))
    return '...dropdown-list...';
  if (raw.length <= 50)
    return raw;
  return raw.slice(0, 47) + '...';
}

function formatNamingExtraBadges(extras: NamingExtra[]): string[] {
  return extras.map(extra => `[${extra.key}=${formatBadgeValue(extra.value)}]`);
}

function formatControlBadges(tag: string, attributes: Record<string, unknown>, name: string | undefined, nameSource: string | undefined): string[] {
  const parts: string[] = [];

  const placeholder = normalizeText(readString(attributes.placeholder));
  if (placeholder && nameSource !== 'placeholder' && placeholder !== name)
    parts.push(`[placeholder=${formatBadgeValue(placeholder)}]`);

  if (hasTruthyAttribute(attributes, 'required'))
    parts.push('[required]');
  if (hasTruthyAttribute(attributes, 'readonly') || attributeEquals(attributes['aria-readonly'], 'true'))
    parts.push('[readonly]');

  const boundedAttributes = [
    { key: 'min', badge: 'min' },
    { key: 'max', badge: 'max' },
    { key: 'step', badge: 'step' },
    { key: 'minlength', badge: 'minlength' },
    { key: 'maxlength', badge: 'maxlength' },
    { key: 'pattern', badge: 'pattern' },
  ];
  for (const bounded of boundedAttributes) {
    const value = readAttributeValue(attributes[bounded.key]);
    if (value)
      parts.push(`[${bounded.badge}=${formatBadgeValue(value)}]`);
  }
  return parts;
}

function shouldRenderNameAsSuffix(nodeRecord: Record<string, unknown>, role: string, nameSource: string | undefined, attributes: Record<string, unknown>): boolean {
  if (kNameAsSuffixRoles.has(role) && nameSource === 'text' && !readBoolean(nodeRecord.isInteractive) && !hasInlineHandler(attributes))
    return true;
  if (role !== 'generic')
    return false;
  if (nameSource !== 'text')
    return false;
  if (nodeRecord.isVisible !== false)
    return false;
  if (readString(nodeRecord.accessibleName))
    return false;
  return hasInlineHandler(attributes) || readBoolean(nodeRecord.isInteractive);
}

function formatBehaviorBadges(nodeRecord: Record<string, unknown>, tag: string, role: string, attributes: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const rawOnclick = formatRawOnclick(attributes.onclick);
  if (rawOnclick)
    parts.push(`[onclick=${quoteValue(rawOnclick)}]`);
  if (kShowTrackedEventListeners) {
    const eventListeners = readTrackedEventListeners(attributes);
    if (eventListeners.length)
      parts.push(`[listens=${formatBadgeValue(eventListeners.join(','))}]`);
  }
  if (isContentEditable(attributes))
    parts.push('[contenteditable]');
  if (hasPointerCursor(nodeRecord, attributes, role, tag))
    parts.push('[cursor=pointer]');
  const inputType = normalizeText(readString(attributes.type))?.toLowerCase();
  if (tag === 'input' && inputType && inputType !== 'text' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(inputType))
    parts.push(`[type=${formatBadgeValue(inputType)}]`);
  const href = readAttributeValue(attributes.href);
  if (href)
    parts.push(`[href=${formatBadgeValue(href)}]`);
  const target = readAttributeValue(attributes.target);
  if (target)
    parts.push(`[target=${formatBadgeValue(target)}]`);
  const action = readAttributeValue(attributes.action);
  if ((tag === 'form' || role === 'form') && action)
    parts.push(`[action=${formatBadgeValue(action)}]`);
  const method = readAttributeValue(attributes.method);
  if ((tag === 'form' || role === 'form') && method)
    parts.push(`[method=${formatBadgeValue(method.toLowerCase())}]`);
  return parts;
}

function formatAriaBadges(attributes: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const badges = [
    { key: 'aria-expanded', badge: 'expanded' },
    { key: 'aria-haspopup', badge: 'haspopup' },
    { key: 'aria-controls', badge: 'controls' },
    { key: 'aria-describedby', badge: 'describedby' },
    { key: 'aria-labelledby', badge: 'labelledby' },
  ];
  for (const item of badges) {
    const value = readAttributeValue(attributes[item.key]);
    if (value)
      parts.push(`[${item.badge}=${formatBadgeValue(value)}]`);
  }
  return parts;
}

function formatStructuralHintBadges(nodeRecord: Record<string, unknown>, tag: string, role: string, attributes: Record<string, unknown>, name: string | undefined, explicitRole: string | undefined, usedNamingExtraKeys: Set<string>): string[] {
  if (!isGenericContainerRole(tag, role) || explicitRole)
    return [];
  const isInteractiveLike = readBoolean(nodeRecord.isInteractive) || hasInlineHandler(attributes) || hasPointerCursor(nodeRecord, attributes, role, tag);
  if (!isInteractiveLike && nodeRecord.isVisible !== false)
    return [];

  const hints: NamingExtra[] = [];
  const classHint = readDescriptiveSemanticClassName(attributes.class);
  if (classHint && !usedNamingExtraKeys.has('class'))
    hints.push({ key: 'class', value: classHint });
  for (const [key, value] of readAllowedDataHints(attributes)) {
    if (usedNamingExtraKeys.has(key))
      continue;
    hints.push({ key, value });
  }
  if (!hints.length)
    return [];
  const selectedHints = name && isInteractiveLike
    ? hints.filter(hint => isHighSignalStructuralHintKey(hint.key))
    : hints;
  return selectedHints.map(hint => `[${hint.key}=${formatBadgeValue(hint.value)}]`);
}

function buildInlineTextHint(node: AICustomDomTreeNode, existingText?: string): string | undefined {
  const childTexts: string[] = [];
  const seen = new Set<string>();
  for (const child of readChildren(node)) {
    const childRecord = child as Record<string, unknown>;
    if (readBoolean(childRecord.isInteractive))
      continue;
    if (childRecord.isVisible === false)
      continue;
    if (!isInlineTextChild(childRecord))
      continue;
    const childText = normalizeText(readString(childRecord.text));
    if (!childText)
      continue;
    if (containsText(existingText, childText))
      continue;
    const key = childText.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    childTexts.push(childText);
  }
  if (!childTexts.length)
    return;
  return childTexts.join(', ');
}

function isInlineTextChild(nodeRecord: Record<string, unknown>): boolean {
  const tag = readString(nodeRecord.tag)?.toLowerCase();
  if (!tag || tag === 'svg' || tag === 'img')
    return false;
  const display = readString(readRecord(nodeRecord.computedStyle)?.display)?.toLowerCase();
  if (display === 'inline' || display === 'inline-block')
    return true;
  return ['strong', 'em', 'b', 'i', 'mark', 'small', 'code'].includes(tag);
}

function containsText(haystack: string | undefined, needle: string): boolean {
  if (!haystack)
    return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function isGenericContainerRole(tag: string, role: string): boolean {
  if (role !== 'generic')
    return false;
  return ['div', 'span', 'section', 'article', 'aside', 'main', 'header', 'footer', 'nav', 'form', 'li'].includes(tag);
}

function readSemanticClassHint(value: unknown): string | undefined {
  const className = readString(value);
  if (!className)
    return;
  const semanticTokens = className.split(/\s+/).filter(token => {
    if (!token)
      return false;
    const normalized = token.toLowerCase();
    if (normalized.length < 3)
      return false;
    if (/^(css|sc|jsx|chakra|mantine|ant|Mui|css-)/i.test(token))
      return false;
    if (/^[a-f0-9_-]{6,}$/i.test(token))
      return false;
    return /(icon|btn|button|toggle|switch|dropdown|menu|tab|modal|dialog|tooltip|popover|select|option|search|input|form|nav|sidebar|card|item|avatar|chip|badge|panel|list|active|selected|current|open|expanded|collapsed|disabled|checked)/i.test(token);
  });
  if (!semanticTokens.length)
    return;
  return semanticTokens.join(' ');
}

function readDescriptiveSemanticClassName(value: unknown): string | undefined {
  const classHint = readSemanticClassHint(value);
  if (!classHint)
    return;
  const normalized = classHint.toLowerCase().split(/\s+/);
  const genericOnly = normalized.every(token => ['icon', 'icon-btn', 'btn', 'button', 'item', 'panel', 'list', 'card'].includes(token));
  if (genericOnly)
    return;
  return classHint;
}

function readPreferredTestIdHints(attributes: Record<string, unknown>): NamingExtra[] {
  const hints: NamingExtra[] = [];
  const keys = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy'];
  for (const key of keys) {
    const value = readAttributeValue(attributes[key]);
    if (value)
      hints.push({ key, value });
  }
  return hints;
}

function readAllowedDataHints(attributes: Record<string, unknown>): Array<[string, string]> {
  const hints: Array<[string, string]> = [];
  const allowedKeys = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-action', 'data-tooltip', 'data-type', 'data-state', 'data-label', 'data-name'];
  for (const key of allowedKeys) {
    const value = readAttributeValue(attributes[key]);
    if (value)
      hints.push([key, value]);
  }
  return hints;
}

function isHighSignalStructuralHintKey(key: string): boolean {
  return ['class', 'data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-action', 'data-state'].includes(key);
}

function hasTruthyAttribute(attributes: Record<string, unknown>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(attributes, key))
    return false;
  const value = attributes[key];
  if (value === false || value === null || value === undefined)
    return false;
  if (typeof value === 'string')
    return value.toLowerCase() !== 'false';
  return true;
}

function attributeEquals(value: unknown, expected: string): boolean {
  return readAttributeValue(value)?.toLowerCase() === expected;
}

function readAttributeValue(value: unknown): string | undefined {
  if (typeof value === 'string')
    return normalizeText(value);
  if (typeof value === 'number' || typeof value === 'bigint')
    return String(value);
  if (value === true)
    return 'true';
  if (value === false)
    return 'false';
  return;
}

function formatBadgeValue(value: string): string {
  return /^[a-z0-9._:-]+$/i.test(value) ? value : quoteValue(value);
}

function hasPointerCursor(nodeRecord: Record<string, unknown>, attributes: Record<string, unknown>, role: string, tag: string): boolean {
  if (role !== 'generic')
    return false;
  const computedCursor = readString(readRecord(nodeRecord.computedStyle)?.cursor);
  const hasPointer = computedCursor === 'pointer' || styleContainsPointerCursor(attributes.style);
  if (!hasPointer)
    return false;
  if (readBoolean(nodeRecord.isInteractive))
    return true;
  if (hasInlineHandler(attributes))
    return true;
  if (tag === 'a' || tag === 'button' || tag === 'summary')
    return true;
  if (readString(nodeRecord.text) || readString(nodeRecord.accessibleName))
    return true;
  return false;
}

/**
 * Returns a compact line for svg/img children, or undefined to render normally.
 * Empty string means "collapse completely" (skip the child).
 */
function compactMediaChild(node: AICustomDomTreeNode, consumedChildAlt: string | undefined, indent: string): string | undefined {
  const nodeRecord = node as Record<string, unknown>;
  const tag = readString(nodeRecord.tag)?.toLowerCase();
  if (tag !== 'svg' && tag !== 'img')
    return undefined;

  if (tag === 'svg')
    return `${indent}- img [tag=svg]`;

  const attributes = readRecord(nodeRecord.attributes) || {};
  const alt = normalizeText(readString(attributes.alt));
  const altBadge = alt ? ` [alt=${quoteValue(alt)}]` : '';
  return `${indent}- img${altBadge}`;
}

function findCollapsibleLabelControl(node: AICustomDomTreeNode): AICustomDomTreeNode | undefined {
  const nodeRecord = node as Record<string, unknown>;
  const tag = readString(nodeRecord.tag)?.toLowerCase();
  if (tag !== 'label')
    return;
  const children = readChildren(node);
  const elementChildren = children.filter(child => !!readString((child as Record<string, unknown>).tag));
  if (elementChildren.length !== 1)
    return;
  const control = elementChildren[0];
  const controlTag = readString((control as Record<string, unknown>).tag)?.toLowerCase();
  if (!controlTag)
    return;
  if (!['input', 'select', 'textarea', 'button'].includes(controlTag))
    return;
  return control;
}

function readCollapsedLabelName(node: AICustomDomTreeNode): string | undefined {
  const nodeRecord = node as Record<string, unknown>;
  const attributes = readRecord(nodeRecord.attributes) || {};
  const resolved = resolveNodeName(node, 'label', attributes);
  return resolved.name || normalizeText(readString(nodeRecord.text));
}

function quoteValue(value: string): string {
  return JSON.stringify(normalizeText(value) || value);
}

function normalizeText(value: string | undefined): string | undefined {
  if (!value)
    return;
  const normalized = value.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  if (!normalized)
    return;
  if (normalized.length <= 200)
    return normalized;
  return normalized.slice(0, 197) + '...';
}

function isContentEditable(attributes: Record<string, unknown>): boolean {
  const value = readString(attributes.contenteditable);
  return !!value && value.toLowerCase() !== 'false';
}

function readChildren(node: AICustomDomTreeNode): AICustomDomTreeNode[] {
  const raw = (node as Record<string, unknown>).children;
  if (!Array.isArray(raw))
    return [];
  const children: AICustomDomTreeNode[] = [];
  for (const child of raw) {
    const parsed = asTreeNode(child);
    if (parsed)
      children.push(parsed);
  }
  return children;
}

function asTreeNode(value: unknown): AICustomDomTreeNode | undefined {
  if (!value || typeof value !== 'object')
    return;
  return value as AICustomDomTreeNode;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object')
    return;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return;
  const trimmed = value.trim();
  if (!trimmed)
    return;
  return trimmed;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readHeadingLevel(value: unknown, tag: string): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0)
    return value;
  if (typeof value === 'string' && /^\d+$/.test(value))
    return Number(value);
  const heading = tag.match(/^h([1-6])$/);
  if (heading)
    return Number(heading[1]);
  return;
}

function styleContainsPointerCursor(value: unknown): boolean {
  const style = readString(value);
  if (!style)
    return false;
  return /(?:^|;)\s*cursor\s*:\s*pointer\s*(?:;|$)/i.test(style);
}

function hasInlineHandler(attributes: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.startsWith('on'))
      continue;
    if (readAttributeValue(value))
      return true;
  }
  return false;
}

function readTrackedEventListeners(attributes: Record<string, unknown>): string[] {
  const value = readAttributeValue(attributes['data-pw-listens']);
  if (!value)
    return [];
  return value.split(',').map(type => type.trim().toLowerCase()).filter(Boolean);
}

function valuesEquivalent(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right)
    return false;
  return comparableText(left) === comparableText(right);
}

function comparableText(value: string): string {
  return normalizeText(value)?.toLowerCase().replace(/['"`]/g, '').trim() || '';
}

function extractSourceName(value: unknown): string | undefined {
  const src = readString(value);
  if (!src || src.startsWith('data:'))
    return;
  try {
    const url = new URL(src, 'http://example.invalid');
    const pathname = url.pathname.split('/').pop();
    return normalizeText(pathname || src);
  } catch {
    const fileName = src.split(/[/?#]/).filter(Boolean).pop();
    return normalizeText(fileName);
  }
}
