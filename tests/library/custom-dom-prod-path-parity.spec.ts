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
// Intentionally use the built bundle to validate the release/runtime path.
const { formatCustomDomSnapshot, isCustomDomSnapshotEnvelope } = require('../../packages/playwright-core/lib/coreBundle').tools;

it('should match the golden custom-dom snapshot through the production runtime path', async ({ page }) => {
  const target = pathToFileURL(path.join(__dirname, '../../debug-pages/accessibility-test.html')).href;
  const goldenFile = path.join(__dirname, '../../accessibility-test.custom-dom-snapshot.md');
  it.skip(!fs.existsSync(goldenFile), 'Golden custom-dom snapshot is not checked in');
  const goldenSnapshot = fs.readFileSync(goldenFile, 'utf8');

  await page.goto(target, { waitUntil: 'load' });

  const envelope = await (page as any)._customDomSnapshot();
  expect(isCustomDomSnapshotEnvelope(envelope)).toBeTruthy();

  const formatted = formatCustomDomSnapshot(envelope);
  expect(`${formatted.snapshot}\n`).toBe(goldenSnapshot);
});
