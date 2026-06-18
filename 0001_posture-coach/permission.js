// 카메라 권한 허용 전용 페이지 (일반 탭에서 열려 주소창 권한 UI를 사용)
// 여기서 한 번 허용하면 같은 확장 origin인 사이드 패널에도 권한이 적용됩니다.

const statusEl = document.getElementById("status");
const preview = document.getElementById("preview");
const retryBtn = document.getElementById("retry");
const help = document.getElementById("help");

function setStatus(cls, text) {
  statusEl.className = cls;
  statusEl.textContent = text;
}

async function request() {
  setStatus("pending", "카메라 권한을 요청하는 중…");
  help.style.display = "none";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    preview.srcObject = stream;
    setStatus("ok", "✅ 권한이 허용됐어요! 이 탭을 닫고 사이드 패널로 돌아가 ‘카메라 시작’을 누르세요.");
  } catch (err) {
    setStatus("fail", `❌ 카메라를 열 수 없어요 (${err.name}). 아래 안내를 따라주세요.`);
    help.style.display = "block";
    console.warn("[posture-coach] permission error:", err);
  }
}

retryBtn.addEventListener("click", request);
request();
