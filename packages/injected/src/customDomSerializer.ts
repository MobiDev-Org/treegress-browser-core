// @ts-nocheck
/**
 * Advanced DOM Serializer with Self-Healing Locators for Playwright
 */

// Expose functions on window for debugging when running in-browser.
if (typeof window !== 'undefined') {
  // Expose all necessary functions to the window object for on-demand usage from content scripts.
  window.serializeDOM = serializeDOM;
  window.getFlexibleLocators = getFlexibleLocators;
  window.getAssignedRole = getAssignedRole;
  window.getAccessibleName = getAccessibleName;
  window.getDirectText = getDirectText;
}

let locatorsMapping;
let uniqueIdCounter;
let hoverSelectorCache;

/*****************************************************************
* High-fidelity element visibility check
*****************************************************************/
let _visCache = new WeakMap();

/** Public wrapper with memoisation */
function isVisible(element, opts = {}) {
  // if (_visCache.has(element)) return _visCache.get(element); **4
  // const res = _isVisibleCore(element, opts);
  // _visCache.set(element, res);
  // return res;
  const key = JSON.stringify({
      p: !!opts.checkPseudos, o: !!opts.checkOcclusion, e: +opts.opacityEpsilon || 0.05
  });
  let m = _visCache.get(element);
  if (m && m.has(key)) return m.get(key);
  const res = _isVisibleCore(element, opts);
  if (!m) {
      m = new Map();
      _visCache.set(element, m);
  }
  m.set(key, res);
  return res;
}

/**
* @param {Element} element
* @param {{checkPseudos?:boolean, checkOcclusion?:boolean, opacityEpsilon?:number}} opts
*/
function _isVisibleCore(element, {
  checkPseudos   = false,
  checkOcclusion = false,
  opacityEpsilon = 0.05
} = {}) {

  if (element === document.body || element === document.documentElement) {
      opacityEpsilon = 0;        // корень считаем видимым, даже если полупрозрачный
  }

  /* ---------- 0. sanity ---------- */
  if (!(element instanceof Element)) return false;

  /* ---------- 1. native ---------- */
  if (typeof element.checkVisibility === 'function') {
      if (!element.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}))
          return false;                       // браузер решает «невидим»
  }

  // /* ---------- 1. native ---------- */
  // if (typeof element.checkVisibility === 'function') {
  //     if (!element.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}))
  //         return false;                       // браузер решает «невидим»
  // }

  /* ---------- 2. ancestor chain ---------- */
  for (let e = element; e; e = e.parentElement) {
      const cs = getComputedStyle(e);

      if (cs.display === 'none' ||
          cs.getPropertyValue('content-visibility') === 'hidden' ||
          (e.tagName === 'DETAILS' && !e.open))                       // закрытый <details>
          return false;

      // opacity наследуется «умножением»
      if (parseFloat(cs.opacity) <= opacityEpsilon) return false;

      // visibility:hidden подавляет потомков, кроме тех, кто переопределил visible
      // if (e === element && **4
      //     (cs.visibility === 'hidden' || cs.visibility === 'collapse'))
      //     return false;
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  }

  /* ---------- 3. geometry ---------- */
  let rect = element.getBoundingClientRect();

  // content-visibility:auto может вернуть 0×0; пробуем fallback **2
  if (rect.width === 0 && rect.height === 0 &&
      getComputedStyle(element).getPropertyValue('content-visibility') === 'auto') {
      // пробуем первый клиентский прямоугольник (он в viewport-координатах)
      const cr = element.getClientRects?.();
      if (cr && cr.length) rect = cr[0];
      // иначе — не делаем геометрических выводов (см. п.1B) или считаем "потенциально видимым"
  }

  const vpW = window.innerWidth  || document.documentElement.clientWidth;
  const vpH = window.innerHeight || document.documentElement.clientHeight;
  // if (rect.right <= 0 || rect.bottom <= 0){ // || rect.left >= vpW || rect.top >= vpH **1
  //     return false;                                   // полностью за пределами окна
  // }

  /* ---------- 4. overflow-clipping (Cypress rules) ---------- */
  if (_isClippedByOverflow(element, rect)) return false;

  /* ---------- 5. clip/clip-path/filter-opacity ---------- */
  const csSelf = getComputedStyle(element);

  if (csSelf.clip && csSelf.clip !== 'auto' && /rect\(0.+0.+0.+0\)/.test(csSelf.clip))
      return false;

  const cp = csSelf.clipPath;
  if (cp && cp !== 'none' && /(?:circle|ellipse)\s*\(\s*0(?:px|%)?\s*\)|inset\s*\(\s*100%\s*\)/.test(cp)) return false;

  const filter = csSelf.filter || csSelf.webkitFilter;
  if (filter && /opacity\(0(?:%|)\)/.test(filter))
      return false;

  /* ---------- 6. pseudos ---------- */
  if (rect.width === 0 && rect.height === 0) {
      if (checkPseudos) {
          if (!_hasVisiblePseudo(element, opacityEpsilon)) return false;
      } else {
          return false;
      }
  }

  /* ---------- 7. occlusion (optional) ---------- */
  if (checkOcclusion && _isFullyOccluded(element, rect)) return false;

  return true;
}

/* ---- helpers -------------------------------------------------------------- */

function _isClippedByOverflow(el, elRect) {
  const isFixed = getComputedStyle(el).position === 'fixed';
  if (isFixed) return false; // fixed не клипится overflow-ом предков

  const isScrollableOnAxis = (node, axis) => {
      const cs = getComputedStyle(node);
      const ov = axis === 'x' ? cs.overflowX : cs.overflowY;
      // прокручиваемым считаем только auto | scroll и реально есть что скроллить
      if (!['auto', 'scroll'].includes(ov)) return false;
      return axis === 'x'
          ? node.scrollWidth > node.clientWidth
          : node.scrollHeight > node.clientHeight;
  };

  // Есть ли между el и ancestor прокручиваемый контейнер по нужной оси
  const hasScrollableBetween = (ancestor, axis) => {
      for (let n = el.parentElement; n && n !== ancestor; n = n.parentElement) {
          if (isScrollableOnAxis(n, axis)) return true;
      }
      return false;
  };

  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ps = getComputedStyle(p);
      const clipX = ps.overflowX === 'hidden' || ps.overflowX === 'clip';
      const clipY = ps.overflowY === 'hidden' || ps.overflowY === 'clip';

      if (!clipX && !clipY) continue;

      const pr = p.getBoundingClientRect();

      // полностью вне видимой области предка по оси X/Y?
      const outsideX = (elRect.right <= pr.left) || (elRect.left >= pr.right);
      const outsideY = (elRect.bottom <= pr.top) || (elRect.top >= pr.bottom);

      // считаем "скрыт" ТОЛЬКО если нет внутреннего скролла, который мог бы привезти элемент в видимую область
      if (clipX && outsideX && !hasScrollableBetween(p, 'x')) return true;
      if (clipY && outsideY && !hasScrollableBetween(p, 'y')) return true;
  }
  return false;
}

function _isFullyOccluded(el, r) {
  const pts = [
      [r.left + 1, r.top + 1],
      [r.right - 1, r.top + 1],
      [r.right - 1, r.bottom - 1],
      [r.left + 1, r.bottom - 1],
      [r.left + r.width / 2, r.top + r.height / 2]
  ];
  const vpW = window.innerWidth, vpH = window.innerHeight;
  let hiddenPts = 0;

  for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > vpW || y > vpH) { hiddenPts++; continue; }
      const top = document.elementFromPoint(x, y);
      if (top && (top === el || el.contains(top))) return false;   // «пробой» найден
      hiddenPts++;
  }
  return hiddenPts === pts.length;
}

