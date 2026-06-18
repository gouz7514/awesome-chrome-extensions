// Posture Coach — Offscreen 문서 (백그라운드 감지 엔진)
// 카메라 캡처 + MediaPipe Pose Landmarker로 자세 점수를 계산하고,
// 경고(비프음/알림)를 발사하며, 패널에 상태/랜드마크를 브로드캐스트한다.
// 숨겨진 문서라 requestAnimationFrame이 throttle될 수 있어 setInterval로 루프를 돌리고,
// 경고 지속 판정은 프레임 수가 아닌 실시간 타임스탬프(performance.now)로 처리한다.

import { FilesetResolver, PoseLandmarker } from "./lib/vision_bundle.mjs";

// ---- 랜드마크 인덱스 ----
const NOSE = 0;
const L_EAR = 7;
const R_EAR = 8;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const MIN_VISIBILITY = 0.5;

const video = document.getElementById("video");

let landmarker = null;
let stream = null;
let loopTimer = null;
let baseline = { front: null, side: null };
let settings = { sensitivity: 3, holdSec: 5, repeatSec: 10, beep: true, notify: true, overlay: true, mode: "auto" };
let lastAutoMode = "front";

// 판정/통계
let poorSince = null;
let lastAlertAt = 0; // 마지막 경고 시각 (반복 간격 계산용)
let alerting = false; // 현재 '경고 중' 상태인지 (회복 시 해제 신호용)
let alertCount = 0;
let goodFrames = 0;
let totalFrames = 0;
let sessionStart = 0;
let lastBroadcast = 0;

const MODE_LABEL = { front: "정면", side: "측면" };
const GOOD_THRESH = 75;
const POOR_THRESH = 60;
const LOOP_MS = 150; // 약 6~7fps (throttle돼도 자세 감지엔 충분)
const BROADCAST_MS = 120; // 패널 UI 갱신 주기

// ===================================================================
// 메시지 송수신
// ===================================================================
function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {}); // 수신자 없으면 무시(패널 닫힘 등)
}

// offscreen 문서에는 chrome.storage가 없으므로 설정/보정 기준은 메시지로 받는다.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.to !== "off") return;
  if (msg.cmd === "CALIBRATE") calibrate();
  else if (msg.type === "CONFIG") {
    if (msg.settings) settings = { ...settings, ...msg.settings };
    if (msg.baseline) baseline = normalizeBaseline(msg.baseline);
  }
});

function normalizeBaseline(b) {
  if (b && (b.front !== undefined || b.side !== undefined)) {
    return { front: b.front ?? null, side: b.side ?? null };
  }
  if (b && b.neckRatio !== undefined) return { front: b, side: null };
  return { front: null, side: null };
}

// ===================================================================
// 시작 (문서 생성 시 storage의 pc_monitoring을 읽고 자동 시작)
// ===================================================================
(async function main() {
  // 설정/보정 기준은 background(=storage 소유)에서 받아온다
  const cfg = await chrome.runtime.sendMessage({ to: "bg", cmd: "GET_CONFIG" });
  if (cfg?.settings) settings = { ...settings, ...cfg.settings };
  if (cfg?.baseline) baseline = normalizeBaseline(cfg.baseline);
  start(); // offscreen 문서는 모니터링 ON일 때만 생성되므로 바로 시작
})();

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    send({ to: "panel", type: "CAM_ERROR", name: err.name });
    send({ to: "bg", cmd: "STOP" }); // 모니터링 플래그 내리고 문서 정리
    return;
  }
  video.srcObject = stream;
  await video.play();

  if (!landmarker) await initModel();

  sessionStart = performance.now();
  goodFrames = totalFrames = alertCount = 0;
  poorSince = null;
  lastAlertAt = 0;
  alerting = false;
  loopTimer = setInterval(tick, LOOP_MS);
}

