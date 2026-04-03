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
import { parseResponse, test, expect } from './fixtures';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

test.describe('debug custom-dom snapshot + ref flow', () => {
  test.skip(({ mcpBrowser }) => mcpBrowser !== 'chromium', 'Debug this on Chromium first.');
  test.use({ mcpCaps: ['testing'] });

  test('capture snapshot, save files, generate locators, click through refs', async ({ client, server }, testInfo) => {
    server.setContent('/', `
      <!doctype html>
      <html>
      <body>
        <h1>A/B Page</h1>

        <div id="gear" title="Gear" style="width:24px;height:24px;cursor:pointer;background:#ccc;"></div>

        <div class="card">
          <button>Open</button>
        </div>
        <div class="card">
          <button>Open</button>
        </div>

        <div id="host"></div>

        <script>
          document.getElementById('gear').addEventListener('click', () => {
            document.body.dataset.gear = 'clicked';
          });

          document.querySelectorAll('button')[1].addEventListener('click', () => {
            document.body.dataset.dup = 'second';
          });

          const root = document.getElementById('host').attachShadow({ mode: 'open' });
          const button = document.createElement('button');
          button.textContent = 'Shadow Action';
          button.addEventListener('click', () => {
            document.body.dataset.shadow = 'clicked';
          });
          root.appendChild(button);
        </script>
      </body>
      </html>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    // 1) Save MCP snapshot to a file in Playwright test output.
    const saveSnapshotResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: { filename: 'custom-dom.yml' },
    });

    expect(saveSnapshotResponse.content[0].text).toContain('custom-dom.yml');

    const snapshotPath = testInfo.outputPath('custom-dom.yml');
    const savedSnapshot = await fs.promises.readFile(snapshotPath, 'utf8');

    // 2) Also grab snapshot text in-memory so we can parse refs.
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot' });
    const snapshot = snapshotText(snapshotResponse);

    const gearRef = findRef(snapshot, /"Gear"[^\n]*\[ref=(e\d+)\]/);
    const secondOpenRef = findNthRef(snapshot, /button "Open"[^\n]*\[ref=(e\d+)\]/g, 1);
    const shadowRef = findRef(snapshot, /button "Shadow Action"[^\n]*\[ref=(e\d+)\]/);

    const gearLocatorResponse = await client.callTool({
      name: 'browser_generate_locator',
      arguments: { element: 'Gear control', ref: gearRef },
    });
    console.log('RAW gear locator response:', JSON.stringify(gearLocatorResponse, null, 2));
    console.log('PARSED gear locator response:', parseResponse(gearLocatorResponse));

    // 3) Generate locator code for each ref.
    const gearLocator = parseResponse(gearLocatorResponse).result;

    const secondOpenResponse = await client.callTool({
      name: 'browser_generate_locator',
      arguments: { element: 'Second Open button', ref: secondOpenRef },
    });
    console.log('RAW gear locator response:', JSON.stringify(secondOpenResponse, null, 2));
    console.log('PARSED gear locator response:', parseResponse(secondOpenResponse));

    const secondOpenLocator = parseResponse(secondOpenResponse).result;


    const shadowLocator = parseResponse(await client.callTool({
      name: 'browser_generate_locator',
      arguments: { element: 'Shadow Action', ref: shadowRef },
    })).result;

    // 4) Click through refs.
    await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Gear control', ref: gearRef },
    });

    await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Second Open button', ref: secondOpenRef },
    });

    await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Shadow Action', ref: shadowRef },
    });

    // 5) Verify page state changed exactly as expected.
    const stateText = parseResponse(await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        function: `() => ({
          gear: document.body.dataset.gear || null,
          dup: document.body.dataset.dup || null,
          shadow: document.body.dataset.shadow || null
        })`,
      },
    })).result as string;

    const state = JSON.parse(stateText);

    expect(state).toEqual({
      gear: 'clicked',
      dup: 'second',
      shadow: 'clicked',
    });

    // 6) Save a readable debug report alongside the snapshot.
    const report = [
      '=== SNAPSHOT FILE ===',
      snapshotPath,
      '',
      '=== REFS ===',
      `gearRef=${gearRef}`,
      `secondOpenRef=${secondOpenRef}`,
      `shadowRef=${shadowRef}`,
      '',
      '=== GENERATED LOCATORS ===',
      `gearLocator=${gearLocator}`,
      `secondOpenLocator=${secondOpenLocator}`,
      `shadowLocator=${shadowLocator}`,
      '',
      '=== FINAL STATE ===',
      JSON.stringify(state, null, 2),
      '',
      '=== SNAPSHOT CONTENT ===',
      savedSnapshot,
    ].join('\n');

    await fs.promises.writeFile(testInfo.outputPath('debug-report.txt'), report, 'utf8');

    // 7) Minimal sanity assertions on snapshot content.
    expect(savedSnapshot).toContain('[ref=e');
    expect(savedSnapshot).toContain('Gear');
    expect(savedSnapshot).toContain('Shadow Action');
  });
});

function snapshotText(response: Awaited<ReturnType<Client['callTool']>>): string {
  const snapshot = parseResponse(response).snapshot;
  if (!snapshot)
    throw new Error(`Snapshot section not found in response:\n${parseResponse(response).text}`);
  return snapshot.replace(/^```yaml\n/, '').replace(/\n```$/, '');
}

function findRef(snapshot: string, pattern: RegExp): string {
  const match = snapshot.match(pattern);
  if (!match?.[1])
    throw new Error(`Unable to find ref with pattern ${pattern}\nSnapshot:\n${snapshot}`);
  return match[1];
}

function findNthRef(snapshot: string, pattern: RegExp, index: number): string {
  const matches = [...snapshot.matchAll(pattern)];
  if (!matches[index]?.[1])
    throw new Error(`Unable to find match #${index} for pattern ${pattern}\nSnapshot:\n${snapshot}`);
  return matches[index][1];
}
