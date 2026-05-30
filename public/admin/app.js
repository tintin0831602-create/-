const state = {
  users: [],
  mode: "owner",
  coach: null,
  weekly: null,
  selectedName: "",
};

const els = {
  pin: document.querySelector("#pin"),
  refresh: document.querySelector("#refresh"),
  totalUsers: document.querySelector("#totalUsers"),
  coachInfo: document.querySelector("#coachInfo"),
  activeUsers: document.querySelector("#activeUsers"),
  coachUsers: document.querySelector("#coachUsers"),
  today: document.querySelector("#today"),
  members: document.querySelector("#members"),
  search: document.querySelector("#search"),
  grantName: document.querySelector("#grantName"),
  grantRole: document.querySelector("#grantRole"),
  studentQuota: document.querySelector("#studentQuota"),
  grantDuration: document.querySelector("#grantDuration"),
  grant: document.querySelector("#grant"),
  notice: document.querySelector("#notice"),
  editName: document.querySelector("#editName"),
  editCalories: document.querySelector("#editCalories"),
  editProtein: document.querySelector("#editProtein"),
  editFat: document.querySelector("#editFat"),
  editCarbs: document.querySelector("#editCarbs"),
  editSex: document.querySelector("#editSex"),
  editAge: document.querySelector("#editAge"),
  editHeight: document.querySelector("#editHeight"),
  editWeight: document.querySelector("#editWeight"),
  saveUser: document.querySelector("#saveUser"),
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),
  guideCards: document.querySelectorAll(".guide-card"),
  guideOutput: document.querySelector("#guideOutput"),
  loadWeek: document.querySelector("#loadWeek"),
  weekSummary: document.querySelector("#weekSummary"),
  trend: document.querySelector("#trend"),
  dayPicker: document.querySelector("#dayPicker"),
  dayEntries: document.querySelector("#dayEntries"),
  coachPinName: document.querySelector("#coachPinName"),
  coachPinDuration: document.querySelector("#coachPinDuration"),
  coachPinQuota: document.querySelector("#coachPinQuota"),
  copyCoachCommand: document.querySelector("#copyCoachCommand"),
  coachCommand: document.querySelector("#coachCommand"),
};

const initialParams = new URLSearchParams(window.location.search);
els.pin.value = initialParams.get("pin") || localStorage.getItem("hermesAdminPin") || "";
els.refresh.addEventListener("click", () => loadSummary().catch(showError));
els.pin.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadSummary().catch(showError);
});
els.search.addEventListener("input", renderMembers);
els.grant.addEventListener("click", grantAccess);
els.saveUser.addEventListener("click", saveUserValues);
els.loadWeek.addEventListener("click", () => loadWeeklyReview().catch(showError));
els.copyCoachCommand.addEventListener("click", buildCoachPinCommand);
els.tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
els.guideCards.forEach((card) =>
  card.addEventListener("click", () => {
    els.guideOutput.textContent = card.dataset.template;
    navigator.clipboard?.writeText(card.dataset.template).catch(() => {});
  }),
);

if (initialParams.get("tab")) {
  activateTab(initialParams.get("tab"));
}

loadSummary().catch(showError);
setInterval(() => {
  if (document.visibilityState === "visible" && els.pin.value) {
    loadSummary({ silent: true }).catch(() => {});
  }
}, 30000);

async function loadSummary(options = {}) {
  localStorage.setItem("hermesAdminPin", els.pin.value);
  if (!options.silent) setNotice("載入中...");
  if (!options.silent) setMetrics("-");
  const data = await apiGet("/api/admin/summary");
  state.users = data.users;
  state.mode = data.mode || "owner";
  state.coach = data.coach || null;
  els.totalUsers.textContent = data.totals.users;
  els.activeUsers.textContent = data.totals.active;
  els.coachUsers.textContent = data.totals.coaches;
  els.today.textContent = data.today.replaceAll("-", "/");
  renderMembers();
  renderCoachInfo();
  renderAccessControls();
  if (!state.selectedName && state.users.length) {
    state.selectedName = state.users[0].display_name;
  }
  if (!options.silent) {
    setNotice(`已載入 ${data.totals.users} 位成員。${state.mode === "coach" ? "目前是教練管理模式。" : ""}`);
  }
}

