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

import type { LocatorPlanCandidateAttempt } from './customDomLocatorCompiler';

export type CustomDomResolverDiagnostics = {
  ref: string;
  alias: {
    status: 'found' | 'missing';
    stableId?: string;
    framePath?: number[];
  };
  locatorPlan: {
    status: 'found' | 'missing' | 'not-checked';
    key?: string;
  };
  frame: {
    status: 'resolved' | 'stale' | 'not-checked';
    framePath?: number[];
  };
  candidates: {
    total: number;
    attempts: LocatorPlanCandidateAttempt[];
  };
  outcome: {
    status: 'resolved' | 'alias-missing' | 'locator-plan-missing' | 'frame-stale' | 'no-candidates' | 'no-match' | 'ambiguous';
    selectedStrategy?: string;
  };
};

export class CustomDomResolverError extends Error {
  readonly diagnostics: CustomDomResolverDiagnostics;

  constructor(diagnostics: CustomDomResolverDiagnostics) {
    super(formatCustomDomResolverDiagnostics(diagnostics));
    this.name = 'CustomDomResolverError';
    this.diagnostics = diagnostics;
  }
}

export function formatCustomDomResolverDiagnostics(diagnostics: CustomDomResolverDiagnostics): string {
  const lines = [
    `Ref ${diagnostics.ref} not found in the current page snapshot.`,
    'Custom DOM resolver diagnostics:',
    `- alias: ${formatAlias(diagnostics)}`,
    `- locator plan: ${formatLocatorPlan(diagnostics)}`,
    `- frame: ${formatFrame(diagnostics)}`,
    `- candidates: ${diagnostics.candidates.total}`,
  ];

  for (const attempt of diagnostics.candidates.attempts)
    lines.push(`- candidate ${attempt.strategy}: ${formatAttempt(attempt)}`);

  lines.push(`- outcome: ${formatOutcome(diagnostics)}`);
  lines.push('- action: capture a fresh snapshot if the DOM or frame tree changed.');
  return lines.join('\n');
}

function formatAlias(diagnostics: CustomDomResolverDiagnostics): string {
  if (diagnostics.alias.status === 'missing')
    return 'not found';
  return `found (stableId=${diagnostics.alias.stableId}, framePath=${formatFramePath(diagnostics.alias.framePath)})`;
}

function formatLocatorPlan(diagnostics: CustomDomResolverDiagnostics): string {
  if (diagnostics.locatorPlan.status === 'not-checked')
    return 'not checked';
  if (diagnostics.locatorPlan.status === 'missing')
    return diagnostics.locatorPlan.key ? `not found (key=${diagnostics.locatorPlan.key})` : 'not found';
  return diagnostics.locatorPlan.key ? `found (key=${diagnostics.locatorPlan.key})` : 'found';
}

function formatFrame(diagnostics: CustomDomResolverDiagnostics): string {
  if (diagnostics.frame.status === 'not-checked')
    return 'not checked';
  return `${diagnostics.frame.status} (framePath=${formatFramePath(diagnostics.frame.framePath)})`;
}

function formatAttempt(attempt: LocatorPlanCandidateAttempt): string {
  const parts = [`status=${attempt.status}`];
  if (typeof attempt.count === 'number')
    parts.push(`count=${attempt.count}`);
  parts.push(`selector=${attempt.selector}`);
  if (attempt.error)
    parts.push(`error=${attempt.error}`);
  return parts.join(', ');
}

function formatOutcome(diagnostics: CustomDomResolverDiagnostics): string {
  switch (diagnostics.outcome.status) {
    case 'resolved':
      return diagnostics.outcome.selectedStrategy ? `resolved via ${diagnostics.outcome.selectedStrategy}` : 'resolved';
    case 'alias-missing':
      return 'alias missing';
    case 'locator-plan-missing':
      return 'locator plan missing';
    case 'frame-stale':
      return 'frame stale';
    case 'no-candidates':
      return 'no locator candidates compiled from locator plan';
    case 'no-match':
      return 'no candidate matched any element';
    case 'ambiguous':
      return 'ambiguity: one or more candidates matched multiple elements and none matched uniquely';
  }
}

function formatFramePath(framePath: number[] | undefined): string {
  if (!framePath?.length)
    return 'root';
  return framePath.join('.');
}