function _hasVisiblePseudo(el, eps) {
  const chk = p => {
      const s = getComputedStyle(el, p);
      if (s.display === 'none') return false;
      if (!s.content || s.content === 'none' || /^['"]{2}$/.test(s.content)) return false;
      if (s.visibility === 'hidden') return false;
      if (parseFloat(s.opacity) <= eps) return false;

      // ширина/высота могут быть 'auto' — тогда parseFloat → NaN
      const w = parseFloat(s.width), h = parseFloat(s.height);
      const hasBox = Number.isFinite(w) && Number.isFinite(h) ? (w || h) : true;
      return hasBox;
  };
  return chk('::before') || chk('::after');
}

/* -------------------------------------------------------------------------- */


const INTERACTIVE_ELEMENT_TAG = 'data-interactive-id-a9b1c8';
const INTERACTIVE_SCORE_TAG = 'data-interactive-score-a9b1c8';
const IGNORE_INTERACTIVE_TAG = 'data-ignore-interactive-a9b1c8';

// prettier-ignore
const EXCLUDED_TAGS = new Set(['script', 'style', 'meta', 'link', 'noscript', 'object', 'embed', 'base', 'param', 'template', 'path']);
// prettier-ignore
const NATIVE_INTERACTIVE_TAGS = new Set(['input', 'textarea', 'select', 'button', 'a', 'summary', 'audio', 'video', 'iframe']);

/**
* Traverses every element in a DOM tree, including those inside Shadow Roots.
* This is a non-recursive, stack-based traversal to avoid call stack limits.
* @param {Element} root The starting element.
* @param {(el: Element) => void} callback The function to call for each element.
*/
function eachElementDeep(root, callback) {
  if (!root) return;
  const stack = [root];
  while (stack.length > 0) {
      const element = stack.pop(); // LIFO
      if (!(element instanceof Element)) continue;

      callback(element);

      // To process in document order (pre-order), push children in reverse
      // 1. Light DOM children first
      for (let i = element.children.length - 1; i >= 0; i--) {
          stack.push(element.children[i]);
      }
      // 2. Then Shadow DOM children
      if (element.shadowRoot) {
          const shadowChildren = element.shadowRoot.children;
          for (let i = shadowChildren.length - 1; i >= 0; i--) {
              stack.push(shadowChildren[i]);
          }
      }
  }
}


/******************************************************************************
*       ULTIMATE INTERACTIVE ELEMENT DETECTOR (v5.15)
******************************************************************************/

// prettier-ignore
const INTERACTIVE_WIDGET_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch',
  'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'slider', 'spinbutton', 'textbox', 'combobox', 'option'
]);

// Default extra interactive selectors for popular UI frameworks.
// These are used as "fallback" interactive candidates (score 9) if semantic roles are missing.
const DEFAULT_EXTRA_INTERACTIVE_SELECTORS = [
  // --- Ant Design (React) ---
  'button.ant-btn',
  'a.ant-btn',
  'ul.ant-dropdown-menu li.ant-dropdown-menu-item',
  'li.ant-menu-item',
  '.ant-pagination-item a',
  '.ant-pagination-item-link',
  '.ant-select-item-option',
  '.ant-tree-node-content-wrapper',
  '.ant-tabs-tab',
  'label.ant-radio-wrapper',
  'label.ant-checkbox-wrapper',
  '.ant-switch',
  '.ant-slider-handle',
  '.ant-segmented-item',

  // --- Material UI / MUI ---
  '.MuiButton-root',
  '.MuiIconButton-root',
  '.MuiMenuItem-root',
  '.MuiListItemButton-root',
  '.MuiTab-root',
  '.MuiPaginationItem-root',
  '.MuiChip-clickable',
  '.MuiSlider-thumb',
  '.MuiSwitch-switchBase',
  '.MuiCheckbox-root',
  '.MuiRadio-root',
  '.MuiListItem-root.MuiButtonBase-root',

  // --- Bootstrap 4/5 ---
  'button.btn',
  'a.btn',
  '.dropdown-item',
  '.page-link',
  '.list-group-item-action',
  '.nav-link',

  // --- Prime* (PrimeReact / PrimeNG / PrimeVue) ---
  '.p-button',
  '.p-menuitem-link',
  '.p-tabmenuitem',
  '.p-tabview-nav-link',
  '.p-selectable-row',
  '.p-checkbox-box',
  '.p-radiobutton-box',
  '.p-togglebutton',
  '.p-slider-handle',

  // --- Semantic UI ---
  '.ui.button',
  '.ui.menu .item',
  '.ui.pagination.menu .item',
  '.ui.dropdown .menu .item',

  // --- Chakra UI ---
  '.chakra-button',
  '.chakra-link',
  '.chakra-menu__menuitem',
  '.chakra-tabs__tab',
  '.chakra-slider__thumb',
  '.chakra-switch__thumb',
];

const DECLARATIVE_ATTR_PREFIXES = ['hx-', 'x-on:', '@', 'up-', 'on:', 'client:'];
// prettier-ignore
const KEY_EVENT_LISTENERS = new Set(['click', 'mousedown', 'keydown', 'keyup', 'change', 'submit', 'dblclick', 'pointerdown', 'pointerup', 'touchstart']);

/**
* Helper to safely traverse up the DOM, crossing Shadow DOM boundaries.
* @param {Node} el The starting element.
* @returns {Element | null} The parent element or the shadow host.
*/
function parentOrHost(el) {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function unifyCompositeControls(root) {
  eachElementDeep(root, el => {
      // Case 1: Readonly/disabled inputs in composite controls that are part of a larger widget
      if (el.matches('input[readonly][tabindex]:not([tabindex="-1"]), input[disabled][tabindex]:not([tabindex="-1"])')) {
          try {
              if (el.getBoundingClientRect().width > 2) return;
              const componentWrapper = el.closest('[role="combobox"], .react-select__control, .MuiInputBase-root');
              if (componentWrapper) {
                  componentWrapper.setAttribute('data-unified-component', 'true');
                  componentWrapper.setAttribute(INTERACTIVE_ELEMENT_TAG, 'true');
                  componentWrapper.setAttribute(INTERACTIVE_SCORE_TAG, '9');
                  el.setAttribute(IGNORE_INTERACTIVE_TAG, 'true');
              }
          } catch (e) {}
      }

      // Case 2: Inputs directly wrapped by their labels
      if (el.tagName.toLowerCase() === 'label') {
          const input = el.querySelector(':scope > input, :scope > select, :scope > textarea');
          if (input) {
              el.setAttribute('data-unified-component', 'true');
              input.setAttribute(IGNORE_INTERACTIVE_TAG, 'true');

              el.setAttribute(INTERACTIVE_ELEMENT_TAG, 'true');
              const type = (input.type || '').toLowerCase();
              const score = (type === 'checkbox' || type === 'radio') ? '10' : '9';
              el.setAttribute(INTERACTIVE_SCORE_TAG, score);
          }
      }
  });
}


/**
* Unifies labels with their external controls via the `for` attribute.
* If a label points to an interactive element, the label is marked as the
* primary interactive component, and the control is ignored.
* @param {Document | Element} root The root element to search within.
*/
function unifyLabelForControls(root) {
  eachElementDeep(root, element => {
      if (element.tagName.toLowerCase() !== 'label' || !element.hasAttribute('for')) {
          return;
      }
      const label = element;
      try {
          const id = label.getAttribute('for');
          if (!id) return;

          const rootNode = label.getRootNode();
          const ctl = rootNode.getElementById ? rootNode.getElementById(id) : document.getElementById(id);
          if (!ctl) return;

          const tag = (ctl.tagName || '').toLowerCase();
          const role = getAssignedRole(ctl);

          const isNative = NATIVE_INTERACTIVE_TAGS.has(tag) && !(tag === 'input' && ctl.type === 'hidden');
          const isRole = INTERACTIVE_WIDGET_ROLES.has(role);

          if (isNative || isRole) {
              label.setAttribute('data-unified-component', 'true');
              label.setAttribute(INTERACTIVE_ELEMENT_TAG, 'true');

              const ctlTag = ctl.tagName.toLowerCase();
              const ctlType = (ctl.getAttribute('type') || '').toLowerCase();
              const isToggle = ctlTag === 'input' && ['checkbox', 'radio'].includes(ctlType);

              // If it's a toggle, the label is the primary element with the highest score.
              // For other inputs, the label is a helpful but secondary target (score 6).
              label.setAttribute(INTERACTIVE_SCORE_TAG, isToggle ? '10' : '6');

              // Only ignore the control itself if it's a toggle. For text inputs, textareas,
              // selects, etc., the control itself MUST remain interactive for typing/selection.
              if (isToggle) {
                  ctl.setAttribute(IGNORE_INTERACTIVE_TAG, 'true');
              }
          }
      } catch (e) {
          // Ignore errors, e.g., from complex selectors or detached elements
      }
  });
}



/**
* Marks a container as interactive if (a) it has either a pointer or a tabindex itself,
* and (b) the missing attribute is found within its subtree,
* provided that the subtree does not already contain any interactive elements.
* This uses a bottom-up O(N) algorithm.
*/
function unifyPointerTabindexCombosSafe(root) {
  // Using file-level constants
  const INTERACTIVE_ATTR = INTERACTIVE_ELEMENT_TAG;
  const SCORE_ATTR = INTERACTIVE_SCORE_TAG;

  /** @type {WeakMap<Node, {ptr: boolean, tab: boolean, hasInt: boolean}>} */
  const flags = new WeakMap();

  // Helper to safely check for a 'pointer' cursor and visibility
  const hasPointer = el => {
      if (!(el instanceof HTMLElement)) return false;
      try {
          const cs = window.getComputedStyle(el);
          // Element must be visible, interactive, and not within an inert container
          return cs.cursor.includes('pointer') &&
              cs.display !== 'none' &&
              cs.visibility !== 'hidden' &&
              parseFloat(cs.opacity) > 0 &&
              cs.pointerEvents !== 'none' &&
              !el.closest('[inert]');
      } catch {
          return false; // Catches security errors from cross-origin iframes etc.
      }
  };

  // Helper to safely check for a tabbable index
  const hasTab = el => (el instanceof HTMLElement) && el.tabIndex >= 0;

  // Iterative post-order traversal that includes Shadow DOM
  const traversalStack = [root];
  const postOrderStack = [];
  while (traversalStack.length) {
      const node = traversalStack.pop();
      postOrderStack.push(node);
      // Add children (light and shadow) to be processed
      if (node instanceof Element) {
          // Note: Pushing in normal order, so they get popped in reverse for post-order processing
          for (const child of node.children) traversalStack.push(child);
          if (node.shadowRoot) {
              for (const child of node.shadowRoot.children) traversalStack.push(child);
          }
      }
  }

  while (postOrderStack.length) {
      const node = postOrderStack.pop();

      if (!(node instanceof HTMLElement)) {
          // Set default flags for non-element nodes
          flags.set(node, {ptr: false, tab: false, hasInt: false});
          continue;
      }

      // 1. Check attributes for the node itself
      const selfPtr = hasPointer(node);
      const selfTab = hasTab(node);
      const selfInt = node.hasAttribute(INTERACTIVE_ATTR);

      // 2. Aggregate flags from children nodes
      let ptrBelow = false;
      let tabBelow = false;
      let intBelow = false;
      const children = [...(node.children || []), ...(node.shadowRoot ? node.shadowRoot.children : [])];
      for (const ch of children) {
          const f = flags.get(ch);
          if (!f) continue;
          ptrBelow ||= f.ptr;
          tabBelow ||= f.tab;
          intBelow ||= f.hasInt;
      }

      // 3. Determine if the current node should be marked interactive
      // Main condition:
      // - Node has (pointer AND NOT tab AND tab is below) OR (tab AND NOT pointer AND pointer is below)
      // - Node itself is not already marked interactive
      // - No descendant is already marked interactive
      const shouldMark = ((selfPtr && !selfTab && tabBelow) || (selfTab && !selfPtr && ptrBelow)) && !selfInt && !intBelow;

      let isNowInteractive = selfInt;
      if (shouldMark) {
          node.setAttribute(INTERACTIVE_ATTR, 'true');
          node.setAttribute(SCORE_ATTR, '7'); // Use the same base score as masterScoreFunction for this combo
          isNowInteractive = true;
      }

      // 4. Set the flags for this node's entire subtree for its parent to use
      flags.set(node, {
          ptr: selfPtr || ptrBelow,
          tab: selfTab || tabBelow,
          hasInt: isNowInteractive || intBelow // Propagate up if self is/was interactive OR a child was
      });
  }
}

function isLikelyRootContainer(element) {
  if (!['div', 'main', 'header', 'footer'].includes(element.tagName.toLowerCase())) return false;
  try {
      const rect = element.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.90 && rect.height >= window.innerHeight * 0.90;
  } catch (e) {
      return false;
  }
}

function hasVisualSubstance(element, style) {
  if (element.textContent.trim().length > 0) return true;
  if (element.querySelector('img, svg, i, video, canvas, picture')) return true;
  if (style.backgroundImage && style.backgroundImage !== 'none') return true;
  if (style.borderWidth && parseFloat(style.borderWidth) > 0) return true;
  const bgColor = style.backgroundColor;
  if (bgColor && bgColor !== 'transparent' && !bgColor.startsWith('rgba(0, 0, 0, 0')) {
      const alpha = bgColor.match(/, ([\d.]+)\)/);
      return !(alpha && parseFloat(alpha[1]) === 0);
  }
  return false;
}