function activateTab(tabName) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tabName}Panel`));
}

function renderCoachInfo() {
  if (state.mode !== "coach" || !state.coach) {
    els.coachInfo.hidden = true;
    els.coachInfo.innerHTML = "";
    return;
  }
  const expiry = state.coach.permanent_access
    ? "永久"
    : state.coach.expires_at
      ? `到期 ${new Date(state.coach.expires_at).toLocaleDateString("zh-TW")}`
      : "未啟用";
  const maxGrant =
    state.coach.max_grant_days === null
      ? "可發 7 天、30 天、一年"
      : state.coach.max_grant_days >= 365
        ? "可發 7 天、30 天、一年"
        : state.coach.max_grant_days >= 30
          ? "可發 7 天、30 天"
          : state.coach.max_grant_days >= 7
            ? "可發 7 天"
            : "目前不可發新權限";
  els.coachInfo.hidden = false;
  els.coachInfo.innerHTML = `
    <span>你好！${escapeHtml(state.coach.name)} 教練</span>
    <strong>${expiry}</strong>
    <small>學員名額 ${state.coach.student_quota} 人 · ${maxGrant}</small>
  `;
}

function renderMembers() {
  const query = els.search.value.trim().toLowerCase();
  const users = state.users.filter((user) => user.display_name.toLowerCase().includes(query));
  if (!users.length) {
    els.members.innerHTML = `
      <div class="empty">
        <strong>目前沒有可顯示的成員</strong>
        <span>如果剛進來是空的，請先輸入管理 PIN 後按「更新」。</span>
      </div>
    `;
    return;
  }

  els.members.innerHTML = users
    .map((user) => {
      const role = user.role === "owner" ? "最高權限" : user.role === "coach" ? "教練" : "學員";
      const active = isActive(user);
      const totals = user.today_totals;
      const entries = user.today_entries || [];
      const quota = user.role === "coach" ? ` · 名額 ${user.student_quota || 0} 人` : "";
      const ownerLabel = user.coach_owner_id ? "教練學員" : "個人訂閱";
      const selected = user.display_name === state.selectedName;
      const canDelete = state.mode === "owner" && user.role !== "owner";
      return `
        <article class="member ${selected ? "selected" : ""}" data-name="${escapeHtml(user.display_name)}">
          <div class="member-main">
            <div>
              <div class="name">${escapeHtml(user.display_name)}</div>
              <div class="meta">${role} · ${ownerLabel} · ${accessText(user)}${quota}</div>
            </div>
            <div class="member-actions">
              <span class="badge ${active ? "" : "warn"}">${active ? "可使用" : "未啟用"}</span>
              ${canDelete ? `<button class="delete-member" data-name="${escapeHtml(user.display_name)}" type="button">刪除</button>` : ""}
            </div>
          </div>
          <div class="macro-grid">
            ${macroTile("熱量", totals.calories, user.goal_calories, "kcal", "calories")}
            ${macroTile("蛋白", totals.protein_g, user.goal_protein_g, "g", "protein")}
            ${macroTile("脂肪", totals.fat_g, user.goal_fat_g, "g", "fat")}
            ${macroTile("碳水", totals.carbs_g, user.goal_carbs_g, "g", "carbs")}
          </div>
          <div class="today-foods">
            <strong>今日吃了什麼</strong>
            ${
              entries.length
                ? entries.slice(-3).reverse().map((entry) => `
                    <p>
                      <span>${escapeHtml(entry.food_name)}</span>
                      <em>${Math.round(entry.calories)} kcal · P${Math.round(entry.protein_g)} F${Math.round(entry.fat_g)} C${Math.round(entry.carbs_g)}</em>
                    </p>
                  `).join("")
                : `<p><span>尚無紀錄</span><em>學員上傳後 30 秒內會自動刷新</em></p>`
            }
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".member").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedName = node.dataset.name;
      fillEditor(node.dataset.name);
      renderMembers();
      loadWeeklyReview().catch(showError);
    });
  });
  document.querySelectorAll(".delete-member").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteMember(button.dataset.name).catch(showError);
    });
  });
}

async function loadWeeklyReview() {
  const name = els.editName.value.trim() || state.users[0]?.display_name || "";
  if (!name) {
    setNotice("請先選擇一位學員。", true);
    return;
  }
  const data = await apiGet(`/api/admin/weekly?name=${encodeURIComponent(name)}`);
  state.weekly = data;
  renderWeeklyReview(data);
}

