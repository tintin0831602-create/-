const state = {
  token: new URLSearchParams(window.location.search).get("token") || localStorage.getItem("hermesAppToken") || "",
  data: null,
  selectedDay: null,
};

const $ = (selector) => document.querySelector(selector);
const els = {
  loginView: $("#loginView"),
  dashboardView: $("#dashboardView"),
  loginHint: $("#loginHint"),
  welcomeTitle: $("#welcomeTitle"),
  accessLine: $("#accessLine"),
  logoutButton: $("#logoutButton"),
  studentTab: $("#studentTab"),
  coachTab: $("#coachTab"),
  studentView: $("#studentView"),
  coachView: $("#coachView"),
  todayCalories: $("#todayCalories"),
  todayBalance: $("#todayBalance"),
  dayBalance: $("#dayBalance"),
  selectedDate: $("#selectedDate"),
  macroQuadrants: $("#macroQuadrants"),
  dayEntries: $("#dayEntries"),
  weekBalance: $("#weekBalance"),
  weekMacros: $("#weekMacros"),
  weekChart: $("#weekChart"),
  daySelector: $("#daySelector"),
  studentCount: $("#studentCount"),
  studentQuota: $("#studentQuota"),
  coachTodayCalories: $("#coachTodayCalories"),
  coachWeekDeficit: $("#coachWeekDeficit"),
  coachAdminLink: $("#coachAdminLink"),
  studentCards: $("#studentCards"),
};

document.querySelectorAll(".segment button").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.view));
});

els.logoutButton.addEventListener("click", () => {
  localStorage.removeItem("hermesAppToken");
  window.location.href = "/app/";
});

if (new URLSearchParams(window.location.search).get("token")) {
  localStorage.setItem("hermesAppToken", state.token);
  window.history.replaceState({}, "", "/app/");
}

load().catch(showLoginError);
setInterval(() => {
  if (!document.hidden && state.token) load({ silent: true }).catch(() => {});
}, 30000);

async function load() {
  if (!state.token) {
    showLogin();
    return;
  }
  const response = await fetch("/api/app/summary", {
    headers: { authorization: `Bearer ${state.token}` },
  });
  if (!response.ok) {
    localStorage.removeItem("hermesAppToken");
    throw new Error(await response.text());
  }
  state.data = await response.json();
  state.selectedDay = state.data.self.days.at(-1);
  render();
}

function render() {
  const data = state.data;
  els.loginView.hidden = true;
  els.dashboardView.hidden = false;
  els.welcomeTitle.textContent = `你好，${data.viewer.display_name}`;
  els.accessLine.textContent = `${roleLabel(data.viewer)} · ${accessText(data.viewer)}`;

  const isCoach = data.viewer.role === "coach" || data.viewer.role === "owner";
  const canCoach = isCoach || data.students.length > 0;
  els.studentTab.hidden = isCoach;
  els.coachTab.hidden = !canCoach;
  renderStudentDashboard(data.self);
  if (canCoach) {
    renderCoachDashboard(data);
    activateView("coach");
  } else {
    activateView("student");
  }
}

function renderStudentDashboard(dashboard) {
  const user = dashboard.user;
  const today = dashboard.days.at(-1);
  const todayTotals = dashboard.today_totals;
  els.todayCalories.textContent = `${round(todayTotals.calories)} kcal`;
  els.todayBalance.textContent = balanceText(user.goal_calories - todayTotals.calories);
  els.dayBalance.textContent = balanceText((state.selectedDay || today).deficit_calories);
  els.weekBalance.textContent = balanceText(dashboard.week_totals.deficit_calories, "本週");
  els.weekMacros.textContent = `P${round(dashboard.week_totals.protein_g)} / F${round(dashboard.week_totals.fat_g)} / C${round(dashboard.week_totals.carbs_g)}`;

  els.macroQuadrants.innerHTML = [
    macroCard("熱量", todayTotals.calories, user.goal_calories, "kcal", "calories"),
    macroCard("蛋白質", todayTotals.protein_g, user.goal_protein_g, "g", "protein"),
    macroCard("脂質", todayTotals.fat_g, user.goal_fat_g, "g", "fat"),
    macroCard("碳水", todayTotals.carbs_g, user.goal_carbs_g, "g", "carbs"),
  ].join("");

  renderWeekChart(dashboard);
  renderDaySelector(dashboard);
  renderDayEntries(state.selectedDay || today);
}

function renderWeekChart(dashboard) {
  const max = Math.max(dashboard.user.goal_calories, ...dashboard.days.map((day) => day.totals.calories), 1);
  els.weekChart.innerHTML = dashboard.days
    .map((day) => {
      const height = Math.max(8, Math.round((day.totals.calories / max) * 100));
      const over = day.totals.calories > dashboard.user.goal_calories;
      return `
        <button class="${over ? "over" : ""}" style="--h:${height}%" data-date="${day.date}" type="button">
          <i></i>
          <span>${round(day.totals.calories)}</span>
          <small>${weekday(day.date)}</small>
        </button>
      `;
    })
    .join("");
  els.weekChart.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectDay(dashboard, button.dataset.date));
  });
}

