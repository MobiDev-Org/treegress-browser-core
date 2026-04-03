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

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { playwrightTest as it, expect } from '../config/browserTest';
// Intentionally import the built formatter to validate the release/runtime path.
import { formatCustomDomSnapshot, isCustomDomSnapshotEnvelope } from '../../packages/playwright-core/lib/tools/customDomSnapshotFormatter';

it('should match the golden custom-dom snapshot through the production runtime path', async ({ page }) => {
  const target = pathToFileURL(path.join(__dirname, '../../debug-pages/accessibility-test.html')).href;
  const goldenSnapshot = fs.readFileSync(path.join(__dirname, '../../accessibility-test.custom-dom-snapshot.md'), 'utf8');

  await page.goto(target, { waitUntil: 'load' });

  const snapshot = await (page as any)._snapshotForAI({ backend: 'custom-dom' });
  expect(snapshot.backend).toBe('custom-dom');
  expect(isCustomDomSnapshotEnvelope(snapshot.envelope)).toBeTruthy();

  const formatted = formatCustomDomSnapshot(snapshot.envelope);
  expect(`${formatted.snapshot}\n`).toBe(goldenSnapshot);
});
