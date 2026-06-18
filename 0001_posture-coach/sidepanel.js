// Posture Coach — 사이드 패널 (UI 전용)
// 감지는 백그라운드 offscreen 문서에서 수행되고, 이 패널은:
//  - 모니터링 시작/정지, 보정, 설정 명령을 보내고
//  - offscreen이 브로드캐스트하는 상태/랜드마크를 받아 스켈레톤·점수·통계를 표시한다.
// 패널을 닫아도 offscreen이 살아 있어 감지/알림은 계속된다.

import { DrawingUtils, PoseLandmarker } from "./lib/vision_bundle.mjs";

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const ctx = overlay.getContext("2d");
const drawer = new DrawingUtils(ctx);
const camMsg = $("camOverlayMsg");
const modeChip = $("modeChip");
const statusBar = $("statusBar");
const statusText = $("statusText");
const scoreBadge = $("scoreBadge");
const startBtn = $("startBtn");
const calibrateBtn = $("calibrateBtn");
const calibrateHint = $("calibrateHint");
const permBtn = $("permBtn");
const modeSeg = $("modeSeg");
const footerMsg = $("footerMsg");
const sensInput = $("sensitivity");
const sensVal = $("sensVal");
const holdInput = $("holdSec");
const holdVal = $("holdVal");
const repeatInput = $("repeatSec");
const repeatVal = $("repeatVal");
const beepToggle = $("beepToggle");
const notifyToggle = $("notifyToggle");
const overlayToggle = $("overlayToggle");
const goodPctEl = $("goodPct");
const elapsedEl = $("elapsed");
const alertCountEl = $("alertCount");

let settings = { sensitivity: 3, holdSec: 5, repeatSec: 10, beep: true, notify: true, overlay: true, mode: "auto" };
let monitoring = false;
let localStream = null; // 패널 미리보기용 (offscreen 감지와 별개)

const SENS_LABEL = { 1: "매우 둔감", 2: "둔감", 3: "보통", 4: "예민", 5: "매우 예민" };

// ===================================================================
// 설정 (storage 공유 — offscreen이 변경을 구독)
// ===================================================================
async function loadState() {
  const data = await chrome.storage.local.get(["pc_settings", "pc_baseline"]);
  if (data.pc_settings) settings = { ...settings, ...data.pc_settings };
  const b = data.pc_baseline;
  const hasBaseline = b && (b.front || b.side || b.neckRatio !== undefined);
  if (hasBaseline) calibrateHint.classList.add("hidden");
  reflectSettings();
}
function saveSettings() {
  chrome.storage.local.set({ pc_settings: settings });
  // 백그라운드 감지 엔진에도 즉시 반영 (offscreen은 storage를 못 읽음)
  chrome.runtime.sendMessage({ to: "off", type: "CONFIG", settings }).catch(() => {});
}
function reflectSettings() {
  sensInput.value = settings.sensitivity;
  sensVal.textContent = SENS_LABEL[settings.sensitivity];
  holdInput.value = settings.holdSec;
  holdVal.textContent = `${settings.holdSec}초`;
  repeatInput.value = settings.repeatSec;
  repeatVal.textContent = `${settings.repeatSec}초`;
  beepToggle.dataset.on = String(settings.beep);
  notifyToggle.dataset.on = String(settings.notify);
  overlayToggle.dataset.on = String(settings.overlay);
  for (const btn of modeSeg.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === settings.mode);
  }
}

// ===================================================================
// 모니터링 토글
// ===================================================================
async function startMonitoring() {
  await chrome.runtime.sendMessage({ to: "bg", cmd: "START" });
  setMonitoringUI(true);
  setStatus("idle", "감지 시작 중…");
  ensurePreview();
}
async function stopMonitoring() {
  await chrome.runtime.sendMessage({ to: "bg", cmd: "STOP" });
  setMonitoringUI(false);
  stopPreview();
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  camMsg.classList.remove("hidden");
  modeChip.classList.add("hidden");
  setStatus("idle", "대기 중");
  scoreBadge.textContent = "--";
  scoreBadge.dataset.state = "";
}

// 패널이 열려 있을 때만 보여줄 로컬 미리보기 (스켈레톤은 이 영상 위에 겹쳐 그려짐).
// offscreen의 백그라운드 감지와는 독립적이라, 미리보기가 실패해도 감지는 계속된다.
async function ensurePreview() {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    video.srcObject = localStream;
    await video.play();
  } catch (err) {
    localStream = null;
    footerMsg.textContent = `미리보기를 열 수 없어요 (${err.name}) · 감지는 계속됩니다`;
  }
}
function stopPreview() {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  video.srcObject = null;
}
function setMonitoringUI(on) {
  monitoring = on;
  startBtn.textContent = on ? "정지" : "모니터링 시작";
  calibrateBtn.disabled = !on;
  if (on) camMsg.classList.add("hidden");
}