async function initModel() {
  const fileset = await FilesetResolver.forVisionTasks("lib/wasm");
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: "models/pose_landmarker_lite.task", delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (err) {
    console.warn("[posture-coach] GPU 실패, CPU 폴백:", err);
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

// ===================================================================
// 감지 루프
// ===================================================================
function tick() {
  if (!landmarker || video.readyState < 2) return;
  const result = landmarker.detectForVideo(video, performance.now());
  const lm = result.landmarks?.[0];

  if (!lm) {
    broadcast({ state: "idle", label: "사람이 보이지 않아요", score: null });
    poorSince = null;
    return;
  }

  const mode = resolveMode(lm);
  const parts = getParts(lm, mode);
  if (!parts) {
    broadcast({
      state: "idle",
      score: null,
      mode,
      lms: lm,
      label:
        mode === "side"
          ? "옆모습으로 귀와 어깨가 보이게 앉아주세요"
          : "어깨와 얼굴이 잘 보이게 앉아주세요",
    });
    poorSince = null;
    return;
  }

  const b = baseline[mode];
  if (!b) {
    broadcast({ state: "idle", score: null, mode, lms: lm, label: `${MODE_LABEL[mode]} 자세 보정이 필요해요` });
    return;
  }

  const m = mode === "side" ? sideMetrics(parts) : frontMetrics(parts);
  const score = mode === "side" ? scoreSide(m, b) : scoreFront(m, b);
  evaluate(score, mode, lm);
}

// ===================================================================
// 판정 + 경고
// ===================================================================
function evaluate(score, mode, lm) {
  totalFrames += 1;
  if (score >= GOOD_THRESH) goodFrames += 1;

  let state, label;
  if (score >= GOOD_THRESH) (state = "good"), (label = "좋은 자세예요 👍");
  else if (score >= POOR_THRESH) (state = "warn"), (label = "조금 흐트러졌어요");
  else (state = "bad"), (label = "자세가 무너졌어요");

  const now = performance.now();
  if (score < POOR_THRESH) {
    // 나쁜 자세: holdSec 지속 후 첫 경고, 이후 repeatSec 간격으로 반복
    if (poorSince === null) poorSince = now;
    const held = now - poorSince;
    if (held >= settings.holdSec * 1000 && now - lastAlertAt >= settings.repeatSec * 1000) {
      fireAlert(score);
      lastAlertAt = now;
      alerting = true;
    }
  } else {
    // 자세 회복(점수 ≥ 임계치): 경고 해제 신호 보내고 상태 리셋
    if (alerting) {
      send({ to: "bg", cmd: "CLEAR_ALERT" });
      alerting = false;
    }
    poorSince = null;
    lastAlertAt = 0;
  }

  broadcast({ state, label, score, mode, lms: lm });
}

function fireAlert(score) {
  alertCount += 1;
  if (settings.beep) beep();
  send({
    to: "bg",
    cmd: "PULSE",
    notify: settings.notify,
    overlay: settings.overlay,
    detail: `자세 점수 ${score}점. 허리를 펴고 화면에서 조금 멀어져 보세요.`,
    message: "🪑 자세 펴세요!",
  });
}

// ===================================================================
// 패널로 상태 브로드캐스트 (throttle)
// ===================================================================
function broadcast({ state, label, score, mode, lms }) {
  const now = performance.now();
  if (now - lastBroadcast < BROADCAST_MS) return;
  lastBroadcast = now;
  send({
    to: "panel",
    type: "STATE",
    state,
    label,
    score,
    mode: mode ? (settings.mode === "auto" ? "자동 · " : "") + MODE_LABEL[mode] : "",
    lms: lms ? lms.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })) : null,
    stats: {
      goodPct: totalFrames ? Math.round((goodFrames / totalFrames) * 100) : null,
      elapsed: Math.floor((now - sessionStart) / 1000),
      alerts: alertCount,
    },
  });
}

// ===================================================================
// 방향 자동 감지
// ===================================================================
function resolveMode(lm) {
  if (settings.mode !== "auto") return settings.mode;
  const frontVisible = [L_EAR, R_EAR, L_SHOULDER, R_SHOULDER].every(
    (i) => (lm[i]?.visibility ?? 0) >= MIN_VISIBILITY
  );
  if (!frontVisible) return (lastAutoMode = "side");
  const ls = lm[L_SHOULDER], rs = lm[R_SHOULDER], le = lm[L_EAR], re = lm[R_EAR];
  const shoulderDx = Math.abs(ls.x - rs.x);
  const neckVert = Math.abs((ls.y + rs.y) / 2 - (le.y + re.y) / 2) || 1e-6;
  const ratio = shoulderDx / neckVert;
  if (ratio > 1.0) lastAutoMode = "front";
  else if (ratio < 0.7) lastAutoMode = "side";
  return lastAutoMode;
}

