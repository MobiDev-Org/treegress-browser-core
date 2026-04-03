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

import type { Frame } from '../client/frame';
import type { Locator } from '../client/locator';
import type { ByRoleOptions } from '../utils/isomorphic/locatorUtils';
import type { AICustomDomLocatorPlan } from '../utils/isomorphic/aiSnapshotTypes';

type LocatorRoot = Frame | Locator;
type StrategyDetails = Record<string, unknown>;
type StrategyDescriptor = {
  strategy: string;
  details: StrategyDetails;
};
export type LocatorPlanCandidate = {
  strategy: string;
  locator: Locator;
};
export type LocatorPlanCandidateAttempt = {
  strategy: string;
  selector: string;
  count?: number;
  status: 'unique' | 'ambiguous' | 'no-match' | 'error';
  error?: string;
};
export type LocatorPlanCandidateInspection = {
  selected?: LocatorPlanCandidate;
  attempts: LocatorPlanCandidateAttempt[];
  outcome: 'unique' | 'ambiguous' | 'no-match';
};

const kPriorityOrder = [
  'getByTestId',
  'getByRole',
  'filtered_getByRole',
  'chained_getByRole',
  'getByText',
  'filtered_getByText',
  'chained_getByText',
  'getByPlaceholder',
  'getByCss',
  'getByXpath',
] as const;

export function compileLocatorFromPlan(frame: Frame, locatorPlan: AICustomDomLocatorPlan): Locator | undefined {
  return compileLocatorCandidatesFromPlan(frame, locatorPlan)[0]?.locator;
}

export function compileLocatorCandidatesFromPlan(frame: Frame, locatorPlan: AICustomDomLocatorPlan): LocatorPlanCandidate[] {
  const plan = readRecord(locatorPlan);
  if (!plan)
    return [];

  const candidates: LocatorPlanCandidate[] = [];
  const seenSelectors = new Set<string>();
  const addCandidate = (strategy: string, locator: Locator | undefined) => {
    if (!locator)
      return;
    if (seenSelectors.has(locator._selector))
      return;
    seenSelectors.add(locator._selector);
    candidates.push({ strategy, locator });
  };

  for (const strategyName of kPriorityOrder) {
    const details = readRecord(plan[strategyName]);
    if (!details)
      continue;
    addCandidate(strategyName, compileByStrategy(frame, strategyName, details));
  }

  const priority = Array.isArray(plan.priority) ? plan.priority : [];
  for (const candidate of priority) {
    if (typeof candidate !== 'string')
      continue;
    const details = readRecord(plan[candidate]);
    if (!details)
      continue;
    addCandidate(candidate, compileByStrategy(frame, candidate, details));
  }
  return candidates;
}

