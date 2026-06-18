// Posture Coach — service worker
// 역할: ① 툴바 아이콘 클릭 시 사이드 패널 열기
//       ② Offscreen 문서(카메라+감지) 생성/종료로 "항상 켜두기" 모니터링 관리
//       ③ offscreen이 보낸 BAD_POSTURE → 데스크톱 알림 (쿨다운)

const OFFSCREEN_URL = "offscreen.html";
const NOTIFICATION_ID = "posture-coach-alert";
const OVERLAY_TAG = "__posture_coach_overlay__";

// 아이콘 클릭 → 사이드 패널 열기. 시작 시 모니터링 플래그는 꺼둠(브라우저 켜자마자 카메라 켜지지 않도록).
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
function init() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[posture-coach] sidePanel 설정 실패:", err));
  chrome.storage.local.set({ pc_monitoring: false });
}

async function hasOffscreen() {
  const ctxs = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return ctxs.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification:
      "웹캠으로 자세를 감지하고 경고음을 재생하기 위해 백그라운드에서 카메라를 사용합니다.",
  });
}

async function startMonitoring() {
  await chrome.storage.local.set({ pc_monitoring: true });
  await ensureOffscreen(); // 문서가 뜨면 pc_monitoring=true를 읽고 스스로 시작
}

async function stopMonitoring() {
  await chrome.storage.local.set({ pc_monitoring: false });
  clearAlertVisuals();
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.to !== "bg") return; // 다른 컨텍스트(panel/offscreen)용 메시지는 무시
  (async () => {
    switch (msg.cmd) {
      case "GET_STATUS":
        sendResponse({ monitoring: await hasOffscreen() });
        break;
      case "START":
        await startMonitoring();
        sendResponse({ ok: true });
        break;
      case "STOP":
        await stopMonitoring();
        sendResponse({ ok: true });
        break;
      case "GET_CONFIG": {
        const d = await chrome.storage.local.get(["pc_settings", "pc_baseline"]);
        sendResponse({ settings: d.pc_settings || null, baseline: d.pc_baseline || null });
        break;
      }
      case "SAVE_BASELINE":
        await chrome.storage.local.set({ pc_baseline: msg.baseline });
        sendResponse({ ok: true });
        break;
      case "PULSE":
        if (msg.notify) fireNotification(msg.detail);
        if (msg.overlay) injectOverlay(msg.message);
        setAlertBadge();
        sendResponse({ ok: true });
        break;
      case "CLEAR_ALERT":
        clearAlertVisuals();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false });
    }
  })();
  return true; // 비동기 응답
});

// 반복 주기는 offscreen이 제어하므로 여기선 쿨다운 없이 매번 다시 띄운다(같은 ID라 갱신됨).
function fireNotification(detail) {
  chrome.notifications.create(NOTIFICATION_ID, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "자세 펴세요 🪑",
    message: detail || "거북목/구부정한 자세가 감지됐어요. 허리를 펴고 화면에서 살짝 멀어져 보세요.",
    priority: 2,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  if (id === NOTIFICATION_ID) chrome.notifications.clear(id);
});

// ===================================================================
// 시각 경고: 툴바 배지 + 현재 탭 화면 붉게 (오버레이 주입)
// ===================================================================
function setAlertBadge() {
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
}
function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function injectOverlay(message) {
  const tabId = await activeTabId();
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showOverlay,
      args: [OVERLAY_TAG, message || "🪑 자세 펴세요!"],
    });
  } catch (_) {
    /* chrome:// · 웹스토어 등 주입 불가 페이지는 무시 (알림/배지로 대체) */
  }
}

async function removeOverlay() {
  const tabId = await activeTabId();
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: hideOverlay,
      args: [OVERLAY_TAG],
    });
  } catch (_) {}
}

function clearAlertVisuals() {
  clearBadge();
  removeOverlay();
}

// 아래 두 함수는 페이지 컨텍스트로 직렬화되어 실행됨 (외부 변수 참조 금지).
function showOverlay(tag, message) {
  let el = document.getElementById(tag);
  if (!el) {
    el = document.createElement("div");
    el.id = tag;
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;" +
      "display:flex;align-items:flex-start;justify-content:center;" +
      "box-shadow:inset 0 0 0 8px rgba(220,38,38,.95),inset 0 0 140px 50px rgba(220,38,38,.45);" +
      "animation:__pcPulse 1.1s ease-in-out infinite;";
    const badge = document.createElement("div");
    badge.id = tag + "_b";
    badge.style.cssText =
      "margin-top:26px;padding:11px 20px;border-radius:999px;background:rgba(220,38,38,.97);" +
      "color:#fff;font:700 18px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
      "box-shadow:0 6px 18px rgba(0,0,0,.35);";
    el.appendChild(badge);
    const style = document.createElement("style");
    style.id = tag + "_s";
    style.textContent = "@keyframes __pcPulse{0%,100%{opacity:.35}50%{opacity:.95}}";
    (document.body || document.documentElement).appendChild(style);
    (document.body || document.documentElement).appendChild(el);
  }
  document.getElementById(tag + "_b").textContent = message;
  // 갱신이 끊기면(회복·탭 전환 등) 스스로 사라짐
  clearTimeout(window.__pcOverlayTimer);
  window.__pcOverlayTimer = setTimeout(() => {
    document.getElementById(tag)?.remove();
    document.getElementById(tag + "_s")?.remove();
  }, 6000);
}

function hideOverlay(tag) {
  clearTimeout(window.__pcOverlayTimer);
  document.getElementById(tag)?.remove();
  document.getElementById(tag + "_s")?.remove();
}