function hasOnlyIconChildren(element) {
  if (element.textContent.trim() !== '') return false;
  const children = Array.from(element.children);
  if (children.length === 0) return false;
  return children.every(c => ['img', 'svg', 'i', 'span', 'picture'].includes(c.tagName.toLowerCase()));
}

function hasVisiblePseudoElement(element) {
  if (!element) return false;
  try {
      const beforeStyle = window.getComputedStyle(element, '::before');
      const afterStyle = window.getComputedStyle(element, '::after');
      const hasVisibleContent = (style) => style.display !== 'none' && style.content && style.content !== 'none' && style.content !== '""' && style.content !== "''";
      return hasVisibleContent(beforeStyle) || hasVisibleContent(afterStyle);
  } catch (e) {
      return false;
  }
}

function elementHasHover(element, hoverCache) {
  if (!element?.matches || !hoverCache?.length) return false;
  for (const sel of hoverCache) {
      try { if (element.matches(sel)) return true; } catch {}
  }
  return false;
}

function masterScoreFunction(element) {
  if (element.hasAttribute(IGNORE_INTERACTIVE_TAG)) return 0;
  let style;
  try {
      if (element.closest('[inert]')) return 0;
      style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return 0;
      const roleForCheck = getAssignedRole(element); // Get role once for reuse
      if (style.pointerEvents === 'none') {
          // Allow elements with a button role to be considered, even if pointer-events is none (e.g., for a disabled state).
          if (roleForCheck !== 'button') return 0;
      }
  } catch (e) {
      return 0;
  }

  const hasTabindex      = element.hasAttribute('tabindex')
      && +element.getAttribute('tabindex') >= 0;
  const hasHoverRule     = elementHasHover(element, hoverSelectorCache);
  const tabindexAndHover = hasTabindex && hasHoverRule;

  const tag = element.tagName.toLowerCase();
  if (['html', 'body'].includes(tag)) return 0;

  const role = getAssignedRole(element);
  if (INTERACTIVE_WIDGET_ROLES.has(role)) return 10;
  if (element.isContentEditable) return 10;
  if (tag === 'input' && element.type !== 'hidden') return 10;
  if (['textarea', 'select', 'button', 'summary'].includes(tag)) return 10;
  if (tag === 'a' && element.hasAttribute('href')) return 10;
  if ((tag === 'audio' || tag === 'video') && element.hasAttribute('controls')) return 10;
  if (tag === 'iframe' && element.src && (element.src.includes('google.com/accounts') || element.src.includes('apple.com'))) return 10;

  try {
      if (element.getAttribute('aria-controls') && document.getElementById(element.getAttribute('aria-controls'))) return 9;
  } catch (e) {
  }

  for (const attr of element.attributes) {
      if (DECLARATIVE_ATTR_PREFIXES.some(p => attr.name.startsWith(p))) return 9;
  }
  if (tag === 'a' && ([...element.attributes].some(attr => attr.name.startsWith('data-')) || window.__eventTypes?.get(element)?.has('click'))) return 9;

  const hasDirectText = element.textContent.trim() !== '' && Array.from(element.childNodes).some(cn => cn.nodeType === Node.TEXT_NODE);
  if ((tag === 'div' || tag === 'span') && style.cursor === 'pointer' && (hasOnlyIconChildren(element) || hasDirectText)) return 8;
  if ((tag === 'i' || tag === 'svg') && style.cursor === 'pointer') return 8;

  let score = 0;
  const eventListeners = window.__eventTypes?.get(element);
  if (eventListeners && [...eventListeners].some(e => KEY_EVENT_LISTENERS.has(e))) score = 7;
  // New: Check for inline 'on...' event handlers as a fallback.
  const hasInlineHandler = Array.from(element.attributes).some(a => {
      return a.name.startsWith('on') && KEY_EVENT_LISTENERS.has(a.name.slice(2));
  });
  if (!score && hasInlineHandler) score = 7;
  if (!score && element.hasAttribute('tabindex') && parseInt(element.getAttribute('tabindex'), 10) >= 0) score = 7;

  if (score > 0) {
      if (isLikelyRootContainer(element) && style.cursor !== 'pointer' && !tabindexAndHover) return 0;
      if (!hasVisualSubstance(element, style) && !hasVisiblePseudoElement(element) && style.cursor !== 'pointer' && !tabindexAndHover) return 0;
      if (style.cursor === 'pointer') score = 8;
      else if (tabindexAndHover) score = Math.max(score, 7);
  }

  if (!score && tabindexAndHover) score = 7;
  if (score === 0 && elementHasHoverAndPointer(element, style, hoverSelectorCache)) score = 7;
  if (score === 0 && style.cursor === 'pointer') score = 6;
  if (score === 0 && tag === 'label' && element.control) score = 3;

  if (score > 0) {
      try {
          const rect = element.getBoundingClientRect();
          if ((rect.width < 8 && rect.height < 8) && (style.overflow === 'hidden' && !hasVisualSubstance(element, style) && !hasVisiblePseudoElement(element))) {
              return 0;
          }
      } catch (e) {
      }
  }

  return score;
}

