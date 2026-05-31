const state = {
  users: [],
  payments: [],
  mode: "owner",
  coach: null,
  selectedName: "",
  weekly: null,
};

const $ = (selector) => document.querySelector(selector);
const els = {
  pin: $("#pin"),
  refresh: $("#refresh"),
  modeLine: $("#modeLine"),
  totalUsers: $("#totalUsers"),
  activeUsers: $("#activeUsers"),
  coachUsers: $("#coachUsers"),
  entryCount: $("#entryCount"),
  revenue: $("#revenue"),
  attentionList: $("#attentionList"),
  focusTitle: $("#focusTitle"),
  focusText: $("#focusText"),
  search: $("#search"),
  peopleList: $("#peopleList"),
  grantName: $("#grantName"),
  grantRole: $("#grantRole"),
  grantDuration: $("#grantDuration"),
  studentQuota: $("#studentQuota"),
  grant: $("#grant"),
  notice: $("#notice"),
  coachPinName: $("#coachPinName"),
  coachPinDuration: $("#coachPinDuration"),
  coachPinQuota: $("#coachPinQuota"),
  copyCoachCommand: $("#copyCoachCommand"),
  coachCommand: $("#coachCommand"),
  editName: $("#editName"),
  editCalories: $("#editCalories"),
  editProtein: $("#editProtein"),
  editFat: $("#editFat"),
  editCarbs: $("#editCarbs"),
  editSex: $("#editSex"),
  editAge: $("#editAge"),
  editHeight: $("#editHeight"),
  editWeight: $("#editWeight"),
  saveUser: $("#saveUser"),
  loadWeek: $("#loadWeek"),
  usageList: $("#usageList"),
  weekSummary: $("#weekSummary"),
  trend: $("#trend"),
  dayPicker: $("#dayPicker"),
  dayEntries: $("#dayEntries"),
};

const initialParams = new URLSearchParams(window.location.search);
els.pin.value = initialParams.get("pin") || localStorage.getItem("hermesAdminPin") || "";
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
els.refresh.addEventListener("click", () => loadSummary().catch(showError));
els.pin.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadSummary().catch(showError);
});
els.search.addEventListener("input", renderPeople);
els.grant.addEventListener("click", grantAccess);
els.saveUser.addEventListener("click", saveUserValues);
els.copyCoachCommand.addEventListener("click", buildCoachPinCommand);
els.loadWeek.addEventListener("click", () => loadWeeklyReview().catch(showError));

if (initialParams.get("tab")) activateTab(initialParams.get("tab"));
loadSummary().catch(showError);
setInterval(() => {
  if (!document.hidden && els.pin.value) loadSummary({ silent: true }).catch(() => {});
}, 30000);

async function loadSummary(options = {}) {
  localStorage.setItem("hermesAdminPin", els.pin.value);
  if (!options.silent) setNotice("載入中...");
  const data = await apiGet("/api/admin/summary");
  state.users = data.users || [];
  state.payments = data.payments || [];
  state.mode = data.mode || "owner";
  state.coach = data.coach || null;
  if (!state.selectedName && state.users.length) state.selectedName = state.users[0].display_name;

  els.totalUsers.textContent = data.totals.users;
  els.activeUsers.textContent = data.totals.active;
  els.coachUsers.textContent = data.totals.coaches;
  els.entryCount.textContent = data.totals.entries_7d || 0;
  els.revenue.textContent = `NT$${data.totals.revenue_test_twd || 0}`;
  els.modeLine.textContent =
    state.mode === "coach" && state.coach
      ? `你好！${state.coach.name} 教練 · 名額 ${state.coach.student_quota} 人 · ${accessText(state.coach)}`
      : "Jasper 管理員模式 · 可查看全部教練、學員與一般付費者";

  renderOverview();
  renderPeople();
  renderUsage();
  renderAccessControls();
  if (!options.silent) setNotice(`已載入 ${state.users.length} 位成員。`);
}

function activateTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${tabName}Panel`));
}

function renderOverview() {
  const expired = state.users.filter((user) => !isActive(user));
  const overToday = state.users.filter((user) => user.today_totals?.calories > user.goal_calories);
  const noRecent = state.users.filter((user) => (user.usage?.entries_7d || 0) === 0 && isActive(user));
  els.focusTitle.textContent = `${expired.length + overToday.length + noRecent.length} 件需要注意`;
  els.focusText.textContent = "優先處理到期、今日超標、以及 7 天沒有紀錄的使用者。";

  const items = [
    ...expired.slice(0, 4).map((user) => attentionItem(user, "權限到期", accessText(user))),
    ...overToday.slice(0, 4).map((user) => attentionItem(user, "今日超標", `${round(user.today_totals.calories)} / ${round(user.goal_calories)} kcal`)),
    ...noRecent.slice(0, 4).map((user) => attentionItem(user, "7 天無紀錄", "可提醒回 LINE 記錄")),
  ];
  els.attentionList.innerHTML = items.length ? items.join("") : `<div class="empty">目前沒有急件。可以查看成員或使用程度。</div>`;
}

function attentionItem(user, label, detail) {
  return `
    <button class="attention-item" data-name="${escapeHtml(user.display_name)}" type="button">
      <strong>${escapeHtml(user.display_name)}</strong>
      <span>${label}</span>
      <em>${detail}</em>
    </button>
  `;
}

function renderPeople() {
  const query = els.search.value.trim().toLowerCase();
  const users = state.users.filter((user) => user.display_name.toLowerCase().includes(query));
  els.peopleList.innerHTML = users.length
    ? users.map(personCard).join("")
    : `<div class="empty">沒有符合的成員。</div>`;

  document.querySelectorAll("[data-name]").forEach((node) => {
    node.addEventListener("click", () => selectUser(node.dataset.name));
  });
  document.querySelectorAll(".delete-member").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteMember(button.dataset.name).catch(showError);
    });
  });
}

function personCard(user) {
  const canDelete = state.mode === "owner" && user.role !== "owner";
  return `
    <article class="person-card ${state.selectedName === user.display_name ? "selected" : ""}" data-name="${escapeHtml(user.display_name)}">
      <div class="person-head">
        <div>
          <strong>${escapeHtml(user.display_name)}</strong>
          <span>${roleLabel(user)} · ${accessText(user)}${user.role === "coach" ? ` · 名額 ${user.student_quota || 0}` : ""}</span>
        </div>
        <div class="person-actions">
          <b class="${isActive(user) ? "ok" : "warn"}">${isActive(user) ? "可使用" : "停用/到期"}</b>
          ${canDelete ? `<button class="delete-member" data-name="${escapeHtml(user.display_name)}" type="button">刪除</button>` : ""}
        </div>
      </div>
      <div class="macro-row">
        ${macroMini("熱量", user.today_totals.calories, user.goal_calories, "kcal")}
        ${macroMini("蛋白", user.today_totals.protein_g, user.goal_protein_g, "g")}
        ${macroMini("脂質", user.today_totals.fat_g, user.goal_fat_g, "g")}
        ${macroMini("碳水", user.today_totals.carbs_g, user.goal_carbs_g, "g")}
      </div>
      <div class="food-strip">
        ${(user.today_entries || []).slice(-2).reverse().map((entry) => `<span>${escapeHtml(entry.food_name)} · ${round(entry.calories)} kcal</span>`).join("") || "<span>今日尚無紀錄</span>"}
      </div>
    </article>
  `;
}

function renderUsage() {
  const rows = [...state.users].sort((a, b) => (b.usage?.entries_7d || 0) - (a.usage?.entries_7d || 0));
  els.usageList.innerHTML = rows.length
    ? rows.map((user) => `
      <button class="usage-row" data-name="${escapeHtml(user.display_name)}" type="button">
        <strong>${escapeHtml(user.display_name)}</strong>
        <span>${roleLabel(user)}</span>
        <span>${user.usage?.entries_7d || 0} 筆</span>
        <span>${round(user.usage?.calories_7d || 0)} kcal</span>
        <span>${accessText(user)}</span>
      </button>
    `).join("")
    : `<div class="empty">尚無資料。</div>`;
  els.usageList.querySelectorAll("[data-name]").forEach((node) => {
    node.addEventListener("click", () => {
      selectUser(node.dataset.name);
      loadWeeklyReview().catch(showError);
    });
  });
}

async function loadWeeklyReview() {
  const name = state.selectedName || els.editName.value.trim();
  if (!name) {
    setNotice("請先選擇一位成員。", true);
    return;
  }
  const data = await apiGet(`/api/admin/weekly?name=${encodeURIComponent(name)}`);
  state.weekly = data;
  renderWeekly(data);
}

function renderWeekly(data) {
  const balance = Math.round(-data.week_totals.surplus_calories);
  els.weekSummary.innerHTML = `
    <article><span>區間</span><strong>${shortDate(data.start_date)} - ${shortDate(data.end_date)}</strong></article>
    <article><span>總熱量</span><strong>${round(data.week_totals.calories)} kcal</strong></article>
    <article><span>週赤字</span><strong>${balanceText(balance)}</strong></article>
    <article><span>三大營養素</span><strong>P${round(data.week_totals.protein_g)} F${round(data.week_totals.fat_g)} C${round(data.week_totals.carbs_g)}</strong></article>
  `;
  const max = Math.max(data.user.goal_calories, ...data.days.map((day) => day.totals.calories), 1);
  els.trend.innerHTML = data.days.map((day) => {
    const height = Math.max(8, Math.round((day.totals.calories / max) * 100));
    const over = day.totals.calories > data.user.goal_calories;
    return `<button class="${over ? "over" : ""}" data-date="${day.date}" style="--h:${height}%" type="button"><i></i><span>${round(day.totals.calories)}</span><small>${weekday(day.date)}</small></button>`;
  }).join("");
  els.dayPicker.innerHTML = data.days.map((day) => `<button data-date="${day.date}" type="button">${shortDate(day.date)}<span>${round(day.totals.calories)} kcal</span></button>`).join("");
  [...els.trend.querySelectorAll("button"), ...els.dayPicker.querySelectorAll("button")].forEach((button) => {
    button.addEventListener("click", () => renderDayEntries(data.days.find((day) => day.date === button.dataset.date)));
  });
  renderDayEntries(data.days.at(-1));
}

function renderDayEntries(day) {
  els.dayEntries.innerHTML = day.entries.length
    ? day.entries.map((entry) => `<article><strong>${escapeHtml(entry.food_name)}</strong><span>${round(entry.calories)} kcal · P${round(entry.protein_g)} F${round(entry.fat_g)} C${round(entry.carbs_g)}</span><small>${escapeHtml(entry.notes || entry.source)}</small></article>`).join("")
    : `<div class="empty">${shortDate(day.date)} 沒有紀錄。</div>`;
}

function selectUser(name) {
  const user = state.users.find((item) => item.display_name === name);
  if (!user) return;
  state.selectedName = user.display_name;
  els.grantName.value = user.display_name;
  els.editName.value = user.display_name;
  els.editCalories.value = round(user.goal_calories);
  els.editProtein.value = round(user.goal_protein_g);
  els.editFat.value = round(user.goal_fat_g);
  els.editCarbs.value = round(user.goal_carbs_g);
  els.editSex.value = user.sex || "";
  els.editAge.value = user.age || "";
  els.editHeight.value = user.height_cm || "";
  els.editWeight.value = user.weight_kg || "";
  renderPeople();
}

async function grantAccess() {
  const body = {
    pin: els.pin.value,
    name: els.grantName.value.trim(),
    role: els.grantRole.value,
    duration: els.grantDuration.value,
    studentQuota: Number(els.studentQuota.value || 10),
  };
  if (!body.name) return setNotice("請輸入成員姓名。", true);
  await apiPost("/api/admin/grant", body);
  setNotice("權限已更新。");
  await loadSummary();
}

async function saveUserValues() {
  const body = {
    pin: els.pin.value,
    name: els.editName.value.trim(),
    calories: optionalNumber(els.editCalories.value),
    protein: optionalNumber(els.editProtein.value),
    fat: optionalNumber(els.editFat.value),
    carbs: optionalNumber(els.editCarbs.value),
    sex: els.editSex.value,
    age: optionalNumber(els.editAge.value),
    height: optionalNumber(els.editHeight.value),
    weight: optionalNumber(els.editWeight.value),
  };
  if (!body.name) return setNotice("請輸入成員姓名。", true);
  await apiPost("/api/admin/update-user", body);
  setNotice("目標與身體資料已更新。");
  await loadSummary();
}

async function deleteMember(name) {
  if (!window.confirm(`確定刪除「${name}」嗎？\n教練被刪除時，名下學員只會解除綁定。`)) return;
  await apiPost("/api/admin/delete-user", { name });
  if (state.selectedName === name) state.selectedName = "";
  setNotice(`已刪除 ${name}。`);
  await loadSummary();
}

function buildCoachPinCommand() {
  const name = els.coachPinName.value.trim() || "Coach";
  const command = `產生教練PIN ${name} ${els.coachPinDuration.value} ${Number(els.coachPinQuota.value || 10)}人`;
  els.coachCommand.textContent = command;
  navigator.clipboard?.writeText(command).catch(() => {});
}

function renderAccessControls() {
  const isCoach = state.mode === "coach";
  els.grantRole.value = "student";
  els.grantRole.disabled = isCoach;
  els.studentQuota.disabled = isCoach;
  const maxDays = state.coach?.max_grant_days;
  [...els.grantDuration.options].forEach((option) => {
    const days = option.value === "7" ? 7 : option.value === "30" ? 30 : option.value === "365" ? 365 : null;
    option.disabled =
      isCoach &&
      (option.value === "permanent" ||
        option.value === "disabled" ||
        (typeof maxDays === "number" && days !== null && days > maxDays));
  });
}

async function apiGet(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}pin=${encodeURIComponent(els.pin.value)}`);
  if (!response.ok) throw new Error(await friendlyError(response));
  return response.json();
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-pin": els.pin.value },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await friendlyError(response));
  return response.json();
}

