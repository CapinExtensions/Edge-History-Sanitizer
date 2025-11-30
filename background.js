
// Minimalist 'Last reset' formatting: always YYYY-MM-DD.
const STORAGE_DEFAULTS = {
  rules: [],
  counters: { deletedCount: 0, lastReset: new Date().toISOString().slice(0,10) },
  logs: []
};

function isISODateString(s) {
  return typeof s === 'string' && /\d{4}-\d{2}-\d{2}T/.test(s);
}

async function getState() {
  const data = await chrome.storage.sync.get(STORAGE_DEFAULTS);
  const counters = data.counters ?? STORAGE_DEFAULTS.counters;
  // Normalize any ISO timestamps to date-only string
  if (isISODateString(counters.lastReset)) {
    try {
      counters.lastReset = new Date(counters.lastReset).toISOString().slice(0,10);
      await chrome.storage.sync.set({ counters });
    } catch (e) {}
  }
  return {
    rules: data.rules ?? STORAGE_DEFAULTS.rules,
    counters,
    logs: data.logs ?? STORAGE_DEFAULTS.logs
  };
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function patternToRegex(rule) {
  const pattern = (rule.pattern || '').trim();
  if (!pattern) return null;
  switch (rule.type) {
    case 'domain': {
      const escaped = escapeRegex(pattern).replace(/\\\*/g, '.*');
      return new RegExp(`^https?:\\/\\/(?:[^\\/]*\\.)?${escaped}(?:\\/|$)`, 'i');
    }
    default: {
      return new RegExp(escapeRegex(pattern), 'i');
    }
  }
}

let compiledRules = [];
async function compileRulesFromStorage() {
  const { rules } = await getState();
  compiledRules = rules.filter(r => r && (r.enabled !== false))
    .map(r => ({ rule: r, regex: patternToRegex(r) }))
    .filter(x => x.regex);
}
function urlMatches(url) { return compiledRules.some(({regex}) => regex.test(url)); }

async function deleteIfMatched(url, source) {
  if (!url || !compiledRules.length) return;
  if (urlMatches(url)) {
    try {
      await chrome.history.deleteUrl({ url });
      const state = await getState();
      state.counters.deletedCount += 1;
      state.logs.push({ url, source, ts: Date.now() });
      await chrome.storage.sync.set({ counters: state.counters, logs: state.logs });
    } catch (e) { console.error('Failed to delete history for', url, e); }
  }
}

function setupContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'ehs-parent', title: 'History Sanitizer', contexts: ['page'] });
      chrome.contextMenus.create({ id: 'ehs-add-domain', parentId: 'ehs-parent', title: 'Add current site (Domain)', contexts: ['page'] });
      chrome.contextMenus.create({ id: 'ehs-add-keyword', parentId: 'ehs-parent', title: 'Add current URL as keyword', contexts: ['page'] });
    });
  } catch (e) { console.warn('Context menu setup failed', e); }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pageUrl = info.pageUrl || tab?.url;
  if (!pageUrl) return;
  const u = new URL(pageUrl);
  const hostname = u.hostname.replace(/^www\./, '');
  if (info.menuItemId === 'ehs-add-domain') {
    const { rules } = await getState();
    rules.push({ pattern: hostname, type: 'domain', enabled: true });
    await chrome.storage.sync.set({ rules });
    await compileRulesFromStorage();
  } else if (info.menuItemId === 'ehs-add-keyword') {
    const { rules } = await getState();
    rules.push({ pattern: pageUrl, type: 'keyword', enabled: true });
    await chrome.storage.sync.set({ rules });
    await compileRulesFromStorage();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await compileRulesFromStorage();
  setupContextMenus();
  chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup?.addListener(() => setupContextMenus());
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.rules) await compileRulesFromStorage();
});

chrome.history.onVisited.addListener(async (item) => { await deleteIfMatched(item.url, 'history.onVisited'); });
chrome.webNavigation.onCommitted.addListener(async (details) => { if (details.url && details.frameId === 0) setTimeout(() => { deleteIfMatched(details.url, 'webNavigation.onCommitted'); }, 300); });

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  (async () => {
    if (msg.type === 'getState') {
      const state = await getState();
      const cutoff = Date.now() - 30*24*60*60*1000;
      const count30 = (state.logs || []).filter(e => e.ts >= cutoff).length;
      sendResponse({ ...state, last30Count: count30 });
    } else if (msg.type === 'addRule') {
      const { rules } = await getState();
      const type = (msg.matchType === 'domain') ? 'domain' : 'keyword';
      rules.push({ pattern: msg.pattern, type, enabled: true });
      await chrome.storage.sync.set({ rules });
      await compileRulesFromStorage();
      sendResponse({ ok: true });
    } else if (msg.type === 'removeRule') {
      const { rules } = await getState();
      if (typeof msg.index === 'number' && rules[msg.index]) {
        rules.splice(msg.index, 1);
        await chrome.storage.sync.set({ rules });
        await compileRulesFromStorage();
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'toggleRule') {
      const { rules } = await getState();
      if (typeof msg.index === 'number' && rules[msg.index]) {
        rules[msg.index].enabled = !rules[msg.index].enabled;
        await chrome.storage.sync.set({ rules });
        await compileRulesFromStorage();
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'resetCounter') {
      const { counters } = await getState();
      counters.deletedCount = 0;
      counters.lastReset = new Date().toISOString().slice(0,10);
      await chrome.storage.sync.set({ counters });
      sendResponse({ ok: true });
    } else if (msg.type === 'clearLogs') {
      await chrome.storage.sync.set({ logs: [] });
      sendResponse({ ok: true });
    } else if (msg.type === 'exportState') {
      const state = await getState();
      sendResponse({ state });
    }
  })();
  return true;
});