function annotateAndBubbleUp(root) {
  const scoredElements = new Map();
  // Traverse all elements, including those in Shadow DOM, to calculate initial scores.
  eachElementDeep(root, element => {
      const hasInteractiveTag = element.hasAttribute(INTERACTIVE_ELEMENT_TAG);
      const scoreAttr = element.getAttribute(INTERACTIVE_SCORE_TAG);

      // 1) Hardcoded score (from unifyCompositeControls / label-for etc.) — use as is.
      if (scoreAttr != null && scoreAttr !== '') {
          const parsed = parseInt(scoreAttr, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
              scoredElements.set(element, parsed);
          }
          return; // 'continue'
      }

      // 2) Standard heuristics via styles/roles/attributes.
      const score = masterScoreFunction(element);
      if (score > 0) {
          scoredElements.set(element, score);
          return;
      }

      // 3) Fallback: element explicitly marked as interactive (markExtraInteractive),
      //    but masterScoreFunction didn't find reasons to give it points (no roles, events etc.).
      if (hasInteractiveTag) {
          scoredElements.set(element, 9);
      }
  });

  const finalWinners = new Map();
  for (const [element, score] of scoredElements.entries()) {
      if (element.hasAttribute('data-unified-component') || NATIVE_INTERACTIVE_TAGS.has(element.tagName.toLowerCase())) {
          if (score > (finalWinners.get(element) || 0)) finalWinners.set(element, score);
          continue;
      }
      let bestCandidate = {element, score};
      let ancestor = parentOrHost(element); // Use helper for Shadow DOM traversal
      while (ancestor) {
          if (scoredElements.has(ancestor) && scoredElements.get(ancestor) >= bestCandidate.score) {
              bestCandidate = {element: ancestor, score: scoredElements.get(ancestor)};
          }
          ancestor = parentOrHost(ancestor);
      }
      if (bestCandidate.score > (finalWinners.get(bestCandidate.element) || 0)) {
          finalWinners.set(bestCandidate.element, bestCandidate.score);
      }
  }
  for (const [element, score] of finalWinners.entries()) {
      element.setAttribute(INTERACTIVE_ELEMENT_TAG, 'true');
      element.setAttribute(INTERACTIVE_SCORE_TAG, score);
  }
}

function pruneRedundantWrappers(root) {
  const candidates = [];
  eachElementDeep(root, el => {
      if (el.hasAttribute(INTERACTIVE_ELEMENT_TAG)) {
          candidates.push(el);
      }
  });

  const toUnmark = new Set();
  candidates.forEach(child => {
      if (toUnmark.has(child)) return;
      let parent = parentOrHost(child); // Use helper for Shadow DOM traversal
      while (parent && parent !== root) {
          if (parent.hasAttribute(INTERACTIVE_ELEMENT_TAG) && !toUnmark.has(parent)) {
              try {
                  const childTag = child.tagName.toLowerCase();
                  const parentTag = parent.tagName.toLowerCase();
                  const parentStyle = window.getComputedStyle(parent);
                  const isChildNative = NATIVE_INTERACTIVE_TAGS.has(childTag);
                  const isParentNative = NATIVE_INTERACTIVE_TAGS.has(parentTag);
                  const childRole = getAssignedRole(child);

                  // A label wrapping a toggle control is a primary interactive element.
                  const isChildLabelToggle = childTag === 'label' && (child.querySelector('input[type=checkbox], input[type=radio]'));

                  if (isChildNative && !isParentNative) {
                      toUnmark.add(parent);
                      parent = parentOrHost(parent);
                      continue;
                  } else if (isChildLabelToggle && !isParentNative) {
                      // The label already contains the logical control, so the parent wrapper is redundant.
                      toUnmark.add(parent);
                      parent = parentOrHost(parent);
                      continue;
                  }

                  const parentRole = getAssignedRole(parent);
                  // An element with a widget role is considered to have substance by definition.
                  // Don't prune a wrapper if it OR its direct interactive child are fundamental widgets.
                  if (!INTERACTIVE_WIDGET_ROLES.has(parentRole) &&
                      !INTERACTIVE_WIDGET_ROLES.has(childRole) &&
                      !hasVisualSubstance(parent, parentStyle) &&
                      !hasVisiblePseudoElement(parent))
                  {
                      toUnmark.add(parent);
                      parent = parentOrHost(parent);
                      continue;
                  }
              } catch (e) {
              }
              break;
          }
          parent = parentOrHost(parent);
      }
  });
  toUnmark.forEach(el => {
      el.removeAttribute(INTERACTIVE_ELEMENT_TAG);
      el.removeAttribute(INTERACTIVE_SCORE_TAG);
  });
}

/**
* Marks elements matching extraInteractiveSelectors as interactive candidates
* (if they are not already marked).
*/
function markExtraInteractive(root, extraSelectors) {
  if (!root || !root.querySelectorAll) return;
  if (!Array.isArray(extraSelectors) || extraSelectors.length === 0) return;

  const merged = extraSelectors
      .filter(sel => typeof sel === 'string' && sel.trim())
      .join(',');
  if (!merged) return;

  let elements;
  try {
      elements = root.querySelectorAll(merged);
  } catch (e) {
      console.warn('markExtraInteractive: invalid selectors', e);
      return;
  }

  elements.forEach(el => {
      // Mark as "candidate" for interactivity, but without explicit score.
      // Actual score will be set by annotateAndBubbleUp / masterScoreFunction.
      if (!el.hasAttribute(INTERACTIVE_ELEMENT_TAG)) {
          el.setAttribute(INTERACTIVE_ELEMENT_TAG, 'true');
      }
      // SCORE_TAG is deliberately NOT touched here - so as not to override logic via ARIA/native elements.
  });
}


function setInteractiveElements(root, options = {}) {
  // 0. Reset attributes deeply
  const attrsToReset = [INTERACTIVE_ELEMENT_TAG, INTERACTIVE_SCORE_TAG, IGNORE_INTERACTIVE_TAG, 'data-unified-component'];
  attrsToReset.forEach(attr => {
      eachElementDeep(root, el => {
          if (el.hasAttribute(attr)) el.removeAttribute(attr);
      });
  });

  // 0.5. Manual/default interactivity selectors
  if (options.extraInteractiveSelectors && options.extraInteractiveSelectors.length) {
      markExtraInteractive(root, options.extraInteractiveSelectors);
  }

  // 1. Unify composite controls in a specific order
  unifyCompositeControls(root);
  unifyLabelForControls(root); // New step for `label[for]`
  unifyPointerTabindexCombosSafe(root);

  // 2. Score, bubble up, and prune
  annotateAndBubbleUp(root);
  pruneRedundantWrappers(root);
}


function getNativeError(el) {
  if (!el || typeof el.willValidate !== 'boolean' || !el.willValidate) return null;
  if (el.checkValidity()) return null;

  const msg = el.validationMessage?.trim();
  if (msg) return msg;

  // Fallback to validity flags if validationMessage is not available
  const v = el.validity;
  if (!v) return null;
  if (v.valueMissing)   return 'Fill this field';
  if (v.typeMismatch)   return 'Wrong type';
  if (v.patternMismatch)return 'Not matching the pattern';
  if (v.tooShort)       return 'Too short';
  if (v.tooLong)        return 'Too long';
  if (v.rangeUnderflow) return 'Too small value';
  if (v.rangeOverflow)  return 'Too big value';
  if (v.stepMismatch)   return 'Not matching the step';
  if (v.badInput)       return 'Invalid input';
  return null;
}

/******************************************************************************
*                  SERIALIZATION AND HELPER FUNCTIONS
******************************************************************************/

