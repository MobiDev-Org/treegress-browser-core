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
import { formatCustomDomSnapshot } from '../../packages/playwright-core/src/tools/customDomSnapshotFormatter';

import type { AICustomDomSnapshotEnvelope, AICustomDomStableId, AICustomDomTreeNode } from '../../packages/playwright-core/src/utils/isomorphic/aiSnapshotTypes';

it('should format the accessibility fixture with MCP-style enrichment', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '../../debug-pages/accessibility-test.html'), 'utf8');
  const serializerSource = fs.readFileSync(path.join(__dirname, '../../packages/injected/src/customDomSerializer.ts'), 'utf8');

  await page.setContent(html);
  await page.addScriptTag({ content: serializerSource });

  const raw = await page.evaluate(() => (window as any).serializeDOM(document.body));
  const idOrder: AICustomDomStableId[] = [];
  const seenIds = new Set<AICustomDomStableId>();
  collectStableIdOrder(raw.dom, idOrder, seenIds);

  const envelope: AICustomDomSnapshotEnvelope = {
    backend: 'custom-dom',
    version: 1,
    page: {
      url: 'about:blank',
      frameTree: {
        dom: raw.dom,
        stableIds: [...seenIds],
        idOrder,
        locatorPlans: raw.locators || {},
        frameId: 'main',
        frameSeq: 0,
        url: 'about:blank',
        name: '',
        childFrames: [],
      },
    },
  };

  const { snapshot } = formatCustomDomSnapshot(envelope);

  expect(snapshot).toContain(`- generic [ref=e10] [onclick="alert('delete clicked')"] [cursor=pointer]:`);
  expect(snapshot).toContain(`- generic [ref=e12] [onclick="alert('edit clicked')"] [cursor=pointer]:`);
  expect(snapshot).toContain(`- generic [ref=e19] [onclick="alert('add clicked')"] [cursor=pointer]:`);
  expect(snapshot).toContain(`- generic "Select..." [ref=e27] [onclick="...dropdown-list..."] [cursor=pointer]:`);
  expect(snapshot).toContain(`- generic [ref=e28] [onclick="event.stopPropagation()"] [cursor=pointer]: Item 1`);
  expect(snapshot).toContain(`- generic [ref=e29] [onclick="event.stopPropagation()"] [cursor=pointer]: Item 2`);
  expect(snapshot).toContain(`- generic [ref=e30] [onclick="event.stopPropagation()"] [cursor=pointer]: Item 3`);
  expect(snapshot).not.toContain(`- generic "Item 1" [ref=e28]`);
  expect(snapshot).toContain(`- generic [ref=e35] [onclick="this.classList.toggle('on')"] [cursor=pointer]:`);
  expect(snapshot).toMatch(/- generic "Tab 1" \[ref=e\d+\] \[onclick="alert\('tab1'\)"\] \[cursor=pointer\]/);
  expect(snapshot).toMatch(/- generic "Tab 2" \[ref=e\d+\] \[onclick="alert\('tab2'\)"\] \[cursor=pointer\]/);
  expect(snapshot).toMatch(/- generic "Tab 3" \[ref=e\d+\] \[onclick="alert\('tab3'\)"\] \[cursor=pointer\]/);
  expect(snapshot).toMatch(/- generic \[ref=e\d+\] \[onclick="alert\('settings clicked'\)"\] \[cursor=pointer\]:\n {8}- img$/m);
  expect(snapshot).toMatch(/- generic \[ref=e\d+\] \[contenteditable\]/);
  expect(snapshot).toContain(`- img [tag=svg]`);

  expect(snapshot).toMatch(/- checkbox "Enable notifications" \[ref=e\d+\]/);
  expect(snapshot).not.toMatch(/- generic "Enable notifications" \[ref=e\d+\]/);
  expect(snapshot).toMatch(/- tablist \[ref=e\d+\]:/);
  expect(snapshot).toMatch(/- tab "Tab 1" \[ref=e\d+\] \[selected\]/);
  expect(snapshot).toMatch(/- textbox "Search:" \[ref=e\d+\] \[placeholder=Search...\]/);

  expect(snapshot).not.toContain('[interactive]');
  expect(snapshot).not.toContain('[class=icon-btn]');
});

it('should prioritize visible user text over semantic class names while keeping class as an extra', async ({ page }) => {
  const serializerSource = fs.readFileSync(path.join(__dirname, '../../packages/injected/src/customDomSerializer.ts'), 'utf8');

  await page.setContent(`
    <div class="sidebar-nav-item active" onclick="navigate('/dashboard')" style="cursor:pointer;">
      Dashboard
    </div>
  `);
  await page.addScriptTag({ content: serializerSource });

  const raw = await page.evaluate(() => (window as any).serializeDOM(document.body));
  const idOrder: AICustomDomStableId[] = [];
  const seenIds = new Set<AICustomDomStableId>();
  collectStableIdOrder(raw.dom, idOrder, seenIds);

  const envelope: AICustomDomSnapshotEnvelope = {
    backend: 'custom-dom',
    version: 1,
    page: {
      url: 'about:blank',
      frameTree: {
        dom: raw.dom,
        stableIds: [...seenIds],
        idOrder,
        locatorPlans: raw.locators || {},
        frameId: 'main',
        frameSeq: 0,
        url: 'about:blank',
        name: '',
        childFrames: [],
      },
    },
  };

  const { snapshot } = formatCustomDomSnapshot(envelope);

  expect(snapshot).toMatch(/- generic "Dashboard" \[ref=e\d+\] \[class="sidebar-nav-item active"\] \[onclick="navigate\('\/dashboard'\)"\] \[cursor=pointer\]/);
  expect(snapshot).not.toContain(`- generic "sidebar-nav-item active"`);
});