async function friendlyError(response) {
  const text = await response.text();
  try {
    return JSON.parse(text).error || text;
  } catch {
    return response.status === 401 ? "PIN 不正確，請確認管理 PIN 或教練 PIN。" : text;
  }
}

function showError(error) {
  setNotice(error instanceof Error ? error.message : String(error), true);
}

function setNotice(message, isError = false) {
  els.notice.textContent = message;
  els.notice.classList.toggle("error", isError);
}

function roleLabel(user) {
  if (user.role === "owner") return "最高權限";
  if (user.role === "coach") return "教練";
  return user.coach_owner_id ? "教練學員" : "一般學員";
}

function isActive(user) {
  return user.role === "owner" || user.role === "coach" || user.permanent_access || (user.access_expires_at && user.access_expires_at > Date.now());
}

function accessText(user) {
  if (user.role === "owner" || user.permanent_access) return "永久";
  const expires = user.access_expires_at || user.expires_at;
  if (!expires) return "未開通";
  if (expires <= Date.now()) return "已到期";
  return `到期 ${new Date(expires).toLocaleDateString("zh-TW")}`;
}

function macroMini(label, value, goal, unit) {
  const over = value > goal;
  return `<span class="${over ? "over" : ""}">${label}<b>${round(value)} / ${round(goal)}${unit}</b></span>`;
}

function balanceText(value) {
  const rounded = round(value);
  return rounded >= 0 ? `赤字 ${rounded} kcal` : `盈餘 ${Math.abs(rounded)} kcal`;
}

function optionalNumber(value) {
  return value === "" ? undefined : Number(value);
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
