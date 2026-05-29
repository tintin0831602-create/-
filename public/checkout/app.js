const state = {
  plans: [],
  selectedPlan: new URLSearchParams(window.location.search).get("plan") || "student_month",
  session: null,
  paymentTestMode: true,
};

const els = {
  authStatus: document.querySelector("#authStatus"),
  plans: document.querySelector("#plans"),
  coachNameCard: document.querySelector("#coachNameCard"),
  coachName: document.querySelector("#coachName"),
  coupon: document.querySelector("#coupon"),
  applyCoupon: document.querySelector("#applyCoupon"),
  payerName: document.querySelector("#payerName"),
  payerPhone: document.querySelector("#payerPhone"),
  payerEmail: document.querySelector("#payerEmail"),
  result: document.querySelector("#result"),
  authorize: document.querySelector("#authorize"),
  pay: document.querySelector("#pay"),
};

els.authorize.addEventListener("click", startLineLogin);
els.pay.addEventListener("click", completeTestPayment);
els.applyCoupon.addEventListener("click", () => {
  showResult("優惠碼已記下", "正式金流接上後，這裡會套用折扣規則。");
});
[els.payerName, els.payerPhone, els.payerEmail, els.coachName].forEach((input) =>
  input.addEventListener("input", updatePayState),
);

await init();

async function init() {
  const config = await getJson("/api/checkout/config");
  state.plans = config.plans;
  state.paymentTestMode = config.paymentTestMode;
  renderPlans();

  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error) {
    showResult("授權沒有完成", readableError(error), true);
  }

  const sessionId = params.get("session");
  if (sessionId) {
    const data = await getJson(`/api/checkout/session/${encodeURIComponent(sessionId)}`);
    state.session = data.session;
    state.selectedPlan = data.plan.id;
    els.payerName.value = data.session.display_name || "";
    els.coachName.value = data.session.coach_name || "";
    renderPlans();
    renderAuthStatus();
  } else {
    renderAuthStatus();
  }
  updatePayState();
}

function renderPlans() {
  els.plans.innerHTML = state.plans
    .map((plan) => {
      const selected = plan.id === state.selectedPlan;
      return `
        <button class="plan ${selected ? "selected" : ""}" data-plan="${plan.id}" type="button">
          <span>${plan.role === "coach" ? "教練方案" : "學員方案"}</span>
          <strong>NT$${plan.amountTwd}</strong>
          <small>${escapeHtml(plan.label)} · ${escapeHtml(plan.description)}</small>
        </button>
      `;
    })
    .join("");
  els.plans.querySelectorAll(".plan").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.session) return;
      state.selectedPlan = button.dataset.plan;
      renderPlans();
      updatePayState();
    });
  });
  const plan = selectedPlan();
  els.coachNameCard.hidden = plan?.role !== "coach";
}

function renderAuthStatus() {
  if (state.session?.display_name) {
    els.authStatus.classList.add("authorized");
    els.authStatus.innerHTML = `
      <span class="status-dot"></span>
      <div>
        <strong>已授權 LINE 身份</strong>
        <p>${escapeHtml(state.session.display_name)}，付款完成後會開通這個 LINE 帳號。</p>
      </div>
    `;
    els.authorize.textContent = "重新授權";
    return;
  }

  els.authStatus.classList.remove("authorized");
  els.authStatus.innerHTML = `
    <span class="status-dot"></span>
    <div>
      <strong>尚未授權 LINE 身份</strong>
      <p>請先用 LINE Login 確認身份，付款成功後才知道要開通哪一個 LINE 帳號。</p>
    </div>
  `;
}

function startLineLogin() {
  const params = new URLSearchParams({ plan: state.selectedPlan });
  if (selectedPlan()?.role === "coach" && els.coachName.value.trim()) {
    params.set("coachName", els.coachName.value.trim());
  }
  window.location.href = `/auth/line/start?${params.toString()}`;
}

async function completeTestPayment() {
  const payload = {
    sessionId: state.session?.id,
    payerName: els.payerName.value.trim(),
    payerPhone: els.payerPhone.value.trim(),
    payerEmail: els.payerEmail.value.trim(),
    coachName: els.coachName.value.trim(),
    coupon: els.coupon.value.trim(),
  };
  els.pay.disabled = true;
  els.pay.textContent = "處理中";
  try {
    const data = await postJson("/api/checkout/test-complete", payload);
    const plan = data.plan;
    if (data.result.pin) {
      showResult(
        "教練方案已開通",
        `你的教練 PIN 是 ${data.result.pin}。下一步：進入教練管理台，或回 LINE 輸入「教練區」查看管理入口。`,
        false,
        [
          { label: "進入教練管理台", href: data.result.admin_url },
          { label: "回到 LINE", href: "https://line.me/R/ti/p/@541uwkic" },
        ],
      );
    } else {
      showResult(
        "學員權限已開通",
        `${plan.label} 已開通 ${data.result.days} 天。下一步：回到 LINE 點「學員區」或直接傳餐點照片開始記錄。`,
        false,
        [{ label: "回到 LINE 開始記錄", href: "https://line.me/R/ti/p/@541uwkic" }],
      );
    }
  } catch (error) {
    showResult("付款測試失敗", error.message || "請稍後再試一次。", true);
  } finally {
    els.pay.textContent = "測試付款並開通";
    updatePayState();
  }
}

function updatePayState() {
  const plan = selectedPlan();
  const needsCoachName = plan?.role === "coach";
  const ready =
    Boolean(state.session?.id) &&
    Boolean(els.payerName.value.trim()) &&
    Boolean(els.payerPhone.value.trim()) &&
    Boolean(els.payerEmail.value.trim()) &&
    (!needsCoachName || Boolean(els.coachName.value.trim() || state.session?.coach_name));
  els.pay.disabled = !ready;
}

function selectedPlan() {
  return state.plans.find((plan) => plan.id === state.selectedPlan);
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "讀取失敗");
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "送出失敗");
  return data;
}

function showResult(title, message, isError = false, actions = []) {
  const links = Array.isArray(actions) ? actions : actions ? [{ label: "開啟連結", href: actions }] : [];
  els.result.hidden = false;
  els.result.style.background = isError ? "#fff2f0" : "";
  els.result.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(message)}</p>
    ${
      links.length
        ? `<div class="result-actions">${links
            .map((link) => `<a href="${link.href}">${escapeHtml(link.label)}</a>`)
            .join("")}</div>`
        : ""
    }
  `;
  els.result.scrollIntoView({ behavior: "smooth", block: "center" });
}

function readableError(error) {
  const map = {
    line_login_not_configured: "LINE Login 參數還沒放進雲端環境變數。",
    line_auth_expired: "授權時間過期，請重新按 LINE 授權。",
    line_auth_failed: "LINE 授權失敗，請確認 Callback URL 與 Channel secret。",
    unknown_plan: "找不到這個付款方案。",
    coach_name_taken: "這個教練名稱已綁定其他 LINE 帳號，請聯絡 Jasper 處理。",
  };
  return map[error] || "請重新操作一次。";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