function serializeNode(node, options, parentVisible = true) {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  if (EXCLUDED_TAGS.has(tag) || node.hasAttribute('data-ignore-serialization')) return null;

  let style = {}, rect = {x: 0, y: 0, width: 0, height: 0};
  try {
      style = window.getComputedStyle(node);
      rect = node.getBoundingClientRect();
  } catch (e) {
  }

  const visible = isVisible(node, {
      checkPseudos: true,
      checkOcclusion: false
  });

  const serializedObj = {
      tag,
      isVisible: visible,
      attributes: {},
      box: {
          x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height)
      },
      computedStyle: {display: style.display || '', visibility: style.visibility || '', opacity: style.opacity || '', cursor: style.cursor || ''}
  };

  // check if the element is a native interactive element, and it has a native error message
  if (tag === 'input') {
      const nativeError = getNativeError(node);
      if (nativeError) {
          serializedObj.error = nativeError;
      }
  }

  for (const attr of node.attributes) {
      serializedObj.attributes[attr.name] = attr.value;
  }

  const isInteractive = node.hasAttribute(INTERACTIVE_ELEMENT_TAG);
  if (isInteractive) {
      serializedObj.isInteractive = true;
      serializedObj.role = getAssignedRole(node);
      serializedObj.accessibleName = getAccessibleName(node); // TODO rename to text?
      serializedObj.isDisabled = node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';
      serializedObj.isFocused = (document.activeElement === node);
      if (tag === 'input') serializedObj.isChecked = node.checked; else if (node.hasAttribute('aria-checked')) serializedObj.isChecked = node.getAttribute('aria-checked') === 'true';
  } else {
      const directText = getDirectText(node);
      if (directText) serializedObj.text = directText;
  }

  if (tag === 'option') serializedObj.isSelected = node.selected; else if (node.hasAttribute('aria-selected')) serializedObj.isSelected = node.getAttribute('aria-selected') === 'true';

  if (serializedObj.isInteractive && isTopInteractiveElement(node)) {
      serializedObj.onTop = true;
  }

  // REFACTORED: Locator generation is now a separate function but used here for consistency.
  const richLocators = getFlexibleLocators(node, { forceUnique: true });
  // Use the guaranteed unique CSS selector for hashing to ensure a stable ID
  const cssStrategy = richLocators.getByCss;
  const uniqueSelectorForId = cssStrategy ? cssStrategy.css : (node.outerHTML + (uniqueIdCounter++));
  const currentId = cssHash(uniqueSelectorForId);
  serializedObj.id = currentId;
  locatorsMapping[currentId] = richLocators; // Store the full rich locators object

  const hasNoSize = rect.width === 0 && rect.height === 0;
  const canClipContent = style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden';
  const shouldPrune = hasNoSize && canClipContent && !isInteractive && !tag.includes('-');

  if (shouldPrune) {
      serializedObj.lazyLoad = true;
  } else {
      const children = [];
      const childNodes = [...node.childNodes, ...(node.shadowRoot ? node.shadowRoot.childNodes : [])];
      for (const child of childNodes) {
          const serializedChild = serializeNode(child, options, visible);
          if (serializedChild) {
              children.push(serializedChild);
          }
      }
      if (children.length > 0) {
          serializedObj.children = children;
      }
  }
  return serializedObj;
}


function serializeDOM(root, options = {}) {
  locatorsMapping = {};
  uniqueIdCounter = 0;
  hoverSelectorCache = null;
  try {
      hoverSelectorCache = buildHoverSelectorCache(
          root && root.ownerDocument ? root.ownerDocument : undefined
      );
  } catch (e) {
      console.warn("Could not build hover selector cache.", e);
      hoverSelectorCache = [];
  }

  const finalOptions = {compressInvisible: true, ...options};

  // 🔧 Configure extraInteractiveSelectors by default:
  // - if nothing is passed → use only the default list
  // - if an array is passed → merge default + user
  if (finalOptions.extraInteractiveSelectors == null) {
      finalOptions.extraInteractiveSelectors = DEFAULT_EXTRA_INTERACTIVE_SELECTORS;
  } else if (DEFAULT_EXTRA_INTERACTIVE_SELECTORS && DEFAULT_EXTRA_INTERACTIVE_SELECTORS.length) {
      finalOptions.extraInteractiveSelectors = [
          ...DEFAULT_EXTRA_INTERACTIVE_SELECTORS,
          ...finalOptions.extraInteractiveSelectors
      ];
  }

  try {
      setInteractiveElements(root, finalOptions);
      const dom = serializeNode(root, finalOptions);
      return {dom: dom || {}, locators: locatorsMapping};
  } catch (e) {
      console.error("Fatal error during serialization:", e);
      return {dom: {}, locators: {}};
  } finally {
      const attrsToReset = [INTERACTIVE_ELEMENT_TAG, INTERACTIVE_SCORE_TAG, IGNORE_INTERACTIVE_TAG, 'data-unified-component'];
      _visCache = new WeakMap();    // 🔄 обнуляем мемо-кэш
      attrsToReset.forEach(attr => {
          eachElementDeep(root, el => {
              if (el.hasAttribute(attr)) el.removeAttribute(attr);
          });
      });
  }
}

function buildHoverSelectorCache(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || !doc.styleSheets) return [];
  const cache = new Set();
  for (const sheet of doc.styleSheets) {
      let rules;
      try {
          rules = sheet.cssRules;
      } catch (e) {
          continue;
      }
      if (!rules) continue;
      for (const rule of rules) {
          if (rule.type === CSSRule.STYLE_RULE && rule.selectorText?.includes(':hover')) {
              const selectors = rule.selectorText.split(',');
              for (let sel of selectors) {
                  if (sel.includes(':hover')) {
                      const baseSelector = sel.replace(/:hover/g, '').trim();
                      if (baseSelector) cache.add(baseSelector);
                  }
              }
          }
      }
  }
  return Array.from(cache);
}

function elementHasHoverAndPointer(element, computedStyle, hoverCache) {
  if (!element?.matches) return false;
  const style = computedStyle || window.getComputedStyle(element);
  if (style.cursor !== 'pointer') return false;
  if (!hoverCache || hoverCache.length === 0) return false;
  for (const baseSelector of hoverCache) {
      try {
          if (element.matches(baseSelector)) return true;
      } catch (e) {
      }
  }
  return false;
}

// A helper function to create a "flexible word boundary" regex.
// This ensures matches are not part of other words, handling cases like
// kebab-case, snake_case, and BEM, where \b would fail.
// A boundary is defined as the start/end of the string or a non-alphanumeric character.
function wb(body) { return `(?:^|[^A-Za-z0-9])(?:${body})(?=$|[^A-Za-z0-9])`; }

// Pre-compiled regexes for performance. They are created only once.
const RX_CLASS = new RegExp(
  wb('(?:combo(?:box)?|drop(?:[-_]?(?:down|btn))|select(?:box)?|listbox|date[-_]?picker|color[-_]?picker|calendar)'),
  'i'
);
const RX_DATE    = new RegExp(wb('date[-_]?picker'), 'i');
const RX_COLOR   = new RegExp(wb('color[-_]?picker'), 'i');
const RX_CAL     = new RegExp(wb('calendar'), 'i');
const RX_LISTBOX = new RegExp(wb('listbox'), 'i');

// A WeakSet to track elements in the current call stack to prevent infinite recursion.
const inStack = new WeakSet();

