const state = {
  users: [],
  mode: "owner",
  coach: null,
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
};

els.pin.value = localStorage.getItem("hermesAdminPin") || "";
els.refresh.addEventListener("click", () => {
  loadSummary().catch(showError);
});
els.pin.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loadSummary().catch(showError);
  }
});
els.search.addEventListener("input", renderMembers);
els.grant.addEventListener("click", grantAccess);
els.saveUser.addEventListener("click", saveUserValues);

loadSummary().catch(showError);

async function loadSummary() {
  localStorage.setItem("hermesAdminPin", els.pin.value);
  setNotice("載入中...");
  setMetrics("-");
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
  setNotice(`已載入 ${data.totals.users} 位成員。${state.mode === "coach" ? "目前是教練管理模式。" : ""}`);
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
      const quota = user.role === "coach" ? ` · 名額 ${user.student_quota || 0} 人` : "";
      const ownerLabel = user.coach_owner_id ? "教練學員" : "個人訂閱";
      return `
        <article class="member" data-name="${escapeHtml(user.display_name)}">
          <div>
            <div class="name">${escapeHtml(user.display_name)}</div>
            <div class="meta">${role} · ${ownerLabel} · ${accessText(user)}${quota}</div>
          </div>
          <div class="macro">
            目標 ${Math.round(user.goal_calories)} kcal<br>
            P${Math.round(user.goal_protein_g)} F${Math.round(user.goal_fat_g)} C${Math.round(user.goal_carbs_g)}
            ${bodyText(user)}
          </div>
          <div class="access">
            今日 ${Math.round(totals.calories)} kcal<br>
            <span class="badge ${active ? "" : "warn"}">${active ? "可使用" : "未啟用"}</span>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".member").forEach((node) => {
    node.addEventListener("click", () => fillEditor(node.dataset.name));
  });
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

function fillEditor(name) {
  const user = state.users.find((item) => item.display_name === name);
  if (!user) return;
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
  const res = await fetch(`${path}?pin=${encodeURIComponent(els.pin.value)}`);
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
  if (res.status === 401) {
    return "管理 PIN 不正確，請輸入 .env 裡的 ADMIN_PIN 後按更新。";
  }
  if (res.status === 404) {
    return "找不到這位成員。請確認 LINE 裡的設定姓名是否一致。";
  }
  if (res.status === 403) {
    return "權限不足。教練只能管理自己名下的學員，且不能給永久權限。";
  }
  return text || `載入失敗：${res.status}`;
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  setNotice(message || "載入失敗，請確認 bot 和 tunnel 是否還在執行。", true);
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

function bodyText(user) {
  if (!user.sex || !user.age || !user.height_cm || !user.weight_kg) return "";
  return `<br>${escapeHtml(user.sex)} ${Math.round(user.age)}歲 ${Math.round(user.height_cm)}cm ${Math.round(user.weight_kg)}kg`;
}

function optionalNumber(value) {
  if (value === "") return undefined;
  return Number(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