// ===================================================================
// offscreen 브로드캐스트 수신
// ===================================================================
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.to !== "panel") return;

  if (msg.type === "STATE") {
    if (!monitoring) {
      setMonitoringUI(true); // 어떤 이유로든 감지 중이면 UI 동기화
      ensurePreview();
    }
    camMsg.classList.add("hidden");
    modeChip.classList.remove("hidden");
    modeChip.textContent = msg.mode || "";
    setStatus(msg.state, msg.label);
    scoreBadge.textContent = msg.score == null ? "--" : msg.score;
    scoreBadge.dataset.state = msg.score == null ? "" : msg.state;
    drawSkeleton(msg.lms);
    if (msg.stats) {
      goodPctEl.textContent = msg.stats.goodPct == null ? "--%" : `${msg.stats.goodPct}%`;
      const s = msg.stats.elapsed;
      elapsedEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      alertCountEl.textContent = String(msg.stats.alerts);
    }
  } else if (msg.type === "CALIBRATED") {
    calibrateHint.classList.add("hidden");
    footerMsg.textContent = `${msg.mode} 기준이 저장됐어요 ✅`;
  } else if (msg.type === "CAL_FAIL") {
    footerMsg.textContent = `보정 실패: ${msg.reason}`;
  } else if (msg.type === "CAM_ERROR") {
    setMonitoringUI(false);
    stopPreview();
    camMsg.classList.remove("hidden");
    setStatus("error", "카메라를 열 수 없어요");
    footerMsg.textContent = `카메라 오류: ${msg.name} — 아래 ‘권한 허용하기’를 눌러보세요`;
    permBtn.classList.add("flash");
  }
});

// ===================================================================
// 스켈레톤 그리기 (offscreen이 보낸 정규화 랜드마크)
// ===================================================================
function drawSkeleton(lms) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!lms) return;
  drawer.drawConnectors(lms, PoseLandmarker.POSE_CONNECTIONS, {
    color: "rgba(255,255,255,0.55)",
    lineWidth: 2,
  });
  drawer.drawLandmarks(lms, { color: "#818cf8", radius: 3 });
}

function setStatus(state, text) {
  statusBar.dataset.state = state || "idle";
  statusText.textContent = text || "";
}

// ===================================================================
// 이벤트 바인딩
// ===================================================================
startBtn.addEventListener("click", () => {
  if (monitoring) stopMonitoring();
  else startMonitoring();
});
calibrateBtn.addEventListener("click", () => {
  footerMsg.textContent = "보정 중…";
  chrome.runtime.sendMessage({ to: "off", cmd: "CALIBRATE" });
});
permBtn.addEventListener("click", () => {
  permBtn.classList.remove("flash");
  chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
});

modeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  settings.mode = btn.dataset.mode;
  reflectSettings();
  saveSettings();
});
sensInput.addEventListener("input", () => {
  settings.sensitivity = Number(sensInput.value);
  sensVal.textContent = SENS_LABEL[settings.sensitivity];
  saveSettings();
});
holdInput.addEventListener("input", () => {
  settings.holdSec = Number(holdInput.value);
  holdVal.textContent = `${settings.holdSec}초`;
  saveSettings();
});
repeatInput.addEventListener("input", () => {
  settings.repeatSec = Number(repeatInput.value);
  repeatVal.textContent = `${settings.repeatSec}초`;
  saveSettings();
});
beepToggle.addEventListener("click", () => {
  settings.beep = beepToggle.dataset.on !== "true";
  beepToggle.dataset.on = String(settings.beep);
  saveSettings();
});
notifyToggle.addEventListener("click", () => {
  settings.notify = notifyToggle.dataset.on !== "true";
  notifyToggle.dataset.on = String(settings.notify);
  saveSettings();
});
overlayToggle.addEventListener("click", () => {
  settings.overlay = overlayToggle.dataset.on !== "true";
  overlayToggle.dataset.on = String(settings.overlay);
  saveSettings();
});

// ===================================================================
// 시작
// ===================================================================
(async function main() {
  await loadState();
  const status = await chrome.runtime.sendMessage({ to: "bg", cmd: "GET_STATUS" });
  setMonitoringUI(!!status?.monitoring);
  if (monitoring) ensurePreview(); // 이미 감지 중이면 미리보기도 켬
  setStatus("idle", monitoring ? "측정 중…" : "대기 중");
  footerMsg.textContent = "준비됨";
})();