// TODO - check combobox, dropdown, select, listbox, datepicker, calendar, colorpicker roles
function getAssignedRole(element) {
  // FIX (robustness): Safely handle cases where ShadowRoot is not defined.
  if (typeof ShadowRoot !== 'undefined' && element instanceof ShadowRoot) {
      element = element.host;
  }
  if (!(element instanceof Element)) {
      return null;
  }

  // Prevents infinite recursion (e.g., A controls B, B controls A).
  if (inStack.has(element)) {
      return null;
  }
  inStack.add(element);

  try {
      // Note on custom roles: 'datepicker', 'calendar', and 'colorpicker' are not official WAI-ARIA roles.
      // They are used here for internal logic to identify specific component types during serialization.
      const DROPDOWN_ROLE = 'combobox';
      const DATEPICKER_ROLE = 'datepicker';
      const CALENDAR_ROLE = 'calendar';
      const COLORPICKER_ROLE = 'colorpicker';

      try {
          if (window.getComputedAccessibleNode) {
              const node = window.getComputedAccessibleNode(element);
              if (node && node.role) return node.role === 'none' ? null : node.role;
          }
      } catch (e) { /* ignore */
      }

      const role = element.getAttribute('role');
      if (role) {
          const cleanRole = role.trim().toLowerCase();
          if (cleanRole === 'presentation' || cleanRole === 'none') return null;
          if (cleanRole === 'grid') {
              const label = (element.getAttribute('aria-label') || '').toLowerCase();
              if (label.includes('calendar')) return CALENDAR_ROLE;
          }
          return cleanRole;
      }

      const hasPopup = element.getAttribute('aria-haspopup');
      if (hasPopup !== null && hasPopup.toLowerCase() !== 'false') {
          return DROPDOWN_ROLE;
      }

      const controlsId = element.getAttribute('aria-controls');
      if (controlsId) {
          try {
              const root = element.getRootNode && element.getRootNode();
              const idList = controlsId.trim().split(/\s+/);
              for (const id of idList) {
                  if (!id) continue;
                  let controlledElement = document.getElementById(id);
                  if (!controlledElement && root && root !== document && typeof root.querySelector === 'function') {
                      // FIX (robustness): Provide a fallback for CSS.escape for older browsers.
                      const selectorId = (window.CSS && typeof window.CSS.escape === 'function')
                          ? CSS.escape(id)
                          : id.replace(/[^\w-]/g, '\\$&');
                      controlledElement = root.querySelector(`#${selectorId}`);
                  }

                  if (controlledElement) {
                      const controlledRole = getAssignedRole(controlledElement);
                      const popupRoles = ['listbox', 'grid', 'tree', 'menu', 'dialog'];
                      if (popupRoles.includes(controlledRole)) {
                          return DROPDOWN_ROLE;
                      }
                  }
              }
          } catch (e) { /* ignore */
          }
      }

      const dataAttrs = ['data-role', 'data-widget', 'data-control', 'data-component', 'data-type'];
      for (const attr of dataAttrs) {
          const val = element.getAttribute(attr);
          if (val) {
              const r = val.toLowerCase().trim();
              const roleMap = {
                  'dropdownlist': DROPDOWN_ROLE, 'dropdown': DROPDOWN_ROLE,
                  'combobox': DROPDOWN_ROLE, 'select': DROPDOWN_ROLE,
                  'listbox': 'listbox', 'datepicker': DATEPICKER_ROLE,
                  'calendar': CALENDAR_ROLE, 'colorpicker': COLORPICKER_ROLE
              };
              if (roleMap[r]) return roleMap[r];
          }
      }

      let rawClassName = '';
      try {
          const isSVG = typeof SVGAnimatedString !== 'undefined' && element.className instanceof SVGAnimatedString;
          rawClassName = isSVG ? element.className.baseVal : element.className;
      } catch (e) { /* ignore, can fail on some custom element getters */
      }
      const haystack = String(rawClassName || '') + ' ' + (element.id || '');

      if (haystack.trim() && RX_CLASS.test(haystack)) {
          // The order of these checks is important to prioritize more specific roles.
          if (RX_DATE.test(haystack)) return DATEPICKER_ROLE;
          if (RX_COLOR.test(haystack)) return COLORPICKER_ROLE;
          if (RX_CAL.test(haystack)) return CALENDAR_ROLE;
          if (RX_LISTBOX.test(haystack)) return 'listbox';
          // If RX_CLASS test passed but none of the specific roles above did,
          // it must be one of the general dropdown/combobox variations.
          return DROPDOWN_ROLE;
      }

      const tag = element.tagName.toLowerCase();
      const parent = element.parentElement;
      if (parent) {
          try {
              const parentRole = getAssignedRole(parent);
              if (tag === 'li') {
                  if (['menu', 'menubar'].includes(parentRole)) return 'menuitem';
                  if (parentRole === 'tablist') return 'tab';
                  if (['listbox', 'grid', 'tree'].includes(parentRole)) return 'option';
              }
              if (tag === 'th') return 'columnheader';
          } catch (e) { /* ignore */
          }
      }

      if (tag === 'a') return element.hasAttribute('href') ? 'link' : 'button';
      if (tag === 'select') return element.multiple || (+element.size || 0) > 1 ? 'listbox' : DROPDOWN_ROLE;
      if (tag === 'input' && element.hasAttribute('list')) return DROPDOWN_ROLE;

      const implicitRoles = {
          'article': 'article', 'aside': 'complementary', 'button': 'button',
          'details': 'group', 'summary': 'button', 'dialog': 'dialog', 'dl': 'list',
          'dt': 'listitem', 'dd': 'listitem', 'figure': 'figure', 'footer': 'contentinfo',
          'form': 'form', 'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading',
          'h5': 'heading', 'h6': 'heading', 'header': 'banner', 'hr': 'separator', 'img': 'img',
          'main': 'main', 'menu': 'list', 'meter': 'meter', 'nav': 'navigation', 'ol': 'list',
          'ul': 'list', 'li': 'listitem', 'output': 'status', 'progress': 'progressbar',
          'section': 'region', 'table': 'table', 'tbody': 'rowgroup', 'thead': 'rowgroup',
          'tfoot': 'rowgroup', 'td': 'cell', 'textarea': 'textbox', 'tr': 'row'
      };
      if (implicitRoles[tag]) return implicitRoles[tag];

      if (tag === "input") {
          const inputType = (element.getAttribute("type") || "text").toLowerCase();
          switch (inputType) {
              case "button":
              case "submit":
              case "reset":
              case "image":
                  return "button";
              case "checkbox":
                  return "checkbox";
              case "radio":
                  return "radio";
              case "range":
                  return "slider";
              case "search":
                  return "searchbox";
              case "date":
              case "datetime-local":
              case "month":
              case "week":
              case "time":
                  return DATEPICKER_ROLE;
              case "color":
                  return COLORPICKER_ROLE;
              default:
                  return "textbox";
          }
      }

      return null;

  } finally {
      inStack.delete(element);
  }
}

function getAccessibleName(element) {
  if (!(element instanceof Element)) return null;
  try {
      if (window.getComputedAccessibleNode) {
          const node = window.getComputedAccessibleNode(element);
          if (node && node.name) return node.name.trim();
      }
  } catch (e) {
  }
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
      try {
          const referenced = labelledBy.split(' ').map(id => document.getElementById(id)).filter(Boolean);
          if (referenced.length > 0) return referenced.map(el => el.textContent).join(' ').trim();
      } catch (e) {
      }
  }
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  if (element.labels && element.labels.length > 0) return Array.from(element.labels).map(l => l.textContent).join(' ').trim();
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();
  if (element.tagName.toLowerCase() === 'img') {
      const alt = element.getAttribute('alt');
      if (alt) return alt.trim();
  }
  const directText = getDirectText(element);
  if (directText) return directText;
  const title = element.getAttribute('title');
  if (title) return title.trim();
  return null;
}

function getDirectText(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE || EXCLUDED_TAGS.has(node.tagName.toLowerCase())) return "";
  let text = "";
  for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
          const trimmedText = child.textContent.trim();
          if (trimmedText) text += (text ? " " : "") + trimmedText.replace(/\s+/g, ' ');
      }
  }
  return text;
}

/**
* Возвращает true, если элемент действительно сверху и готов к клику.
* Надёжна для snapshot-сериализации: полностью синхронна, не требует визуальных API.
*/
function isTopInteractiveElement(el, opts = {}) {
  // ───────────────────────── helpers
  const safeCS = node => {
      try { return getComputedStyle(node); } catch { return null; }
  };
  const hasPointer = cs => cs && cs.pointerEvents !== 'none';
  const isVisibleStyle = cs =>
      cs && cs.visibility !== 'hidden' &&
      (parseFloat(cs.opacity || '1') > 0 || cs.pointerEvents === 'none');

  try {
      if (!(el instanceof Element)) return false;

      // 1) базовая видимость –––––––––––––––––––––
      let visible = true;
      if (typeof el.checkVisibility === 'function') {
          try {
              visible = el.checkVisibility({
                  contentVisibilityAuto: true,
                  opacityProperty:       true,
                  visibilityProperty:    true
              });
          } catch { /* старый браузер: идём дальше */ }
      }
      if (!visible) return false;

      const csRoot = safeCS(el);
      if (!csRoot ||
          csRoot.display === 'none' ||
          csRoot.visibility === 'hidden' ||
          parseFloat(csRoot.opacity || '1') === 0 ||
          csRoot.pointerEvents === 'none'
      ) return false;

      // 2) интерактивность –––––––––––––––––––––
      if (el.disabled || el.inert) return false;

      // 3) в viewport? –––––––––––––––––––––
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0)         return false;
      if (rect.bottom < 0 || rect.top > innerHeight ||
          rect.right  < 0 || rect.left > innerWidth)   return false;

      // 4) hit-test сеткой –––––––––––––––––––––
      const side     = Math.min(
          7,                               // не больше 7×7
          Math.max(3, Math.round(Math.sqrt((rect.width * rect.height) / 1600)))
      );
      const needGood = Math.max(1, Math.ceil(side * side * (opts.minRatio ?? 0.15)));
      let good = 0, tested = 0;

      const primaryRoot = el.getRootNode?.();
      const hitStacks = (x, y) => {
          for (const ctx of [primaryRoot, el.ownerDocument, document]) {
              try {
                  if (ctx && typeof ctx.elementsFromPoint === 'function') {
                      const list = ctx.elementsFromPoint(x, y);
                      if (list?.length) return list;
                  }
              } catch { /* cross-origin iframe etc. */ }
          }
          return [];
      };

      for (let r = 0; r < side; r++) {
          const y = rect.top + rect.height * (r + 0.5) / side;
          if (y < 0 || y > innerHeight) continue;

          for (let c = 0; c < side; c++) {
              const x = rect.left + rect.width * (c + 0.5) / side;
              if (x < 0 || x > innerWidth) continue;

              tested++;
              const stack = hitStacks(x, y);
              if (!stack.length) continue;

              const top = stack.find(n => {
                  const cs = safeCS(n);
                  return hasPointer(cs) && isVisibleStyle(cs);
              });

              if (top && (top === el || el.contains(top))) {
                  good++;
                  if (good >= needGood) return true;      // ранний успех
              }
          }
      }
      return false;                                     // недостаточно «хороших» точек
  } catch (err) {
      console.warn('isTopInteractiveElement - error:', err);
      return false;                                     // fail-safe
  }
}