export async function inspectLocatorCandidates(candidates: LocatorPlanCandidate[]): Promise<LocatorPlanCandidateInspection> {
  const attempts: LocatorPlanCandidateAttempt[] = [];
  let ambiguousSeen = false;

  for (const candidate of candidates) {
    try {
      const count = await candidate.locator.count();
      const status = count === 1 ? 'unique' : count > 1 ? 'ambiguous' : 'no-match';
      attempts.push({
        strategy: candidate.strategy,
        selector: candidate.locator._selector,
        count,
        status,
      });
      if (count === 1)
        return { selected: candidate, attempts, outcome: 'unique' };
      if (count > 1)
        ambiguousSeen = true;
    } catch (error) {
      attempts.push({
        strategy: candidate.strategy,
        selector: candidate.locator._selector,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    attempts,
    outcome: ambiguousSeen ? 'ambiguous' : 'no-match',
  };
}

function compileByStrategy(root: LocatorRoot, strategy: string, details: StrategyDetails): Locator | undefined {
  if (strategy === 'filtered_getByRole' || strategy === 'filtered_getByText')
    return compileFiltered(root, details);
  if (strategy === 'chained_getByRole' || strategy === 'chained_getByText')
    return compileChained(root, details);
  return compileSimple(root, strategy, details);
}

function compileSimple(root: LocatorRoot, strategy: string, details: StrategyDetails): Locator | undefined {
  if (strategy === 'getByTestId') {
    const testId = readString(details.testId);
    if (!testId)
      return;
    return root.getByTestId(testId);
  }
  if (strategy === 'getByRole') {
    const role = readString(details.role);
    if (!role)
      return;
    return root.getByRole(role, roleOptionsFromDetails(details));
  }
  if (strategy === 'getByText') {
    const text = readString(details.text);
    if (!text)
      return;
    const exact = typeof details.exact === 'boolean' ? details.exact : undefined;
    return root.getByText(text, exact === undefined ? undefined : { exact });
  }
  if (strategy === 'getByPlaceholder') {
    const placeholder = readString(details.placeholder);
    if (!placeholder)
      return;
    const exact = typeof details.exact === 'boolean' ? details.exact : undefined;
    return root.getByPlaceholder(placeholder, exact === undefined ? undefined : { exact });
  }
  if (strategy === 'getByCss') {
    const css = readString(details.css);
    if (!css)
      return;
    return root.locator(css);
  }
  if (strategy === 'getByXpath') {
    const xpath = readString(details.xpath);
    if (!xpath)
      return;
    const expression = xpath.startsWith('xpath=') ? xpath : `xpath=${xpath}`;
    return root.locator(expression);
  }
  if (strategy === 'getByTitle') {
    const title = readString(details.title);
    if (!title)
      return;
    const exact = typeof details.exact === 'boolean' ? details.exact : undefined;
    return root.getByTitle(title, exact === undefined ? undefined : { exact });
  }
  return;
}

function compileFiltered(root: LocatorRoot, details: StrategyDetails): Locator | undefined {
  const base = readStrategyDescriptor(details.base);
  if (!base)
    return;
  const baseLocator = compileByStrategy(root, base.strategy, base.details);
  if (!baseLocator)
    return;

  const filter = readStrategyDescriptor(details.filter);
  if (!filter)
    return baseLocator;
  if (filter.strategy === 'getByText') {
    const filterText = readString(filter.details.text);
    if (filterText)
      return baseLocator.filter({ hasText: filterText });
  }
  const filterLocator = compileByStrategy(baseLocator, filter.strategy, filter.details);
  if (!filterLocator)
    return baseLocator;
  return baseLocator.filter({ has: filterLocator });
}

function compileChained(root: LocatorRoot, details: StrategyDetails): Locator | undefined {
  const anchor = readStrategyDescriptor(details.anchor);
  const target = readStrategyDescriptor(details.target);
  if (!anchor || !target)
    return;
  const anchorLocator = compileByStrategy(root, anchor.strategy, anchor.details);
  if (!anchorLocator)
    return;
  return compileByStrategy(anchorLocator, target.strategy, target.details);
}

function roleOptionsFromDetails(details: StrategyDetails): ByRoleOptions {
  const options: ByRoleOptions = {};
  if (typeof details.name === 'string' && details.name)
    options.name = details.name;
  if (typeof details.exact === 'boolean')
    options.exact = details.exact;
  if (typeof details.checked === 'boolean')
    options.checked = details.checked;
  if (typeof details.disabled === 'boolean')
    options.disabled = details.disabled;
  if (typeof details.selected === 'boolean')
    options.selected = details.selected;
  if (typeof details.expanded === 'boolean')
    options.expanded = details.expanded;
  if (typeof details.includeHidden === 'boolean')
    options.includeHidden = details.includeHidden;
  if (typeof details.level === 'number')
    options.level = details.level;
  if (typeof details.pressed === 'boolean')
    options.pressed = details.pressed;
  return options;
}

function readStrategyDescriptor(value: unknown): StrategyDescriptor | undefined {
  const record = readRecord(value);
  if (!record)
    return;
  const strategy = readString(record.strategy);
  const details = readRecord(record.details);
  if (!strategy || !details)
    return;
  return { strategy, details };
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
