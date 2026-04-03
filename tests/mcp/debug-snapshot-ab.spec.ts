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
import { parseResponse, test, expect } from './fixtures';

test.describe('debug snapshot A/B: custom-dom vs aria', () => {
  test.skip(({ mcpBrowser }) => mcpBrowser !== 'chromium', 'Run on Chromium first.');
  test.use({ mcpCaps: ['testing'] });

  test('save both custom-dom and aria snapshots for the same page', async ({ client, server }, testInfo) => {
    // server.setContent('/', `
    //   <!doctype html>
    //   <html>
    //   <body>
    //     <h1>A/B Page</h1>

    //     <div id="gear" title="Gear" style="width:24px;height:24px;cursor:pointer;background:#ccc;"></div>

    //     <div class="card">
    //       <button>Open</button>
    //     </div>
    //     <div class="card">
    //       <button>Open</button>
    //     </div>

    //     <div id="host"></div>

    //     <script>
    //       document.getElementById('gear').addEventListener('click', () => {
    //         document.body.dataset.gear = 'clicked';
    //       });

    //       document.querySelectorAll('button')[1].addEventListener('click', () => {
    //         document.body.dataset.dup = 'second';
    //       });

    //       const root = document.getElementById('host').attachShadow({ mode: 'open' });
    //       const button = document.createElement('button');
    //       button.textContent = 'Shadow Action';
    //       button.addEventListener('click', () => {
    //         document.body.dataset.shadow = 'clicked';
    //       });
    //       root.appendChild(button);
    //     </script>
    //   </body>
    //   </html>
    // `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'http://127.0.0.1:4173/accessibility-test.html' },
    });

    const customResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: {
        backend: 'custom-dom',
        filename: 'custom-dom.yml',
      },
    });

    const ariaResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: {
        backend: 'aria',
        filename: 'aria.yml',
      },
    });

    expect(parseResponse(customResponse).text).toContain('custom-dom.yml');
    expect(parseResponse(ariaResponse).text).toContain('aria.yml');

    const customPath = testInfo.outputPath('custom-dom.yml');
    const ariaPath = testInfo.outputPath('aria.yml');

    const customText = await fs.promises.readFile(customPath, 'utf8');
    const ariaText = await fs.promises.readFile(ariaPath, 'utf8');

    const report = [
      '=== CUSTOM-DOM SNAPSHOT ===',
      customText,
      '',
      '=== ARIA SNAPSHOT ===',
      ariaText,
    ].join('\n');

    await fs.promises.writeFile(testInfo.outputPath('snapshot-ab-report.txt'), report, 'utf8');

    expect(customText).toContain('[ref=e');
    expect(ariaText).toContain('[ref=e');
  });
});
