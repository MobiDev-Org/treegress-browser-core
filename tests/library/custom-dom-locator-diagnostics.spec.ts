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

import { playwrightTest as it, expect } from '../config/browserTest';
import { inspectLocatorCandidates } from '../../packages/playwright-core/src/tools/customDomLocatorCompiler';

it('should classify ambiguous locator candidates', async ({ page }) => {
  await page.setContent(`
    <button>Open</button>
    <button>Open</button>
  `);

  const inspection = await inspectLocatorCandidates([
    {
      strategy: 'getByRole',
      locator: page.getByRole('button', { name: 'Open' }),
    },
  ]);

  expect(inspection.selected).toBeUndefined();
  expect(inspection.outcome).toBe('ambiguous');
  expect(inspection.attempts).toEqual([
    expect.objectContaining({
      strategy: 'getByRole',
      status: 'ambiguous',
      count: 2,
    }),
  ]);
});
