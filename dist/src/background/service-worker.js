const o = {
  // Connection & Handshake
  PING: "MAPHARVEST_PING",
  PONG: "MAPHARVEST_PONG",
  // Page & Query Detection
  GET_PAGE_STATUS: "MAPHARVEST_GET_PAGE_STATUS",
  PAGE_STATUS: "MAPHARVEST_PAGE_STATUS",
  // Job Control
  START_JOB: "MAPHARVEST_START_JOB",
  PAUSE_JOB: "MAPHARVEST_PAUSE_JOB",
  RESUME_JOB: "MAPHARVEST_RESUME_JOB",
  STOP_JOB: "MAPHARVEST_STOP_JOB",
  // Scraper Events & Feedback
  STATUS_UPDATE: "MAPHARVEST_STATUS_UPDATE",
  ROW_COLLECTED: "MAPHARVEST_ROW_COLLECTED",
  ROWS_BATCH: "MAPHARVEST_ROWS_BATCH",
  JOB_COMPLETED: "MAPHARVEST_JOB_COMPLETED",
  JOB_STOPPED: "MAPHARVEST_JOB_STOPPED",
  JOB_ERROR: "MAPHARVEST_JOB_ERROR",
  // Health & Safety
  SELECTOR_HEALTH_CHECK: "MAPHARVEST_SELECTOR_HEALTH_CHECK",
  SELECTOR_HEALTH_RESULT: "MAPHARVEST_SELECTOR_HEALTH_RESULT",
  BLOCK_DETECTED: "MAPHARVEST_BLOCK_DETECTED",
  // Detail Pass (Phase 4)
  START_DETAIL_PASS: "MAPHARVEST_START_DETAIL_PASS",
  ROW_UPDATED: "MAPHARVEST_ROW_UPDATED",
  DETAIL_PASS_COMPLETE: "MAPHARVEST_DETAIL_PASS_COMPLETE"
};
console.log("[MapHarvest] Service worker initializing...");
var n, T;
(T = (n = chrome.sidePanel) == null ? void 0 : n.setPanelBehavior({ openPanelOnActionClick: !0 })) == null || T.catch((e) => console.warn("[MapHarvest] setPanelBehavior error:", e));
chrome.alarms.create("keepAliveHeartbeat", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((e) => {
  e.name;
});
async function S() {
  const e = await chrome.tabs.query({ active: !0 }), r = e.filter((s) => s.url && !s.url.startsWith("chrome-extension://") && !s.url.startsWith("chrome://")), a = r.find((s) => s.url && s.url.includes("google.") && s.url.includes("/maps"));
  if (a)
    return a;
  const t = await chrome.tabs.query({
    url: [
      "https://*.google.com/maps/*",
      "https://*.google.co.in/maps/*",
      "https://*.google.co.uk/maps/*",
      "https://*.google.ca/maps/*"
    ]
  });
  return t.length > 0 ? t[0] : r[0] || e[0] || null;
}
async function P(e) {
  try {
    const r = chrome.tabs.sendMessage(e, { action: o.PING }), a = new Promise((s, i) => setTimeout(() => i(new Error("Ping timeout")), 1e3)), t = await Promise.race([r, a]);
    if ((t == null ? void 0 : t.status) === "ok")
      return !0;
  } catch {
  }
  try {
    return await chrome.scripting.executeScript({
      target: { tabId: e },
      files: ["src/content/index.js"]
    }), await new Promise((r) => setTimeout(r, 200)), !0;
  } catch (r) {
    return console.warn(`[MapHarvest] Cannot inject into tab ${e}:`, r.message), !1;
  }
}
chrome.runtime.onMessage.addListener((e, r, a) => !e || !e.action ? !1 : r.tab && (e.action === o.ROW_COLLECTED || e.action === o.STATUS_UPDATE || e.action === o.JOB_COMPLETED || e.action === o.JOB_ERROR) ? (chrome.runtime.sendMessage(e).catch(() => {
}), !1) : e.action === o.GET_PAGE_STATUS ? ((async () => {
  try {
    const t = await S();
    if (!t || !t.id || !t.url) {
      a({
        isMaps: !1,
        isSearchPage: !1,
        query: "No tab found"
      });
      return;
    }
    if (!!!(t.url.includes("google.") && t.url.includes("/maps"))) {
      a({
        isMaps: !1,
        isSearchPage: !1,
        query: "Not a Google Maps page",
        url: t.url
      });
      return;
    }
    if (!await P(t.id)) {
      a({
        isMaps: !0,
        isSearchPage: !1,
        query: "Could not inject script",
        url: t.url
      });
      return;
    }
    const c = chrome.tabs.sendMessage(t.id, { action: o.GET_PAGE_STATUS }), E = new Promise((u, _) => setTimeout(() => _(new Error("Status query timeout")), 2500)), A = await Promise.race([c, E]);
    a(A || {
      isMaps: !0,
      isSearchPage: !1,
      query: "Empty response from tab"
    });
  } catch (t) {
    console.error("[MapHarvest] Error in GET_PAGE_STATUS:", t), a({
      isMaps: !1,
      isSearchPage: !1,
      query: "Error: " + t.message
    });
  }
})(), !0) : !1);
chrome.tabs.onActivated.addListener(async (e) => {
  try {
    chrome.runtime.sendMessage({
      action: "TAB_ACTIVATED",
      tabId: e.tabId
    }).catch(() => {
    });
  } catch {
  }
});
chrome.tabs.onUpdated.addListener((e, r, a) => {
  r.status === "complete" && a.active && chrome.runtime.sendMessage({
    action: "TAB_UPDATED",
    tabId: e,
    url: a.url
  }).catch(() => {
  });
});