function renderDaySelector(dashboard) {
  els.daySelector.innerHTML = dashboard.days
    .map((day) => `
      <button class="${state.selectedDay?.date === day.date ? "active" : ""}" data-date="${day.date}" type="button">
        ${shortDate(day.date)}
        <span>${balanceText(day.deficit_calories)}</span>
      </button>
    `)
    .join("");
  els.daySelector.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectDay(dashboard, button.dataset.date));
  });
}

function selectDay(dashboard, date) {
  state.selectedDay = dashboard.days.find((day) => day.date === date) || dashboard.days.at(-1);
  renderStudentDashboard(dashboard);
}

function renderDayEntries(day) {
  els.selectedDate.textContent = `${shortDate(day.date)} ${weekday(day.date)}`;
  if (!day.entries.length) {
    els.dayEntries.innerHTML = `<div class="empty">這天還沒有紀錄。回 LINE 傳餐點照片或文字就會出現在這裡。</div>`;
    return;
  }
  els.dayEntries.innerHTML = day.entries
    .map((entry) => `
      <article>
        <strong>${escapeHtml(entry.food_name)}</strong>
        <span>${round(entry.calories)} kcal · P${round(entry.protein_g)} F${round(entry.fat_g)} C${round(entry.carbs_g)}</span>
        <small>${escapeHtml(entry.notes || entry.source)}</small>
      </article>
    `)
    .join("");
}

function renderCoachDashboard(data) {
  const students = data.students;
  const quota = data.coach?.student_quota || data.viewer.student_quota || 0;
  const totalToday = students.reduce((total, item) => total + item.today_totals.calories, 0);
  const totalDeficit = students.reduce((total, item) => total + item.week_totals.deficit_calories, 0);
  els.studentCount.textContent = students.length;
  els.studentQuota.textContent = `名額 ${quota} 人`;
  els.coachTodayCalories.textContent = `${round(totalToday)} kcal`;
  els.coachWeekDeficit.textContent = balanceText(totalDeficit);
  if (data.coach?.admin_url) els.coachAdminLink.href = data.coach.admin_url;

  els.studentCards.innerHTML = students.length
    ? students.map(studentCard).join("")
    : `<div class="empty">目前還沒有綁定學員。請在 LINE 用「教練授權 學員姓名 7天」或到管理台授權。</div>`;
}

function studentCard(dashboard) {
  const user = dashboard.user;
  const today = dashboard.today_totals;
  return `
    <article class="student-card">
      <div>
        <strong>${escapeHtml(user.display_name)}</strong>
        <span>${accessText(user)}</span>
      </div>
      <div class="mini-macros">
        ${miniMacro("熱量", today.calories, user.goal_calories, "kcal")}
        ${miniMacro("蛋白", today.protein_g, user.goal_protein_g, "g")}
        ${miniMacro("脂質", today.fat_g, user.goal_fat_g, "g")}
        ${miniMacro("碳水", today.carbs_g, user.goal_carbs_g, "g")}
      </div>
      <div class="student-week">
        <span>本週 ${round(dashboard.week_totals.calories)} kcal</span>
        <strong>${balanceText(dashboard.week_totals.deficit_calories)}</strong>
      </div>
    </article>
  `;
}

function activateView(view) {
  document.querySelectorAll(".segment button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  els.studentView.classList.toggle("active", view === "student");
  els.coachView.classList.toggle("active", view === "coach");
}

function macroCard(label, value, goal, unit, kind) {
  const ratio = Math.round(((Number(value) || 0) / Math.max(Number(goal) || 1, 1)) * 100);
  const over = value > goal;
  return `
    <article class="quad ${kind} ${over ? "over" : ""}">
      <span>${label}</span>
      <strong>${round(value)}${unit}</strong>
      <small>目標 ${round(goal)}${unit}</small>
      <i style="--p:${Math.min(ratio, 140)}%"></i>
    </article>
  `;
}

function miniMacro(label, value, goal, unit) {
  const over = value > goal;
  return `<span class="${over ? "over" : ""}">${label}<b>${round(value)}/${round(goal)}${unit}</b></span>`;
}

function showLogin() {
  els.loginView.hidden = false;
  els.dashboardView.hidden = true;
}

function showLoginError(error) {
  showLogin();
  els.loginHint.textContent = friendlyError(error);
}

function roleLabel(user) {
  if (user.role === "owner") return "最高權限";
  if (user.role === "coach") return "教練";
  return "學員";
}

function accessText(user) {
  if (user.role === "owner" || user.permanent_access) return "永久使用";
  if (!user.access_expires_at) return "尚未開通";
  if (user.access_expires_at <= Date.now()) return "已到期";
  return `到期 ${new Date(user.access_expires_at).toLocaleDateString("zh-TW")}`;
}

function balanceText(value, prefix = "") {
  const rounded = round(value);
  const label = rounded >= 0 ? `赤字 ${rounded}` : `盈餘 ${Math.abs(rounded)}`;
  return `${prefix ? `${prefix} ` : ""}${label} kcal`;
}

function friendlyError(error) {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("line_login_not_configured")) return "LINE Login 尚未設定完成。";
  return "登入狀態已過期，請重新用 LINE 登入。";
}

function shortDate(date) {
  return date.slice(5).replace("-", "/");
}

function weekday(date) {
  return new Date(`${date}T00:00:00+08:00`).toLocaleDateString("zh-TW", { weekday: "short" });
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
