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

import { parseResponse, test, expect } from './fixtures';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

test.describe('custom-dom snapshot backend', () => {
  test.skip(({ mcpBrowser }) => mcpBrowser !== 'chromium', 'This suite validates custom-dom MCP flow on Chromium.');
  test.use({ mcpCaps: ['testing'] });

  test('browser_snapshot emits MCP refs and ref->locator mapping is stable inside one snapshot', async ({ client, server }) => {
    server.setContent('/', `
      <button>Submit</button>
      <input placeholder="Email" />
      <div id="status"></div>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot' });
    const snapshot = snapshotText(snapshotResponse);

    expect(snapshot).toContain('[ref=e');
    expect(snapshot).not.toContain('[ref=f');

    const submitRef = findRef(snapshot, /button "Submit"[^\n]*\[ref=(e\d+)\]/);
    const locator1 = parseResponse(await client.callTool({
      name: 'browser_generate_locator',
      arguments: { element: 'Submit', ref: submitRef },
    })).result;
    const locator2 = parseResponse(await client.callTool({
      name: 'browser_generate_locator',
      arguments: { element: 'Submit', ref: submitRef },
    })).result;

    expect(locator1).toBeTruthy();
    expect(locator1).toBe(locator2);
  });

  test('browser_click/browser_hover/browser_type/browser_select_option resolve through custom ref resolver', async ({ client, server }) => {
    server.setContent('/', `
      <button id="action">Action</button>
      <input type="text" placeholder="Name" />
      <select id="choice">
        <option>One</option>
        <option>Two</option>
      </select>
      <div id="state"></div>
      <script>
        const state = document.getElementById('state');
        const button = document.getElementById('action');
        const input = document.querySelector('input');
        const select = document.getElementById('choice');
        button.addEventListener('mouseover', () => document.body.dataset.hovered = 'yes');
        input.addEventListener('input', () => document.body.dataset.typed = input.value);
        select.addEventListener('input', () => document.body.dataset.selected = select.value);
        button.addEventListener('click', () => {
          document.body.dataset.clicked = 'yes';
          state.textContent = [document.body.dataset.hovered, document.body.dataset.typed, document.body.dataset.selected, document.body.dataset.clicked].join('|');
        });
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    let refs = await collectRefs(client);
    await client.callTool({
      name: 'browser_type',
      arguments: {
        element: 'Name input',
        ref: refs.textbox,
        text: 'Alice',
      },
    });

    refs = await collectRefs(client);
    await client.callTool({
      name: 'browser_hover',
      arguments: {
        element: 'Action button',
        ref: refs.actionButton,
      },
    });

    refs = await collectRefs(client);
    await client.callTool({
      name: 'browser_select_option',
      arguments: {
        element: 'Choice',
        ref: refs.combobox,
        values: ['Two'],
      },
    });

    refs = await collectRefs(client);
    const clickResponse = await client.callTool({
      name: 'browser_click',
      arguments: {
        element: 'Action button',
        ref: refs.actionButton,
      },
    });
    expect(snapshotText(clickResponse)).toContain('yes|Alice|Two|yes');
  });

  test('Shadow DOM nodes are discoverable and actionable', async ({ client, server }) => {
    server.setContent('/', `
      <div id="host"></div>
      <script>
        const root = document.getElementById('host').attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        button.textContent = 'Shadow Action';
        button.addEventListener('click', () => document.body.dataset.shadow = 'clicked');
        root.appendChild(button);
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const shadowRef = findRef(snapshot, /button "Shadow Action"[^\n]*\[ref=(e\d+)\]/);

    await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Shadow Action', ref: shadowRef },
    });

    const evaluated = parseResponse(await client.callTool({
      name: 'browser_evaluate',
      arguments: { function: '() => document.body.dataset.shadow' },
    })).result;
    expect(evaluated).toContain('clicked');
  });

  test('shadow DOM locator generation avoids legacy >>> combinator and prefers unique ids', async ({ client, server }) => {
    server.setContent('/', `
      <div id="host"></div>
      <script>
        const root = document.getElementById('host').attachShadow({ mode: 'open' });
        root.innerHTML = \`
          <button>Open</button>
          <button id="shadow-target">Open</button>
        \`;
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const shadowRef = findNthRef(snapshot, /button "Open"[^\n]*\[ref=(e\d+)\]/g, 1);

    const locator = parseResponse(await client.callTool({
      name: 'browser_generate_locator',
      arguments: { element: 'Shadow Open button', ref: shadowRef },
    })).result;

    expect(locator).toContain(`locator('#shadow-target')`);
    expect(locator).not.toContain('>>>');
  });

  test('duplicated shadow DOM text falls back to non-text locator strategies', async ({ client, server }) => {
    server.setContent('/', `
      <div id="host"></div>
      <script>
        const root = document.getElementById('host').attachShadow({ mode: 'open' });
        root.innerHTML = \`
          <div class="card"><button>Open</button></div>
          <div class="card"><button>Open</button></div>
        \`;
        root.querySelectorAll('button')[1].addEventListener('click', () => document.body.dataset.shadowDup = 'second');
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const shadowRef = findNthRef(snapshot, /button "Open"[^\n]*\[ref=(e\d+)\]/g, 1);

    const clickResponse = await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Second shadow Open button', ref: shadowRef },
    });
    expect(parseResponse(clickResponse).isError).not.toBeTruthy();

    const evaluated = parseResponse(await client.callTool({
      name: 'browser_evaluate',
      arguments: { function: '() => document.body.dataset.shadowDup' },
    })).result;
    expect(evaluated).toContain('second');
  });

  test('iframe-hosted elements are discoverable and actionable', async ({ client, server }) => {
    server.setContent('/', `
      <iframe srcdoc="<button id='inside'>Inside Frame</button><script>document.getElementById('inside').addEventListener('click', () => parent.document.body.dataset.frameClicked = 'yes');</script>"></iframe>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const insideRef = findRef(snapshot, /button "Inside Frame"[^\n]*\[ref=(e\d+)\]/);

    await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Inside Frame button', ref: insideRef },
    });

    const evaluated = parseResponse(await client.callTool({
      name: 'browser_evaluate',
      arguments: { function: '() => document.body.dataset.frameClicked' },
    })).result;
    expect(evaluated).toContain('yes');
  });

  test('stale iframe refs report alias/plan/frame diagnostics', async ({ client, server }) => {
    server.setContent('/', `
      <iframe srcdoc="<button id='inside'>Inside Frame</button>"></iframe>
      <script>
        setTimeout(() => document.querySelector('iframe')?.remove(), 500);
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const insideRef = findRef(snapshot, /button "Inside Frame"[^\n]*\[ref=(e\d+)\]/);
    await new Promise(resolve => setTimeout(resolve, 700));

    const response = await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Inside Frame button', ref: insideRef },
    });
    const parsed = parseResponse(response);
    expect(parsed.isError).toBeTruthy();
    expect(parsed.error).toContain('Custom DOM resolver diagnostics:');
    expect(parsed.error).toContain('- alias: found');
    expect(parsed.error).toContain('- locator plan: found');
    expect(parsed.error).toContain('- frame: stale');
    expect(parsed.error).toContain('- outcome: frame stale');
  });

  test('removed elements report candidate counts and no-match diagnostics', async ({ client, server }) => {
    server.setContent('/', `
      <button id="remove-me">Remove Me</button>
      <script>
        setTimeout(() => document.getElementById('remove-me')?.remove(), 500);
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const buttonRef = findRef(snapshot, /button "Remove Me"[^\n]*\[ref=(e\d+)\]/);
    await new Promise(resolve => setTimeout(resolve, 700));

    const response = await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Remove Me button', ref: buttonRef },
    });
    const parsed = parseResponse(response);
    expect(parsed.isError).toBeTruthy();
    expect(parsed.error).toContain('Custom DOM resolver diagnostics:');
    expect(parsed.error).toContain('- alias: found');
    expect(parsed.error).toContain('- locator plan: found');
    expect(parsed.error).toContain('- frame: resolved');
    expect(parsed.error).toMatch(/- candidate .*count=0/);
    expect(parsed.error).toContain('- outcome: no candidate matched any element');
  });

  test('duplicated text falls back to non-text locator strategies', async ({ client, server }) => {
    server.setContent('/', `
      <div class="card">
        <button>Open</button>
      </div>
      <div class="card">
        <button>Open</button>
      </div>
      <script>
        document.querySelectorAll('button')[1].addEventListener('click', () => document.body.dataset.dup = 'second');
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const openRef = findNthRef(snapshot, /button "Open"[^\n]*\[ref=(e\d+)\]/g, 1);

    const clickResponse = await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Second Open button', ref: openRef },
    });
    expect(parseResponse(clickResponse).isError).not.toBeTruthy();

    const evaluated = parseResponse(await client.callTool({
      name: 'browser_evaluate',
      arguments: { function: '() => document.body.dataset.dup' },
    })).result;
    expect(evaluated).toContain('second');
  });

  test('aria-poor interactive UI remains actionable', async ({ client, server }) => {
    server.setContent('/', `
      <div id="gear" title="Gear" style="width: 24px; height: 24px; cursor: pointer; background: #ccc;"></div>
      <script>
        document.getElementById('gear').addEventListener('click', () => document.body.dataset.gear = 'clicked');
      </script>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX },
    });

    const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
    const gearRef = findRef(snapshot, /"Gear"[^\n]*\[ref=(e\d+)\]/);

    await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Gear control', ref: gearRef },
    });

    const evaluated = parseResponse(await client.callTool({
      name: 'browser_evaluate',
      arguments: { function: '() => document.body.dataset.gear' },
    })).result;
    expect(evaluated).toContain('clicked');
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

async function collectRefs(client: Client): Promise<{ actionButton: string, textbox: string, combobox: string }> {
  const snapshot = snapshotText(await client.callTool({ name: 'browser_snapshot' }));
  return {
    actionButton: findRef(snapshot, /button "Action"[^\n]*\[ref=(e\d+)\]/),
    textbox: findRef(snapshot, /textbox[^\n]*\[ref=(e\d+)\]/),
    combobox: findRef(snapshot, /combobox[^\n]*\[ref=(e\d+)\]/),
  };
}