function renderWeeklyReview(data) {
  const surplus = Math.round(data.week_totals.surplus_calories);
  const surplusText = surplus >= 0 ? `盈餘 ${surplus} kcal` : `赤字 ${Math.abs(surplus)} kcal`;
  els.weekSummary.innerHTML = `
    <div><span>區間</span><strong>${formatShortDate(data.start_date)} - ${formatShortDate(data.end_date)}</strong></div>
    <div><span>本週熱量</span><strong>${Math.round(data.week_totals.calories)} kcal</strong></div>
    <div><span>熱量盈虧</span><strong class="${surplus >= 0 ? "surplus" : "deficit"}">${surplusText}</strong></div>
    <div><span>三大營養素</span><strong>P${Math.round(data.week_totals.protein_g)} F${Math.round(data.week_totals.fat_g)} C${Math.round(data.week_totals.carbs_g)}</strong></div>
  `;
  renderTrend(data);
  renderDayPicker(data);
  renderDayEntries(data.days[data.days.length - 1]);
}

function renderTrend(data) {
  const maxValue = Math.max(data.user.goal_calories, ...data.days.map((day) => day.totals.calories), 1);
  els.trend.innerHTML = data.days
    .map((day) => {
      const height = Math.max(8, Math.round((day.totals.calories / maxValue) * 100));
      const over = day.totals.calories > data.user.goal_calories;
      return `
        <button class="bar ${over ? "over" : ""}" data-date="${day.date}" style="--h:${height}%">
          <span>${Math.round(day.totals.calories)}</span>
          <small>${weekday(day.date)}</small>
        </button>
      `;
    })
    .join("");
  els.trend.querySelectorAll(".bar").forEach((bar) => {
    bar.addEventListener("click", () => {
      const day = data.days.find((item) => item.date === bar.dataset.date);
      if (day) renderDayEntries(day);
    });
  });
}

function renderDayPicker(data) {
  els.dayPicker.innerHTML = data.days
    .map(
      (day) => `
        <button data-date="${day.date}">
          ${formatShortDate(day.date)}
          <span>${Math.round(day.totals.calories)} kcal</span>
        </button>
      `,
    )
    .join("");
  els.dayPicker.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const day = data.days.find((item) => item.date === button.dataset.date);
      if (day) renderDayEntries(day);
    });
  });
}

function renderDayEntries(day) {
  if (!day) return;
  const surplus = Math.round(day.surplus_calories);
  els.dayEntries.innerHTML = `
    <div class="day-head">
      <strong>${formatShortDate(day.date)}</strong>
      <span>${Math.round(day.totals.calories)} kcal / P${Math.round(day.totals.protein_g)} F${Math.round(day.totals.fat_g)} C${Math.round(day.totals.carbs_g)}</span>
      <em>${surplus >= 0 ? `盈餘 ${surplus}` : `赤字 ${Math.abs(surplus)}`} kcal</em>
    </div>
    ${
      day.entries.length
        ? day.entries
            .map(
              (entry) => `
                <article class="food-entry">
                  <strong>${escapeHtml(entry.food_name)}</strong>
                  <span>${Math.round(entry.calories)} kcal · P${Math.round(entry.protein_g)} F${Math.round(entry.fat_g)} C${Math.round(entry.carbs_g)}</span>
                  <small>${escapeHtml(entry.notes || entry.source)}</small>
                </article>
              `,
            )
            .join("")
        : `<div class="empty compact"><strong>這天沒有紀錄</strong><span>學員可在 LINE 傳照片或「紀錄文字」。</span></div>`
    }
  `;
}

async function grantAccess() {
  const body = {
    pin: els.pin.value,
    name: els.grantName.value.trim(),
    role: els.grantRole.value,
    studentQuota: Number(els.studentQuota.value || 10),
    duration: els.grantDuration.value,
  };
  if (!body.name) {
    setNotice("請輸入成員姓名。", true);
    return;
  }
  try {
    await apiPost("/api/admin/grant", body);
    setNotice("授權已更新。");
    await loadSummary();
  } catch (error) {
    showError(error);
  }
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
  if (!body.name) {
    setNotice("請輸入學員姓名。", true);
    return;
  }
  try {
    await apiPost("/api/admin/update-user", body);
    setNotice("學員數值已更新。");
    await loadSummary();
  } catch (error) {
    showError(error);
  }
}

async function deleteMember(name) {
  if (!name) return;
  const confirmed = window.confirm(`確定要刪除「${name}」嗎？\n\n教練被刪除時，名下學員會解除綁定但不會一起刪除。`);
  if (!confirmed) {
    return;
  }
  await apiPost("/api/admin/delete-user", { name });
  if (state.selectedName === name) {
    state.selectedName = "";
    els.editName.value = "";
  }
  setNotice(`已刪除 ${name}。`);
  await loadSummary();
}