it('should keep real img alt text but avoid synthetic alt fallback on v2 fixture', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '../../debug-pages/accessibility-test-v2.html'), 'utf8');
  const serializerSource = fs.readFileSync(path.join(__dirname, '../../packages/injected/src/customDomSerializer.ts'), 'utf8');

  await page.setContent(html);
  await page.addScriptTag({ content: serializerSource });

  const raw = await page.evaluate(() => (window as any).serializeDOM(document.body));
  const idOrder: AICustomDomStableId[] = [];
  const seenIds = new Set<AICustomDomStableId>();
  collectStableIdOrder(raw.dom, idOrder, seenIds);

  const envelope: AICustomDomSnapshotEnvelope = {
    backend: 'custom-dom',
    version: 1,
    page: {
      url: 'about:blank',
      frameTree: {
        dom: raw.dom,
        stableIds: [...seenIds],
        idOrder,
        locatorPlans: raw.locators || {},
        frameId: 'main',
        frameSeq: 0,
        url: 'about:blank',
        name: '',
        childFrames: [],
      },
    },
  };

  const { snapshot } = formatCustomDomSnapshot(envelope);

  expect(snapshot).toMatch(/- button "Settings" \[ref=e\d+\][\s\S]*?\n {8}- img \[alt="Settings"\]/);
  expect(snapshot).toMatch(/- generic "Open settings" \[ref=e\d+\] \[onclick="alert\('settings clicked'\)"\] \[cursor=pointer\]:\n {8}- img$/m);
  expect(snapshot).not.toMatch(/- generic "Open settings" \[ref=e\d+\][\s\S]*?\n {8}- img \[alt="Settings"\]/);
});

it('should avoid false combobox roles and map semantic landmarks on v2 fixture', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '../../debug-pages/accessibility-test-v2.html'), 'utf8');
  const serializerSource = fs.readFileSync(path.join(__dirname, '../../packages/injected/src/customDomSerializer.ts'), 'utf8');

  await page.setContent(html);
  await page.addScriptTag({ content: serializerSource });

  const raw = await page.evaluate(() => (window as any).serializeDOM(document.body));
  const idOrder: AICustomDomStableId[] = [];
  const seenIds = new Set<AICustomDomStableId>();
  collectStableIdOrder(raw.dom, idOrder, seenIds);

  const envelope: AICustomDomSnapshotEnvelope = {
    backend: 'custom-dom',
    version: 1,
    page: {
      url: 'about:blank',
      frameTree: {
        dom: raw.dom,
        stableIds: [...seenIds],
        idOrder,
        locatorPlans: raw.locators || {},
        frameId: 'main',
        frameSeq: 0,
        url: 'about:blank',
        name: '',
        childFrames: [],
      },
    },
  };

  const { snapshot } = formatCustomDomSnapshot(envelope);

  expect(snapshot).toMatch(/- generic "☰ Menu" \[ref=e\d+\] \[data-testid=main-menu-trigger\] \[class="dropdown-trigger nav-menu-btn"\] \[onclick="alert\('open menu'\)"\]/);
  expect(snapshot).not.toContain('combobox "☰ Menu"');
  expect(snapshot).toMatch(/- button "Open Menu" \[ref=e\d+\] \[onclick="var el=document.getElementById\('expandable-menu.*"\] \[expanded=false\] \[haspopup=menu\] \[controls=expandable-menu\]/);
  expect(snapshot).not.toContain('combobox "Open Menu"');

  expect(snapshot).toMatch(/^\s+- navigation:$/m);
  expect(snapshot).toMatch(/^\s+- banner:$/m);
  expect(snapshot).toMatch(/^\s+- main:$/m);
  expect(snapshot).toMatch(/^\s+- complementary:$/m);
  expect(snapshot).toMatch(/^\s+- article:$/m);
  expect(snapshot).toMatch(/^\s+- contentinfo:$/m);
});

it('should surface high-signal class/data hints and form action/method through the production snapshot path', async ({ page }) => {
  const target = pathToFileURL(path.join(__dirname, '../../debug-pages/accessibility-test-v2.html')).href;

  await page.goto(target, { waitUntil: 'load' });

  const snapshot = await (page as any)._snapshotForAI({ backend: 'custom-dom' });
  const envelope: AICustomDomSnapshotEnvelope = snapshot.envelope;
  const formatted = formatCustomDomSnapshot(envelope).snapshot;

  expect(formatted).not.toContain('[listens=');
  expect(formatted).toMatch(/- form \[action="\/api\/register"\] \[method=post\]:/);
  expect(formatted).toMatch(/- button "Cancel" \[ref=e\d+\] \[data-testid=cancel-btn\] \[data-test=cancel-order\] \[data-cy=cancel-action\]/);
  expect(formatted).toMatch(/- generic "Active" \[ref=e\d+\] \[data-testid=status-badge\] \[data-action=toggle-status\] \[data-state=active\] \[onclick="alert\('toggle status'\)"\] \[cursor=pointer\]/);
  expect(formatted).toMatch(/- generic \[ref=e\d+\] \[class=toggle-switch\] \[onclick="this.classList.toggle\('on'\)"\] \[cursor=pointer\]:/);
});

function collectStableIdOrder(node: unknown, idOrder: AICustomDomStableId[], seen: Set<AICustomDomStableId>) {
  if (!node || typeof node !== 'object')
    return;
  const maybeNode = node as AICustomDomTreeNode;
  if (typeof maybeNode.id === 'string' && !seen.has(maybeNode.id)) {
    seen.add(maybeNode.id);
    idOrder.push(maybeNode.id);
  }
  if (!Array.isArray(maybeNode.children))
    return;
  for (const child of maybeNode.children)
    collectStableIdOrder(child, idOrder, seen);
}