function isUniqueSelector(selector) {
  if (!selector) return false;
  try {
      return document.querySelectorAll(selector).length === 1;
  } catch (e) {
      return false;
  }
}

function cssHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/******************************************************************************
*   ADVANCED SELF-HEALING LOCATOR GENERATION (From serializer.js logic)
******************************************************************************/

/**
* Generates Playwright-optimized locators with a strict priority system.
* It uses a "search context" (landmarks like header, nav, form) to verify uniqueness,
* mimicking real user and Playwright behavior.
* REFACTORED: This is now a standalone function.
* @param {Element} element The element to generate locators for.
* @param {object} [options={}] Optional settings.
* @param {boolean} [options.forceUnique=false] If true, ensures CSS/XPath fallbacks are always globally unique.
*/
function getFlexibleLocators(element, options = {}) {
  if (!(element instanceof Element)) return { priority: [], locator: { selector: 'N/A', source: 'Invalid element' } };

  const locators = {};
  const priority = [];
  const addedStrategies = new Set();

  const addStrategy = (strategyName, details) => {
      const baseStrategy = strategyName.split('_').pop();
      const isChainedOrFiltered = strategyName.includes('chained') || strategyName.includes('filtered');
      if (addedStrategies.has(baseStrategy) && !isChainedOrFiltered) {
          return;
      }
      locators[strategyName] = details;
      if (!priority.includes(strategyName)) {
          priority.push(strategyName);
      }
      if (!isChainedOrFiltered) {
          addedStrategies.add(baseStrategy);
      }
  };

  const candidates = {};

  // Test ID
  const testIdAttrs = ["data-testid", "data-test-id", "data-test", "data-qa"];
  for (const attr of testIdAttrs) {
      const testId = element.getAttribute(attr);
      if (testId) {
          candidates.getByTestId = {
              details: {testId},
              isUnique: isUniqueSelector(`[${attr}="${CSS.escape(testId)}"]`)
          };
          break;
      }
  }

  // Role and Name
  const role = getAssignedRole(element);
  const name = getAccessibleName(element);
  if (role && name) {
      const roleMatches = findElementsByRole(role).filter(el => getAccessibleName(el) === name);
      candidates.getByRole = {details: {role, name}, isUnique: roleMatches.length === 1};
  }

  // Text
  const text = getDirectText(element);
  if (text) {
      candidates.getByText = {details: {text, exact: true}, isUnique: findElementsByText(text).length === 1};
  }

  // --- Build priority list ---

  // 1. Unique Test ID
  if (candidates.getByTestId?.isUnique) {
      addStrategy('getByTestId', candidates.getByTestId.details);
  }

  // 2. Role locators (with refinement and chaining)
  if (candidates.getByRole?.isUnique) {
      addStrategy('getByRole', candidates.getByRole.details);
  } else if (candidates.getByRole) {
      const refinement = refineWithUniqueChild(element);
      if (refinement) {
          addStrategy('filtered_getByRole', {
              base: {strategy: 'getByRole', details: candidates.getByRole.details},
              filter: refinement
          });
      }
      const anchorInfo = findBestAnchor(element);
      if (anchorInfo) {
          addStrategy('chained_getByRole', {
              anchor: {strategy: anchorInfo.strategy, details: anchorInfo.details},
              target: {strategy: 'getByRole', details: candidates.getByRole.details}
          });
      }
      addStrategy('getByRole', candidates.getByRole.details);
  }

  // 3. Text locators (with refinement and chaining)
  if (candidates.getByText?.isUnique) {
      addStrategy('getByText', candidates.getByText.details);
  } else if (candidates.getByText) {
      const refinement = refineWithUniqueChild(element);
      if (refinement) {
          addStrategy('filtered_getByText', {
              base: {strategy: 'getByText', details: candidates.getByText.details},
              filter: refinement
          });
      }
      const anchorInfo = findBestAnchor(element);
      if (anchorInfo) {
          addStrategy('chained_getByText', {
              anchor: {strategy: anchorInfo.strategy, details: anchorInfo.details},
              target: {strategy: 'getByText', details: candidates.getByText.details}
          });
      }
      addStrategy('getByText', candidates.getByText.details);
  }

  // --- Other unique locators ---
  const placeholder = element.getAttribute("placeholder");
  if (placeholder && isUniqueSelector(`[placeholder="${CSS.escape(placeholder)}"]`)) {
      addStrategy('getByPlaceholder', {placeholder});
  }

  // --- Fallbacks ---
  try {
      // The `forceUnique` option ensures that even for a single element, we generate
      // a fully qualified, unique selector, which is vital for the hash ID.
      const uniqueCss = generateGuaranteedUniqueCssSelector(element, options.forceUnique);
      addStrategy('getByCss', { css: uniqueCss });
  } catch (e) {
      console.error("Failed to generate CSS", e);
  }

  try {
      const uniqueXpath = generateXPathWithShadow(element);
      addStrategy('getByXpath', { xpath: uniqueXpath });
  } catch (e) {
      console.error("Failed to generate XPath", e);
  }


  locators.priority = priority;
  locators.locator = {
      selector: priority[0] || 'N/A',
      source: `Best locator strategy: ${priority[0] || 'none found'}`
  };

  return locators;
}

function getAccurateLabel(element) {    // TODO Remove?
  if (!(element instanceof Element)) return null;
  let candidateLabel = null;
  if (element.id) {
      try {
          const labels = Array.from(document.querySelectorAll(`label[for="${CSS.escape(element.id)}"]`));
          if (labels.length === 1) candidateLabel = labels[0];
      } catch (e) {
      }
  }
  if (!candidateLabel) candidateLabel = element.closest("label");
  if (candidateLabel) {
      const text = candidateLabel.innerText.trim();
      try {
          const similarLabels = Array.from(document.querySelectorAll("label")).filter(l => l.innerText.trim() === text);
          return similarLabels.length > 1 ? `${text} (ambiguous)` : text;
      } catch (e) {
          return text;
      }
  }
  return null;
}

function generateGuaranteedUniqueCssSelector(element, forceUnique = true) {
  if (!(element instanceof Element)) throw new Error("Invalid element provided.");
  const stableAttrs = ['data-testid', 'data-test-id', 'data-qa', 'data-test'];
  for (const attr of stableAttrs) {
      const val = element.getAttribute(attr);
      if (val) {
          const selector = `[${attr}="${CSS.escape(val)}"]`;
          if (isUniqueSelector(selector)) return selector;
      }
  }
  if (element.id) {
      const selector = `#${CSS.escape(element.id)}`;
      if (isUniqueSelector(selector)) return selector;
  }

  if (!forceUnique) {
      // If we don't need a globally unique selector, we can sometimes return a simpler one.
      const classNames = (element.className || '').trim().split(/\s+/).filter(Boolean);
      if (classNames.length > 0) {
          const simpleSelector = `.${classNames.map(c => CSS.escape(c)).join('.')}`;
          // This is not guaranteed to be unique, but it's a simple representation.
          // For hashing, we need the guaranteed unique path below.
      }
  }

  let path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
          const idSelector = `#${CSS.escape(current.id)}`;
          // Check if ID is unique from the root to stop path generation early.
          if (isUniqueSelector(idSelector)) {
              path.unshift(idSelector);
              // Since we found a unique ID, the path from here is unique.
              return path.join(' > ').replace(/\s*>>>\s*/g, ' >>> ');
          }
      }
      if (current.parentElement) {
          const siblings = Array.from(current.parentElement.children);
          const siblingsOfSameTag = siblings.filter(sib => sib.tagName === current.tagName);
          if (siblingsOfSameTag.length > 1) {
              const index = siblingsOfSameTag.indexOf(current) + 1;
              segment += `:nth-of-type(${index})`;
          }
      }
      path.unshift(segment);
      const parent = current.parentElement;
      if (!parent && current.getRootNode() instanceof ShadowRoot) {
          path.unshift(generateGuaranteedUniqueCssSelector(current.getRootNode().host, true) + ' >>> ');
          break;
      }
      current = parent;
  }
  return path.join(' > ').replace(/\s*>>>\s*/g, ' >>> ');
}