// ===================================================================
// 필수 랜드마크 추출
// ===================================================================
function getParts(lm, mode) {
  const nose = lm[NOSE];
  if ((nose?.visibility ?? 0) < MIN_VISIBILITY) return null;
  if (mode === "front") {
    const ids = [L_EAR, R_EAR, L_SHOULDER, R_SHOULDER];
    if (!ids.every((i) => (lm[i]?.visibility ?? 0) >= MIN_VISIBILITY)) return null;
    return { nose, ls: lm[L_SHOULDER], rs: lm[R_SHOULDER], le: lm[L_EAR], re: lm[R_EAR] };
  }
  const useLeft = (lm[L_EAR].visibility ?? 0) >= (lm[R_EAR].visibility ?? 0);
  const ear = useLeft ? lm[L_EAR] : lm[R_EAR];
  const sh = useLeft ? lm[L_SHOULDER] : lm[R_SHOULDER];
  if ((ear?.visibility ?? 0) < MIN_VISIBILITY || (sh?.visibility ?? 0) < MIN_VISIBILITY) return null;
  return { nose, ear, sh };
}

// ===================================================================
// 지표 + 점수
// ===================================================================
function frontMetrics({ nose, ls, rs, le, re }) {
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 1e-6;
  const shoulderMidY = (ls.y + rs.y) / 2;
  const earMidY = (le.y + re.y) / 2;
  return {
    neckRatio: (shoulderMidY - earMidY) / shoulderW,
    noseRelY: (shoulderMidY - nose.y) / shoulderW,
    shoulderW,
    tilt: Math.atan2(ls.y - rs.y, ls.x - rs.x),
  };
}
function scoreFront(m, b) {
  const slouch = Math.max(0, (b.neckRatio - m.neckRatio) / b.neckRatio);
  const headDown = Math.max(0, (b.noseRelY - m.noseRelY) / Math.abs(b.noseRelY || 1e-6));
  const tooClose = Math.max(0, (m.shoulderW - b.shoulderW) / b.shoulderW);
  const lean = Math.abs(m.tilt - b.tilt);
  return clampScore(1.6 * slouch + 1.4 * headDown + 0.9 * tooClose + 0.8 * lean);
}

function sideMetrics({ nose, ear, sh }) {
  const vx = ear.x - sh.x;
  const vy = ear.y - sh.y;
  const neckLen = Math.hypot(vx, vy) || 1e-6;
  return {
    fhAngle: Math.atan2(Math.abs(vx), Math.max(1e-6, -vy)),
    headDown: (nose.y - ear.y) / neckLen,
    scale: neckLen,
  };
}
function scoreSide(m, b) {
  const forwardHead = Math.max(0, m.fhAngle - b.fhAngle);
  const headDown = Math.max(0, m.headDown - b.headDown);
  const tooClose = Math.max(0, (m.scale - b.scale) / b.scale);
  return clampScore(1.5 * forwardHead + 1.2 * headDown + 0.7 * tooClose);
}

function clampScore(penalty) {
  const sensFactor = 0.6 + settings.sensitivity * 0.28;
  return Math.max(0, Math.min(100, Math.round(100 - penalty * 100 * sensFactor)));
}

// ===================================================================
// 비프음
// ===================================================================
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(660, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.34);
  } catch (err) {
    console.warn("[posture-coach] 비프음 실패:", err);
  }
}

// ===================================================================
// 보정
// ===================================================================
function calibrate() {
  if (!landmarker || video.readyState < 2) {
    send({ to: "panel", type: "CAL_FAIL", reason: "카메라 준비 중이에요" });
    return;
  }
  const result = landmarker.detectForVideo(video, performance.now());
  const lm = result.landmarks?.[0];
  if (!lm) {
    send({ to: "panel", type: "CAL_FAIL", reason: "사람이 보이지 않아요" });
    return;
  }
  const mode = resolveMode(lm);
  const parts = getParts(lm, mode);
  if (!parts) {
    send({ to: "panel", type: "CAL_FAIL", reason: `${MODE_LABEL[mode]} 자세가 잘 보이게 앉아주세요` });
    return;
  }
  baseline[mode] = mode === "side" ? sideMetrics(parts) : frontMetrics(parts);
  send({ to: "bg", cmd: "SAVE_BASELINE", baseline }); // 저장은 background가 담당
  if (alerting) {
    send({ to: "bg", cmd: "CLEAR_ALERT" });
    alerting = false;
  }
  poorSince = null;
  lastAlertAt = 0;
  send({ to: "panel", type: "CALIBRATED", mode: MODE_LABEL[mode] });
}
