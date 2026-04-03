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

import { serializeDOM } from './customDomSerializer';

import type { AICustomDomFrameData, AICustomDomStableId } from '@isomorphic/aiSnapshotTypes';

type RawSerializeResult = {
  dom?: Record<string, any>;
  locators?: Record<string, Record<string, any>>;
};

function collectStableIdOrder(node: unknown, idOrder: AICustomDomStableId[], seen: Set<AICustomDomStableId>) {
  if (!node || typeof node !== 'object')
    return;
  const maybeNode = node as { id?: unknown, children?: unknown };
  if (typeof maybeNode.id === 'string' && !seen.has(maybeNode.id)) {
    seen.add(maybeNode.id);
    idOrder.push(maybeNode.id);
  }
  if (!Array.isArray(maybeNode.children))
    return;
  for (const child of maybeNode.children)
    collectStableIdOrder(child, idOrder, seen);
}

function normalizeLocatorPlans(raw: unknown): Record<AICustomDomStableId, Record<string, any>> {
  if (!raw || typeof raw !== 'object')
    return {};
  const result: Record<AICustomDomStableId, Record<string, any>> = {};
  for (const [stableId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof stableId !== 'string' || !stableId)
      continue;
    if (!value || typeof value !== 'object')
      continue;
    result[stableId] = value as Record<string, any>;
  }
  return result;
}

export function captureCustomDomSnapshot(root: Element): AICustomDomFrameData {
  const raw = serializeDOM(root) as RawSerializeResult;
  const dom = raw.dom && typeof raw.dom === 'object' ? raw.dom : {};
  const locatorPlans = normalizeLocatorPlans(raw.locators);

  const idOrder: AICustomDomStableId[] = [];
  const seenIds = new Set<AICustomDomStableId>();
  collectStableIdOrder(dom, idOrder, seenIds);

  const stableIds: AICustomDomStableId[] = [];
  const stableSeen = new Set<AICustomDomStableId>();
  for (const id of [...idOrder, ...Object.keys(locatorPlans)]) {
    if (stableSeen.has(id))
      continue;
    stableSeen.add(id);
    stableIds.push(id);
  }

  return {
    dom,
    stableIds,
    idOrder,
    locatorPlans,
  };
}