/**
* Возвращает уникальный XPath для элемента, корректно проходя сквозь Shadow DOM.
* ─────────────────────────────────────────────────────────────────────────────
* 1.  Если элемент имеет уникальный id — сразу используем выражение ID-шортката.
* 2.  Иначе поднимаемся вверх по DOM-дереву, включая hop-ы host↔shadow-root.
* 3.  Для каждого шага добавляем индекс [n] **только**, когда среди братьев
*     встречается хотя бы ещё один элемент того же тега (и до, и после).
* 4.  Функция никогда не бросает исключений — максимум возвращает '//html'
*     (достижимо лишь если на входе был document-узел вместо элемента).
*/
function generateXPathWithShadow(node) {
  if (!(node instanceof Element)) return '/html';

  // 1) Быстрый путь по уникальному id
  if (node.id && isUniqueSelector(`#${CSS.escape(node.id)}`)) {
      return `//*[@id='${node.id}']`;
  }

  /** @type {string[]} */
  const segments = [];
  let cur = node;

  // 2) Поднимаемся до корня документа
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      // a) переходим от shadow-root к его host, если parentElement отсутствует
      if (!cur.parentElement) {
          const root = cur.getRootNode();
          if (root instanceof ShadowRoot) {
              /**
               * Вставляем путь до host, а затем продолжим цикл,
               * чтобы посчитать индекс host-элемента среди его братьев.
               */
              cur = root.host;
              continue;
          }
          break; // дошли до <html>
      }

      // b) собираем сегмент для текущего узла
      const tag = cur.tagName.toLowerCase();

      // Считаем количество предыдущих сиблингов того же тега
      let position = 1;
      for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
          if (sib.tagName === cur.tagName) position++;
      }

      // Проверяем, есть ли такие же теги после элемента
      const needIndex = Array.prototype.some.call(
          cur.parentElement.children,
          el => el !== cur && el.tagName === cur.tagName
      );

      segments.unshift(needIndex || position > 1 ? `${tag}[${position}]` : tag);

      cur = cur.parentElement;
  }

  // 3) Гарантируем, что путь начинается с корня
  segments.unshift(''); // приводит к ведущему '/' при join

  const result = '/' + segments.join('/');
  return result.startsWith('/html') ? result : '/html' + result;
}

/**
* Эмулирует Playwright getByRole. Ищет ТОЛЬКО видимые элементы по заданной роли.
* @param {string} role - Роль для поиска.
* @returns {Element[]} - Массив найденных элементов.
*/
function findElementsByRole(role) {
  if (!role) return [];
  const matches = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
      const element = walker.currentNode;
      const elRole = getAssignedRole(element);
      if (elRole === role) {
          try {
              const style = window.getComputedStyle(element);
              if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                  matches.push(element);
              }
          } catch (e) {
          }
      }
  }
  return matches;
}

/**
* Эмулирует Playwright getByLabel. Ищет ТОЛЬКО видимые контролы.
* @param {string} text - Текст в элементе <label>.
* @returns {Element[]} - Массив найденных контролов.
*/
function findElementsByLabel(text) {
  if (!text) return [];
  const controls = new Set();
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  const labels = Array.from(document.body.querySelectorAll('label'));

  for (const label of labels) {
      try {
          const style = window.getComputedStyle(label);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
      } catch (e) {
          continue;
      }

      if (label.textContent.trim().replace(/\s+/g, ' ') === normalizedText) {
          let control = null;
          const forId = label.getAttribute('for');
          if (forId) {
              control = document.body.querySelector(`#${CSS.escape(forId)}`);
          } else {
              control = label.querySelector('input, textarea, select, button');
          }

          if (control) {
              try {
                  const controlStyle = window.getComputedStyle(control);
                  if (controlStyle.display !== 'none' && controlStyle.visibility !== 'hidden') {
                      controls.add(control);
                  }
              } catch (e) {
              }
          }
      }
  }
  return Array.from(controls);
}

/**
* Эмулирует Playwright getByText. Ищет ТОЛЬКО видимые элементы с точным текстом.
* @param {string} text - Текст для поиска.
* @returns {Element[]} - Массив найденных элементов.
*/
function findElementsByText(text) {
  if (!text) return [];
  const matches = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
      const element = walker.currentNode;
      if (EXCLUDED_TAGS.has(element.tagName.toLowerCase())) continue;

      if (getDirectText(element) === text) {
          try {
              const style = window.getComputedStyle(element);
              if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                  if (!matches.includes(element)) {
                      matches.push(element);
                  }
              }
          } catch (e) {
          }
      }
  }
  return matches;
}

/**
* Находит лучшего "якорного" предка для создания цепочки локаторов.
* Якорь — это стабильный, семантически значимый родительский элемент.
* @param {Element} element - Исходный элемент.
* @returns {{anchor: Element, strategy: string, details: object} | null} - Объект с якорем и его лучшим локатором или null.
*/
function findBestAnchor(element) {
  let parent = element.parentElement;
  let level = 0;
  while (parent && parent !== document.body && level < 5) { // Ограничим поиск 5 уровнями вверх
      // 1. Приоритет: Test ID
      const testIdAttrs = ["data-testid", "data-test-id", "data-test", "data-qa"];
      for (const attr of testIdAttrs) {
          const testId = parent.getAttribute(attr);
          if (testId && isUniqueSelector(`[${attr}="${CSS.escape(testId)}"]`)) {
              return {anchor: parent, strategy: 'getByTestId', details: {testId}};
          }
      }

      // 2. Приоритет: Уникальный ID
      const id = parent.getAttribute("id");
      if (id && !id.startsWith('react-select-') && isUniqueSelector(`#${CSS.escape(id)}`)) {
          return {anchor: parent, strategy: 'getByCss', details: {css: `#${CSS.escape(id)}`}};
      }

      // 3. Приоритет: Значимые роли (Landmarks)
      const role = getAssignedRole(parent);
      const name = getAccessibleName(parent);
      const landmarkRoles = new Set(['form', 'main', 'navigation', 'banner', 'contentinfo', 'region', 'search', 'article', 'dialog']);
      if (role && landmarkRoles.has(role) && name) {
          const roleMatches = findElementsByRole(role);
          const roleNameMatches = roleMatches.filter(el => getAccessibleName(el) === name);
          if (roleNameMatches.length === 1) {
              return {anchor: parent, strategy: 'getByRole', details: {role, name}};
          }
      }

      parent = parent.parentElement;
      level++;
  }
  return null;
}

/**
* Находит уникального потомка внутри элемента, который можно использовать для фильтрации.
* Ищет иконки, значки (badges) или другой уникальный текст.
* @param {Element} element - Родительский элемент, для которого ищется уточнение.
* @returns {{strategy: string, details: object} | null} - Уникальный локатор для дочернего элемента или null.
*/
function refineWithUniqueChild(element) {
  // Ищем потомков с уникальным текстом, который не совпадает с основным текстом родителя
  const parentText = getDirectText(element);
  const childTextElements = Array.from(element.querySelectorAll('span, div, p, strong, em, b'));
  for (const child of childTextElements) {
      const childText = getDirectText(child);
      // Условие: дочерний текст существует, он не равен родительскому и он уникален на всей странице
      if (childText && childText !== parentText && findElementsByText(childText).length === 1) {
          return {strategy: 'getByText', details: {text: childText, exact: true}};
      }
  }

  // Ищем потомков-иконок с уникальным классом или title
  const childIconElements = Array.from(element.querySelectorAll('i, svg'));
  for (const child of childIconElements) {
      const title = child.getAttribute('title');
      if (title && isUniqueSelector(`[title="${CSS.escape(title)}"]`)) {
          return {strategy: 'getByTitle', details: {title}};
      }
      // Проверка на уникальность класса иконки (упрощенная)
      if (child.className && typeof child.className === 'string') {
          const uniqueClass = child.className.split(' ').find(cls => cls.includes('icon') && isUniqueSelector(`.${cls}`));
          if (uniqueClass) {
              return {strategy: 'getByCss', details: {css: `.${uniqueClass}`}};
          }
      }
  }
  return null;
}

try {
  window.__serializerReady = true;
  const detail = { ts: Date.now(), href: location.href };
  document.dispatchEvent(new CustomEvent('serializer:ready', { detail }));
  console.debug('[SER] domSerializer ready', detail);
} catch (e) {
  console.error('[SER] failed to flag readiness', e);
}

export { serializeDOM, getFlexibleLocators };