function fillEditor(name) {
  const user = state.users.find((item) => item.display_name === name);
  if (!user) return;
  state.selectedName = user.display_name;
  els.editName.value = user.display_name;
  els.grantName.value = user.display_name;
  els.editCalories.value = Math.round(user.goal_calories);
  els.editProtein.value = Math.round(user.goal_protein_g);
  els.editFat.value = Math.round(user.goal_fat_g);
  els.editCarbs.value = Math.round(user.goal_carbs_g);
  els.editSex.value = user.sex || "";
  els.editAge.value = user.age || "";
  els.editHeight.value = user.height_cm || "";
  els.editWeight.value = user.weight_kg || "";
}

function buildCoachPinCommand() {
  const name = els.coachPinName.value.trim() || "Coach";
  const duration = els.coachPinDuration.value;
  const quota = Number(els.coachPinQuota.value || 10);
  const command = `產生教練PIN ${name} ${duration} ${quota}人`;
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
  if (isCoach && els.grantDuration.selectedOptions[0]?.disabled) {
    const firstAllowed = [...els.grantDuration.options].find((option) => !option.disabled);
    els.grantDuration.value = firstAllowed?.value || "7";
  }
}

async function apiGet(path) {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${separator}pin=${encodeURIComponent(els.pin.value)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-pin": els.pin.value },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await friendlyError(res));
  }
  return res.json();
}

async function friendlyError(res) {
  const text = await res.text();
  let serverMessage = text;
  try {
    serverMessage = JSON.parse(text).error || text;
  } catch {
    serverMessage = text;
  }
  if (res.status === 401) {
    return "管理 PIN 不正確，請輸入 Render 裡的 ADMIN_PIN 後按更新。";
  }
  if (res.status === 404) {
    return "找不到這位成員。請確認 LINE 裡的設定姓名是否一致。";
  }
  if (res.status === 403) {
    return serverMessage || "權限不足。教練只能管理自己名下的學員，且不能給永久權限。";
  }
  return serverMessage || `載入失敗：${res.status}`;
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  setNotice(message || "載入失敗，請確認服務是否正常。", true);
  if (!state.users.length) {
    setMetrics("-");
    els.members.innerHTML = `
      <div class="empty">
        <strong>資料尚未載入</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
  }
}

function setMetrics(value) {
  els.totalUsers.textContent = value;
  els.activeUsers.textContent = value;
  els.coachUsers.textContent = value;
  els.today.textContent = value;
}

function setNotice(message, isError = false) {
  els.notice.textContent = message;
  els.notice.classList.toggle("error", isError);
}

function isActive(user) {
  return (
    user.role === "owner" ||
    user.role === "coach" ||
    user.permanent_access ||
    (user.access_expires_at && user.access_expires_at > Date.now())
  );
}

function accessText(user) {
  if (user.role === "owner" || user.permanent_access) return "永久";
  if (!user.access_expires_at) return "未啟用";
  if (user.access_expires_at <= Date.now()) return "已到期";
  return `到期 ${new Date(user.access_expires_at).toLocaleDateString("zh-TW")}`;
}

function macroTile(label, current, goal, unit, kind) {
  const safeGoal = Math.max(Number(goal) || 0, 1);
  const value = Number(current) || 0;
  const percent = Math.min(140, Math.round((value / safeGoal) * 100));
  const over = value > safeGoal;
  return `
    <div class="macro-tile ${kind} ${over ? "over" : ""}">
      <span>${label}</span>
      <strong>${Math.round(value)}<small>${unit}</small></strong>
      <em>/ ${Math.round(safeGoal)}${unit}</em>
      <i style="--p:${percent}%"></i>
    </div>
  `;
}

function bodyText(user) {
  if (!user.sex || !user.age || !user.height_cm || !user.weight_kg) return "";
  return `<br>${escapeHtml(user.sex)} ${Math.round(user.age)}歲 ${Math.round(user.height_cm)}cm ${Math.round(user.weight_kg)}kg`;
}

function optionalNumber(value) {
  if (value === "") return undefined;
  return Number(value);
}

function formatShortDate(date) {
  return date.slice(5).replace("-", "/");
}

function weekday(date) {
  return new Date(`${date}T00:00:00+08:00`).toLocaleDateString("zh-TW", { weekday: "short" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
