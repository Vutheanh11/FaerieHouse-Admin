const API = "https://faerienews-backend.onrender.com";
const FRONTEND = "https://faeriehouse.onrender.com/";
const SESSION_KEY = "faerie-admin-session-v1";

const state = {
  view: "members",
  members: [],
  news: [],
  posts: [],
  popup: null,
  selectedMemberIndex: null,
  session: "",
  role: "",
  accountType: "",
  username: "",
  mfaEnabled: false,
  mfaSetupToken: "",
  campus: "hcm",
  editingPostId: null,
  shas: { members: "", posts: "", popup: "" },
  busy: false,
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const safeAsset = (value) => {
  if (!value) return "";
  try {
    const url = new URL(value, FRONTEND);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};
const safeFacebook = (value) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host === "fb.me") ? url.href : "";
  } catch { return ""; }
};
const campusOf = (item) => item?.campus === "quy-nhon" ? "quy-nhon" : "hcm";
const statusOf = (post) => post?.status ?? "published";
const membersHere = () => state.members.map((person, index) => ({ person, index })).filter(({ person }) => campusOf(person) === state.campus);
const postsHere = () => state.posts.filter((post) => campusOf(post) === state.campus);
const canManageMembers = () => state.role === "super" || (state.role === "campus_admin" && state.campus === "quy-nhon");
const popupDocument = (value) => value?.hcm ? value : { hcm: value ?? { enabled: false, title: "", description: "", image: "", facebookUrl: "" }, "quy-nhon": { enabled: false, title: "", description: "", image: "", facebookUrl: "" } };
let popupPreviewUrl = "";
function clearPopupPreview() {
  if (popupPreviewUrl) URL.revokeObjectURL(popupPreviewUrl);
  popupPreviewUrl = "";
}
function popupMimeType(file) {
  if (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type)) return file.type;
  if (/\.heic$/i.test(file.name)) return "image/heic";
  if (/\.heif$/i.test(file.name)) return "image/heif";
  return "";
}

function imageBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("Không đọc được ảnh. Hãy thử ảnh khác."));
    reader.readAsDataURL(blob);
  });
}
const photoMarkup = (photo, name, className = "") => {
  const url = safeAsset(photo);
  return url
    ? `<img class="${className}" src="${escapeHtml(url)}" alt="Ảnh của ${escapeHtml(name)}" loading="lazy" />`
    : `<span class="avatar-fallback ${className}" aria-hidden="true">✦</span>`;
};

const newsEditor = $("#news-editor");
let savedEditorRange = null;

function rememberEditorSelection() {
  const selection = window.getSelection();
  if (selection?.rangeCount && newsEditor.contains(selection.anchorNode)) {
    savedEditorRange = selection.getRangeAt(0).cloneRange();
  }
}

function restoreEditorSelection() {
  newsEditor.focus();
  if (!savedEditorRange) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedEditorRange);
}

function formatNews(command, value) {
  restoreEditorSelection();
  document.execCommand(command, false, value);
  rememberEditorSelection();
}

function serializeNewsEditor() {
  const blocks = [];
  let runs = [];
  const flush = () => {
    if (runs.some(({ text }) => text.trim())) blocks.push({ runs });
    runs = [];
  };
  const appendText = (text, style) => {
    if (!text) return;
    const last = runs.at(-1);
    if (last && last.bold === style.bold && last.italic === style.italic &&
        last.underline === style.underline && last.size === style.size) {
      last.text += text;
    } else {
      runs.push({ text, ...style });
    }
  };
  const walk = (node, style) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.nodeValue.replace(/\u00a0/g, " "), style);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === "BR") return flush();
    const block = ["DIV", "P", "LI", "H1", "H2", "H3"].includes(tag);
    if (block && runs.length) flush();
    const next = { ...style };
    if (["B", "STRONG"].includes(tag)) next.bold = true;
    if (["I", "EM"].includes(tag)) next.italic = true;
    if (tag === "U") next.underline = true;
    if (tag === "FONT") {
      const size = Number(node.getAttribute("size"));
      if (Number.isInteger(size) && size >= 1 && size <= 7) next.size = size;
    }
    if (node.hasAttribute("data-news-size")) {
      const size = Number(node.getAttribute("data-news-size"));
      if (Number.isInteger(size) && size >= 1 && size <= 7) next.size = size;
    }
    if (node.style?.fontWeight === "bold" || Number(node.style?.fontWeight) >= 600) next.bold = true;
    if (node.style?.fontStyle === "italic") next.italic = true;
    if (node.style?.textDecoration?.includes("underline")) next.underline = true;
    for (const child of node.childNodes) walk(child, next);
    if (block) flush();
  };
  for (const child of newsEditor.childNodes) walk(child, {});
  flush();
  return blocks;
}

function notice(message, error = false) {
  const box = $("#notice");
  box.textContent = message;
  box.classList.toggle("error", error);
  box.hidden = false;
}

function setBusy(busy) {
  state.busy = busy;
  const loginButton = $("#login-submit");
  const memberButton = $("#member-form button[type=submit]");
  const memberOrderButton = $("#move-member-first");
  const memberDeleteButton = $("#delete-member");
  const newsButton = $("#news-form button[type=submit]");
  const popupButton = $("#popup-form button[type=submit]");
  loginButton.disabled = busy;
  $("#auth-toggle").disabled = busy;
  if (memberButton) memberButton.disabled = busy || !state.session;
  if (memberOrderButton) memberOrderButton.disabled = busy || !canManageMembers();
  if (memberDeleteButton) memberDeleteButton.disabled = busy || !canManageMembers();
  const memberImage = $("#member-form input[name=memberImage]");
  if (memberImage) memberImage.disabled = busy || !canManageMembers();
  newsButton.disabled = busy || !state.session;
  $("#news-draft-button").disabled = busy || !state.session;
  $("#news-preview-button").disabled = busy || !state.session;
  popupButton.disabled = busy || !state.session;
  $("#popup-image-file").disabled = busy || !state.session;
  $("#create-admin-form button[type=submit]").disabled = busy || state.role !== "super";
  $("#change-password-form button[type=submit]").disabled = busy || state.accountType !== "database";
}

function renderCounts() {
  $("#sidebar-member-count").textContent = membersHere().length || "—";
  $("#member-count").textContent = `${membersHere().length} thành viên`;
  $("#sidebar-news-count").textContent = String(postsHere().filter((post) => statusOf(post) === "published").length).padStart(2, "0");
  $("#news-count").textContent = `${postsHere().length} bài`;
}

function renderMemberList() {
  const query = $("#member-search").value.trim().toLocaleLowerCase("vi");
  const matches = membersHere().filter(({ person }) =>
    `${person.name} ${person.fullName ?? ""} ${person.title}`.toLocaleLowerCase("vi").includes(query));
  $("#member-list").innerHTML = matches.length ? matches.map(({ person, index }) => `
    <button class="member-row ${index === state.selectedMemberIndex ? "active" : ""}" type="button" data-member-index="${index}" aria-pressed="${index === state.selectedMemberIndex}">
      ${photoMarkup(person.photo, person.name)}
      <span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.title)}</small></span><span class="arrow" aria-hidden="true">↗</span>
    </button>`).join("") : `<p class="empty-message">Không tìm thấy thành viên phù hợp.</p>`;
}

function renderMemberDetail() {
  const person = state.selectedMemberIndex === -1 ? { name: "", title: "", group: "Member", campus: state.campus } : state.members[state.selectedMemberIndex];
  const detail = $("#member-detail");
  if (!person) {
    detail.innerHTML = `<div class="empty-detail"><span>✦</span><h3>Chọn một thành viên</h3><p>Ảnh và thông tin sẽ hiển thị ở đây.</p></div>`;
    return;
  }
  const firstMemberIndex = membersHere()[0]?.index;
  detail.innerHTML = `
    <div class="profile-top">${photoMarkup(person.photo, person.name, "profile-photo")}<div><span class="field-label">${state.selectedMemberIndex === -1 ? "THÀNH VIÊN MỚI" : `HỒ SƠ / ${String(state.selectedMemberIndex + 1).padStart(2, "0")}`}</span><h3>${escapeHtml(person.name || "Thêm thành viên")}</h3><p>${escapeHtml(person.title || (state.campus === "hcm" ? "TP.HCM" : "Quy Nhơn"))}</p></div></div>
    <form id="member-form" class="profile-form">
      <div class="form-row"><label>Tên hiển thị<input name="name" maxlength="100" required /></label><label>Họ và tên<input name="fullName" maxlength="120" /></label></div>
      <div class="form-row"><label>Chức vụ<input name="title" maxlength="100" required /></label><label>Nhóm<select name="group"><option value="Mentor">Mentor</option><option value="Supporter">Supporter</option><option value="Leadership">Ban điều hành</option><option value="Member">Member</option></select></label></div>
      <label>Thế hệ Faerie / Cohort<input name="cohort" maxlength="30" placeholder="2026" /></label>
      <label>Ảnh thành viên · URL hoặc đường dẫn ảnh Faerie<input name="photo" maxlength="600" /></label>
      <label>Hoặc tải ảnh mới từ thiết bị<input name="memberImage" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" /></label>
      <label>Facebook · URL<input name="facebookUrl" type="url" maxlength="600" /></label>
      <div class="form-row"><label>Ngày sinh · chỉ điền khi thành viên đồng ý công khai<input name="birthDate" type="date" /></label><label>Sở thích<input name="interests" maxlength="300" /></label></div>
      <label>Giới thiệu<textarea name="introduction" rows="3" maxlength="1200"></textarea></label>
      <label>Quote / thông điệp<textarea name="message" rows="3" maxlength="1200" placeholder="Một câu nói ngắn của thành viên"></textarea></label>
      <label>Chứng nhận · mỗi dòng: Tên | link HTTPS<textarea name="certificates" rows="3" placeholder="Ví dụ: Chứng nhận hoạt động | https://…"></textarea></label>
      <div class="form-actions"><span>Thay đổi được lưu vào database của ${state.campus === "hcm" ? "TP.HCM" : "Quy Nhơn"}.</span><div class="member-form-actions"><button id="move-member-first" class="button button-outline" type="button" ${state.selectedMemberIndex < 0 || state.selectedMemberIndex === firstMemberIndex || !canManageMembers() ? "hidden" : ""}>Đưa lên đầu danh sách</button><button id="delete-member" class="button button-danger" type="button" ${state.selectedMemberIndex < 0 || !canManageMembers() ? "hidden" : ""}>Xóa hồ sơ</button><button class="button button-primary" type="submit" ${!canManageMembers() ? "disabled" : ""}>Lưu hồ sơ <span aria-hidden="true">↗</span></button></div></div>
    </form><div class="profile-save-note">Ảnh tải lên được nén và lưu trong database. Ngày sinh và chứng nhận sẽ xuất hiện công khai sau khi lưu.</div>`;
  const form = $("#member-form");
  ["name", "fullName", "title", "group", "cohort", "photo", "facebookUrl", "birthDate", "interests", "introduction", "message"].forEach((field) => {
    form.elements[field].value = person[field] ?? "";
  });
  form.elements.certificates.value = Array.isArray(person.certificates) ? person.certificates.map((item) => `${item.title} | ${item.url}`).join("\n") : "";
  form.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = !canManageMembers(); });
}

function renderNews() {
  const items = postsHere();
  $("#news-list").innerHTML = items.length ? items.map((item) => `
    <article class="news-row">
      ${safeAsset(item.images?.[0])
        ? `<img src="${escapeHtml(safeAsset(item.images[0]))}" alt="" loading="lazy" />`
        : `<span class="news-image-fallback">FAERIE<br />NEWS</span>`}
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.date)}.${escapeHtml(item.year)} · ${escapeHtml(item.tag)} · ${statusOf(item) === "trash" ? "Thùng rác" : statusOf(item) === "draft" ? "Bản nháp" : "Đã đăng"}</small><p>${escapeHtml(item.description)}</p>
        <div class="news-row-actions">${statusOf(item) !== "trash" ? `<button type="button" data-edit-post="${escapeHtml(item.id)}">Sửa bài</button>` : ""}
        ${state.role === "super" && statusOf(item) !== "trash" ? `<button class="delete-post" type="button" data-delete-post="${escapeHtml(item.id)}">Đưa vào thùng rác</button>` : ""}
        ${state.role === "super" && statusOf(item) === "trash" ? `<button type="button" data-restore-post="${escapeHtml(item.id)}">Khôi phục thành nháp</button>` : ""}</div>
        ${item.history?.length ? `<details class="news-history"><summary>Lịch sử chỉnh sửa (${item.history.length})</summary><ul>${item.history.map((version, index) => `<li>${escapeHtml(new Date(version.savedAt).toLocaleString("vi-VN"))} · ${escapeHtml(version.savedBy)} · ${escapeHtml(version.title)} <button type="button" data-version-post="${escapeHtml(item.id)}" data-version-index="${index}">Nạp bản này</button></li>`).join("")}</ul></details>` : ""}
      </div>
    </article>`).join("") : `<p class="empty-message">Chưa có bài trong database của cơ sở này. Stories có sẵn trên trang chủ không chỉnh ở đây.</p>`;
  $("#news-hint").textContent = state.editingPostId ? "Đang sửa bài hiện có." : "Chọn Xem trước trước khi xuất bản.";
  $("#news-form button[type=submit]").disabled = !state.session || state.busy;
  $("#news-form-mode").textContent = state.editingPostId ? "CHỈNH SỬA BÀI" : "BÀI ĐĂNG MỚI";
  $("#news-cancel-edit").hidden = !state.editingPostId;
}

function updatePopupPreview() {
  const form = $("#popup-form");
  const enabled = form.elements.enabled.checked;
  const title = form.elements.title.value.trim() || "Tên sự kiện";
  const description = form.elements.description.value.trim() || "Lời giới thiệu sự kiện sẽ hiển thị ở đây.";
  const image = popupPreviewUrl || safeAsset(form.elements.image.value.trim());
  const facebook = safeFacebook(form.elements.facebookUrl.value.trim());
  $("#popup-preview-status").textContent = enabled ? "Đang bật" : "Đang tắt";
  $("#popup-preview").innerHTML = `<div class="popup-preview ${enabled ? "" : "is-off"}">
    <div class="popup-preview-image">${image ? `<img src="${escapeHtml(image)}" alt="Xem trước ảnh sự kiện" />` : `<span aria-hidden="true">✦</span>`}</div>
    <div class="popup-preview-copy"><small>FAERIE / EVENT FILE</small><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><span class="popup-preview-cta">${facebook ? "Xem sự kiện trên Facebook ↗" : "Xem sự kiện ↗"}</span></div>
  </div>`;
  $("#popup-preview img")?.addEventListener("error", (event) => {
    event.target.parentElement.innerHTML = '<span class="popup-preview-unavailable">Chưa xem trước được ảnh này.<br>Ảnh sẽ hiển thị sau khi lưu và triển khai.</span>';
  });
}

function renderPopup() {
  const form = $("#popup-form");
  const popup = popupDocument(state.popup)[state.campus];
  clearPopupPreview();
  $("#popup-image-file").value = "";
  form.elements.enabled.checked = popup.enabled;
  for (const field of ["title", "description", "image", "facebookUrl"]) form.elements[field].value = popup[field] ?? "";
  form.querySelectorAll("input, textarea").forEach((input) => { input.disabled = !state.session; });
  form.querySelector('button[type="submit"]').disabled = !state.session || state.busy;
  updatePopupPreview();
}

function renderAuth() {
  const roleLabel = state.role === "super" ? "Admin lớn" : state.role === "campus_admin" ? "Admin cơ sở Quy Nhơn" : "Admin nhỏ";
  $("#auth-status").textContent = state.session ? `${roleLabel} · ${state.username}` : "Đã đăng xuất";
  document.querySelectorAll("[data-super-only]").forEach((element) => { element.hidden = state.role !== "super"; });
  document.querySelectorAll("[data-member-admin]").forEach((element) => { element.hidden = !canManageMembers(); });
  $("#campus-select").disabled = state.role === "campus_admin";
  $("#change-password-panel").hidden = state.accountType !== "database";
  $("#legacy-password-note").hidden = state.accountType !== "legacy";
  $("#mfa-panel").hidden = state.role !== "super" || state.accountType !== "database";
  $("#mfa-status").textContent = state.mfaEnabled ? "Đang bật" : "Chưa bật";
  $("#mfa-setup-form").hidden = state.mfaEnabled || Boolean(state.mfaSetupToken);
  $("#mfa-enable-form").hidden = state.mfaEnabled || !state.mfaSetupToken;
  $("#mfa-disable-form").hidden = !state.mfaEnabled;
  renderMemberDetail();
  renderNews();
  renderPopup();
}

function switchView(view) {
  if ((view === "members" && !canManageMembers()) || (view === "logs" && state.role !== "super")) return;
  state.view = view;
  $("#members-view").hidden = view !== "members";
  $("#news-view").hidden = view !== "news";
  $("#popup-view").hidden = view !== "popup";
  $("#logs-view").hidden = view !== "logs";
  $("#accounts-view").hidden = view !== "accounts";
  $("#page-title").textContent = ({ members: "Quản lý thành viên", news: "Xuất bản News", popup: "Popup sự kiện", logs: "Nhật ký đăng nhập", accounts: "Tài khoản quản trị" })[view];
  if (view === "logs") void loadLogs();
  if (view === "accounts" && state.role === "super") void loadUsers();
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

async function loadPublicData() {
  try {
    const [membersResponse, newsResponse] = await Promise.all([
      fetch(`${API}/api/v1/members?year=2026&campus=${state.campus}`),
      fetch(`${API}/api/v1/news?campus=${state.campus}`),
    ]);
    if (!membersResponse.ok || !newsResponse.ok) throw new Error("API tạm thời chưa sẵn sàng.");
    const [membersData, newsData] = await Promise.all([membersResponse.json(), newsResponse.json()]);
    if (!Array.isArray(membersData.members) || !Array.isArray(newsData.news)) throw new Error("Dữ liệu API không hợp lệ.");
    if (!state.session) state.members = membersData.members;
    state.news = newsData.news;
    if (state.selectedMemberIndex == null || (state.selectedMemberIndex >= 0 && campusOf(state.members[state.selectedMemberIndex]) !== state.campus)) {
      state.selectedMemberIndex = membersHere()[0]?.index ?? null;
    }
    $("#api-status").textContent = "API đang hoạt động";
    $(".live-indicator").classList.add("online");
    renderCounts();
    renderMemberList();
    renderMemberDetail();
    renderNews();
  } catch {
    $("#api-status").textContent = "API đang khởi động";
    $(".live-indicator").classList.add("offline");
    $("#member-list").innerHTML = `<p class="empty-message">Không tải được dữ liệu. Render Free có thể đang khởi động; thử tải lại trang sau một phút.</p>`;
    $("#news-list").innerHTML = `<p class="empty-message">Không tải được tin tức.</p>`;
  }
}

function loginError(message) {
  const box = $("#login-error");
  box.textContent = message;
  box.hidden = !message;
}

async function adminRequest(path, options = {}) {
  const response = await fetch(`${API}/api/v1/admin/${path}`, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(state.session ? { Authorization: `Bearer ${state.session}` } : {}), ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && result.error?.startsWith("Phiên đăng nhập")) logout("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
    throw new Error(result.error || `API chưa phản hồi (${response.status}).`);
  }
  return result;
}

async function saveFile(kind, data) {
  const result = await adminRequest(kind, { method: "PUT", body: JSON.stringify({ data, sha: state.shas[kind] }) });
  state.shas[kind] = result.sha;
}

async function loadLogs() {
  const list = $("#logs-list");
  list.innerHTML = `<tr><td colspan="5">Đang tải nhật ký…</td></tr>`;
  try {
    const { logs } = await adminRequest("login-logs");
    list.innerHTML = logs.length ? logs.map((entry) => `<tr><td>${escapeHtml(new Date(entry.time).toLocaleString("vi-VN"))}</td><td>${escapeHtml(entry.username)}</td><td>${entry.status === "failure" ? "Thất bại" : entry.status === "mfa-enabled" ? "Bật 2FA" : entry.status === "mfa-disabled" ? "Tắt 2FA" : "Thành công"}</td><td>${escapeHtml(entry.ip)}</td><td>${escapeHtml(entry.device)}</td></tr>`).join("") : `<tr><td colspan="5">Chưa có lượt đăng nhập.</td></tr>`;
  } catch (error) {
    list.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadUsers() {
  if (state.role !== "super") return;
  const list = $("#users-list");
  list.innerHTML = `<p class="empty-message">Đang tải tài khoản…</p>`;
  try {
    const { users } = await adminRequest("users");
    list.innerHTML = users.length ? users.map((user) => {
      const roleLabel = user.role === "super" ? "Admin lớn" : user.role === "campus_admin" ? "Admin cơ sở Quy Nhơn" : "Admin nhỏ";
      const manageable = user.role === "editor" || user.role === "campus_admin";
      return `<div class="admin-user-row">
        <div class="admin-user-info"><strong>${escapeHtml(user.username)}</strong><span>${roleLabel}${user.disabled ? " · Đã vô hiệu hóa" : ""}</span></div>
        ${manageable ? `<div class="admin-user-actions">
          <button class="button button-outline" type="button" data-admin-user="${escapeHtml(user.username)}" data-admin-role="${user.role === "campus_admin" ? "editor" : "campus_admin"}">${user.role === "campus_admin" ? "Đổi thành Admin nhỏ" : "Cấp quyền cơ sở Quy Nhơn"}</button>
          <button class="button ${user.disabled ? "button-outline" : "button-danger"}" type="button" data-admin-user="${escapeHtml(user.username)}" data-admin-status="${user.disabled ? "enable" : "disable"}">${user.disabled ? "Kích hoạt lại" : "Xóa tài khoản"}</button>
        </div>` : ""}
      </div>`;
    }).join("") : `<p class="empty-message">Chưa có tài khoản trong database.</p>`;
  } catch (error) {
    list.innerHTML = `<p class="empty-message">${escapeHtml(error.message)}</p>`;
  }
}

function logout(message = "") {
  clearPopupPreview();
  state.session = "";
  state.role = "";
  state.accountType = "";
  state.username = "";
  state.mfaEnabled = false;
  state.mfaSetupToken = "";
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage may be disabled. */ }
  state.shas = { members: "", posts: "", popup: "" };
  state.members = [];
  state.news = [];
  state.posts = [];
  state.popup = null;
  state.editingPostId = null;
  state.selectedMemberIndex = null;
  $(".shell").hidden = true;
  $("#login-screen").hidden = false;
  $("#login-form").reset();
  $("#login-code").hidden = true;
  $("#login-code-label").hidden = true;
  loginError(message);
  $("#login-username").focus();
}

async function enterAdmin() {
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      data = await adminRequest("data");
      break;
    } catch (error) {
      if (attempt === 2 || !state.session) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  state.role = data.role;
  if (data.role === "campus_admin") state.campus = data.campus;
  $("#campus-select").value = state.campus;
  state.accountType = data.accountType;
  state.username = data.username;
  state.mfaEnabled = Boolean(data.mfaEnabled);
  state.members = data.members?.data ?? [];
  state.posts = data.posts.data;
  state.popup = data.popup.data;
  state.shas = { members: data.members?.sha ?? "", posts: data.posts.sha, popup: data.popup.sha };
  state.selectedMemberIndex = membersHere()[0]?.index ?? null;
  renderCounts();
  renderMemberList();
  renderAuth();
  $("#login-screen").hidden = true;
  $(".shell").hidden = false;
  switchView(canManageMembers() ? "members" : "news");
  void loadPublicData();
  notice(`Đã đăng nhập với tài khoản ${data.username}.`);
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#campus-select").addEventListener("change", (event) => {
  state.campus = event.target.value;
  state.selectedMemberIndex = membersHere()[0]?.index ?? null;
  state.editingPostId = null;
  resetNewsForm();
  renderCounts();
  renderMemberList();
  renderMemberDetail();
  renderNews();
  renderPopup();
  void loadPublicData();
});
$("#add-member").addEventListener("click", () => {
  if (!canManageMembers()) return;
  state.selectedMemberIndex = -1;
  renderMemberList();
  renderMemberDetail();
  $("#member-detail").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#logs-refresh").addEventListener("click", loadLogs);
$("#users-refresh").addEventListener("click", loadUsers);
$("#users-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-user]");
  if (!button || state.role !== "super" || state.busy) return;
  const username = button.dataset.adminUser;
  const path = `users/${encodeURIComponent(username)}`;
  const desiredRole = button.dataset.adminRole;
  const desiredStatus = button.dataset.adminStatus;
  const roleLabel = desiredRole === "campus_admin" ? "Admin cơ sở Quy Nhơn" : "Admin nhỏ";
  if (desiredRole) {
    if (!window.confirm(`Đổi quyền của “${username}” thành ${roleLabel}?`)) return;
  } else if (desiredStatus === "disable" &&
      !window.confirm(`Vô hiệu hóa tài khoản “${username}”? Tài khoản sẽ không thể đăng nhập và có thể được kích hoạt lại sau.`)) {
    return;
  }
  setBusy(true);
  try {
    if (desiredRole) {
      await adminRequest(path, {
        method: "PATCH",
        body: JSON.stringify(desiredRole === "campus_admin" ? { role: desiredRole, campus: "quy-nhon" } : { role: desiredRole }),
      });
      notice(`Đã đổi quyền của “${username}” thành ${roleLabel}.`);
    } else {
      await adminRequest(path, desiredStatus === "disable"
        ? { method: "DELETE" }
        : { method: "PATCH", body: JSON.stringify({ disabled: false }) });
      notice(desiredStatus === "disable"
        ? `Đã vô hiệu hóa tài khoản “${username}”.`
        : `Đã kích hoạt lại tài khoản “${username}”.`);
    }
    await loadUsers();
  } catch (error) {
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
});
$("#create-admin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canManageMembers() || state.busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  setBusy(true);
  try {
    const { user } = await adminRequest("users", { method: "POST", body: JSON.stringify({ username: values.username.trim(), password: values.password }) });
    form.reset();
    await loadUsers();
    notice(`Đã tạo admin nhỏ “${user.username}”. Hãy gửi mật khẩu cho người đó qua kênh riêng.`);
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});
$("#change-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.accountType !== "database" || state.busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  setBusy(true);
  try {
    const session = await adminRequest("change-password", { method: "POST", body: JSON.stringify(values) });
    state.session = session.token;
    try { sessionStorage.setItem(SESSION_KEY, state.session); } catch { /* Session still works in memory. */ }
    form.reset();
    notice("Đã đổi mật khẩu. Các phiên đăng nhập cũ đã hết hiệu lực.");
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});
$("#mfa-setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  setBusy(true);
  try {
    const password = new FormData(event.target).get("password");
    const result = await adminRequest("mfa/setup", { method: "POST", body: JSON.stringify({ password }) });
    state.mfaSetupToken = result.setupToken;
    $("#mfa-secret").textContent = result.secret;
    event.target.reset();
    renderAuth();
    notice("Đã tạo khóa. Nhập khóa vào ứng dụng xác thực, rồi điền mã 6 số để kích hoạt.");
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});
$("#mfa-enable-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  setBusy(true);
  try {
    const code = new FormData(event.target).get("code");
    const result = await adminRequest("mfa/enable", { method: "POST", body: JSON.stringify({ setupToken: state.mfaSetupToken, code }) });
    state.session = result.token;
    state.mfaEnabled = true;
    state.mfaSetupToken = "";
    $("#mfa-secret").textContent = "";
    try { sessionStorage.setItem(SESSION_KEY, state.session); } catch { /* Keep memory session. */ }
    event.target.reset();
    renderAuth();
    notice("Đã bật xác thực hai bước. Lần đăng nhập sau cần mã từ ứng dụng.");
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});
$("#mfa-disable-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  setBusy(true);
  try {
    const values = Object.fromEntries(new FormData(event.target));
    const result = await adminRequest("mfa/disable", { method: "POST", body: JSON.stringify(values) });
    state.session = result.token;
    state.mfaEnabled = false;
    try { sessionStorage.setItem(SESSION_KEY, state.session); } catch { /* Keep memory session. */ }
    event.target.reset();
    renderAuth();
    notice("Đã tắt xác thực hai bước.");
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});
document.addEventListener("selectionchange", rememberEditorSelection);
$(".editor-toolbar").addEventListener("mousedown", (event) => {
  if (event.target.closest("button[data-format]")) event.preventDefault();
});
$(".editor-toolbar").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-format]");
  if (button) formatNews(button.dataset.format);
});
$("#news-font-size").addEventListener("change", (event) => formatNews("fontSize", event.target.value));
$("#popup-form").addEventListener("input", updatePopupPreview);
$("#popup-form").addEventListener("change", updatePopupPreview);
$("#popup-image-file").addEventListener("change", (event) => {
  clearPopupPreview();
  const file = event.target.files?.[0];
  if (file) {
    if (!popupMimeType(file) || file.size > 20_000_000) {
      event.target.value = "";
      return notice("Chọn ảnh JPG, PNG, WebP hoặc HEIC dưới 20 MB.", true);
    }
    popupPreviewUrl = URL.createObjectURL(file);
    notice("Đã chọn ảnh. Bấm Lưu popup để tải lên và xử lý.");
  }
  updatePopupPreview();
});
$("#popup-form [name=image]").addEventListener("input", () => {
  if (!$("#popup-image-file").files?.length) return;
  $("#popup-image-file").value = "";
  clearPopupPreview();
  updatePopupPreview();
});
newsEditor.addEventListener("keyup", rememberEditorSelection);
newsEditor.addEventListener("mouseup", rememberEditorSelection);
newsEditor.addEventListener("paste", (event) => {
  event.preventDefault();
  document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
});
$("#member-search").addEventListener("input", renderMemberList);
$("#member-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-member-index]");
  if (!button) return;
  state.selectedMemberIndex = Number(button.dataset.memberIndex);
  renderMemberList();
  renderMemberDetail();
});
$("#auth-toggle").addEventListener("click", () => { if (!state.busy) logout(); });
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  loginError("");
  setBusy(true);
  try {
    const username = $("#login-username").value.trim();
    const password = $("#login-password").value;
    const code = $("#login-code").hidden ? "" : $("#login-code").value.trim();
    const result = await adminRequest("login", { method: "POST", body: JSON.stringify({ username, password, code }) });
    if (result.requiresMfa) {
      $("#login-code").hidden = false;
      $("#login-code-label").hidden = false;
      $("#login-code").focus();
      loginError("Nhập mã 6 số từ ứng dụng xác thực.");
      return;
    }
    state.session = result.token;
    try { sessionStorage.setItem(SESSION_KEY, state.session); } catch { /* Session still works in memory. */ }
    await enterAdmin();
    $("#login-form").reset();
  } catch (error) {
    if (state.session) logout();
    loginError(error.message || "Không đăng nhập được. Hãy thử lại.");
  } finally {
    setBusy(false);
  }
});
$("#member-detail").addEventListener("submit", async (event) => {
  if (event.target.id !== "member-form") return;
  event.preventDefault();
  if (!canManageMembers() || state.busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  const updated = {
    ...(state.selectedMemberIndex === -1 ? {} : state.members[state.selectedMemberIndex]),
    campus: state.campus,
    name: values.name.trim(),
    title: values.title.trim(),
    group: values.group,
  };
  for (const field of ["fullName", "cohort", "photo", "facebookUrl", "birthDate", "interests", "introduction", "message"]) {
    const value = values[field].trim();
    if (value) updated[field] = value;
    else delete updated[field];
  }
  if (!updated.name || !updated.title) return notice("Tên và chức vụ không được để trống.", true);
  if (updated.photo && !safeAsset(updated.photo)) return notice("Ảnh phải là URL HTTPS hoặc đường dẫn ảnh hợp lệ.", true);
  if (updated.facebookUrl && !/^https:\/\/(www\.)?(facebook\.com|fb\.com|fb\.me)\//i.test(updated.facebookUrl)) return notice("Link Facebook chưa hợp lệ.", true);
  const certificateLines = values.certificates.split("\n").map((line) => line.trim()).filter(Boolean);
  if (certificateLines.length > 10) return notice("Mỗi thành viên tối đa 10 chứng nhận.", true);
  const certificates = [];
  for (const line of certificateLines) {
    const divider = line.indexOf("|");
    const title = divider < 0 ? "" : line.slice(0, divider).trim();
    const url = divider < 0 ? "" : line.slice(divider + 1).trim();
    let parsed;
    try { parsed = new URL(url); } catch { /* Invalid URL is handled below. */ }
    if (!title || title.length > 120 || url.length > 600 || parsed?.protocol !== "https:") return notice("Chứng nhận cần đúng dạng: Tên | link HTTPS.", true);
    certificates.push({ title, url });
  }
  if (certificates.length) updated.certificates = certificates;
  else delete updated.certificates;
  if (state.members.some((person, index) => index !== state.selectedMemberIndex && campusOf(person) === state.campus && person.name === updated.name)) return notice("Tên hiển thị đã có trong cơ sở này.", true);
  setBusy(true);
  try {
    const file = form.elements.memberImage.files?.[0];
    if (file) {
      notice("Đang nén và tải ảnh thành viên lên…");
      const uploaded = await adminRequest("member-image", {
        method: "POST",
        body: JSON.stringify({ mimeType: popupMimeType(file), imageBase64: await imageBase64(file) }),
      });
      updated.photo = uploaded.image;
    }
    const next = state.selectedMemberIndex === -1 ? [...state.members, updated] : state.members.with(state.selectedMemberIndex, updated);
    await saveFile("members", next);
    state.members = next;
    state.selectedMemberIndex = next.indexOf(updated);
    renderCounts();
    renderMemberList();
    renderMemberDetail();
    notice(`Đã lưu hồ sơ ${updated.name} vào database.`);
  } catch (error) {
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
});
$("#member-detail").addEventListener("click", async (event) => {
  const moveButton = event.target.closest("#move-member-first");
  if (moveButton) {
    const index = state.selectedMemberIndex;
    const campusIndexes = state.members.flatMap((person, memberIndex) =>
      campusOf(person) === state.campus ? [memberIndex] : []);
    if (!canManageMembers() || state.busy || index < 0 || !campusIndexes.includes(index) || campusIndexes[0] === index) return;
    setBusy(true);
    try {
      const campusMembers = campusIndexes.map((memberIndex) => state.members[memberIndex]);
      const selectedCampusIndex = campusIndexes.indexOf(index);
      const reorderedCampusMembers = [
        campusMembers[selectedCampusIndex],
        ...campusMembers.filter((_, campusIndex) => campusIndex !== selectedCampusIndex),
      ];
      const next = [...state.members];
      campusIndexes.forEach((memberIndex, campusIndex) => {
        next[memberIndex] = reorderedCampusMembers[campusIndex];
      });
      await saveFile("members", next);
      state.members = next;
      state.selectedMemberIndex = campusIndexes[0];
      renderCounts();
      renderMemberList();
      renderMemberDetail();
      notice(`Đã đưa ${state.members[state.selectedMemberIndex].name} lên đầu danh sách.`);
    } catch (error) {
      notice(error.message, true);
    } finally {
      setBusy(false);
    }
    return;
  }
  const button = event.target.closest("#delete-member");
  const index = state.selectedMemberIndex;
  const person = index >= 0 ? state.members[index] : null;
  if (!button || !person || campusOf(person) !== state.campus || !canManageMembers() || state.busy) return;
  if (!window.confirm(`Xóa vĩnh viễn hồ sơ “${person.name}” khỏi cơ sở ${state.campus === "hcm" ? "TP.HCM" : "Quy Nhơn"}? Không thể hoàn tác.`)) return;
  setBusy(true);
  try {
    const next = state.members.filter((_, memberIndex) => memberIndex !== index);
    await saveFile("members", next);
    state.members = next;
    state.selectedMemberIndex = membersHere()[0]?.index ?? null;
    renderCounts();
    renderMemberList();
    renderMemberDetail();
    notice(`Đã xóa hồ sơ ${person.name} khỏi database.`);
  } catch (error) {
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
});
function blocksMarkup(blocks) {
  return (blocks ?? []).map((block) => `<p>${(block.runs ?? []).map((run) => {
    let text = escapeHtml(run.text);
    if (run.bold) text = `<strong>${text}</strong>`;
    if (run.italic) text = `<em>${text}</em>`;
    if (run.underline) text = `<u>${text}</u>`;
    if (run.size) text = `<span class="preview-size-${Number(run.size) || 3}" data-news-size="${Number(run.size) || 3}">${text}</span>`;
    return text;
  }).join("")}</p>`).join("");
}

function resetNewsForm() {
  const form = $("#news-form");
  form.reset();
  form.elements.date.valueAsDate = new Date();
  newsEditor.innerHTML = "";
  savedEditorRange = null;
  state.editingPostId = null;
  $("#news-preview").hidden = true;
  renderNews();
}

function loadPostIntoEditor(post) {
  state.editingPostId = post.id;
  const form = $("#news-form");
  form.elements.title.value = post.title;
  form.elements.date.value = `${post.year}-${post.date.slice(3, 5)}-${post.date.slice(0, 2)}`;
  form.elements.tag.value = post.tag;
  form.elements.location.value = post.location;
  form.elements.image.value = post.images?.[0] ?? "";
  $("#news-image-files").value = "";
  newsEditor.innerHTML = blocksMarkup(post.bodyBlocks);
  savedEditorRange = null;
  $("#news-preview").hidden = true;
  renderNews();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function composePost(status) {
  const form = $("#news-form");
  const values = Object.fromEntries(new FormData(form));
  const bodyBlocks = serializeNewsEditor();
  const articleText = bodyBlocks.map((block) => block.runs.map((run) => run.text).join("")).join(" ").replace(/\s+/g, " ").trim();
  const [year, month, day] = values.date.split("-");
  if (!year || !month || !day || !values.title.trim() || (status === "published" && !articleText)) throw new Error("Điền tiêu đề, ngày và nội dung trước khi xuất bản.");
  if (articleText.length > 10000) throw new Error("Bài viết tối đa 10.000 ký tự.");
  if (values.image && !safeAsset(values.image)) throw new Error("Ảnh bài đăng phải là URL HTTPS.");
  const previous = state.posts.find((item) => item.id === state.editingPostId);
  return {
    ...(previous ?? {}),
    id: previous?.id ?? crypto.randomUUID(),
    campus: state.campus,
    status,
    date: `${day}.${month}`,
    year,
    title: values.title.trim(),
    description: `${articleText.slice(0, 260).trimEnd()}${articleText.length > 260 ? "…" : ""}`,
    bodyBlocks,
    tag: values.tag.trim() || "NEWS",
    location: values.location.trim() || "Faerie House",
    tone: "mint",
    images: values.image ? [values.image.trim(), ...(previous?.images ?? []).slice(1)] : previous?.images ?? [],
  };
}

$("#news-preview-button").addEventListener("click", () => {
  try {
    const post = composePost("draft");
    const file = $("#news-image-files").files?.[0];
    const preview = $("#news-preview");
    const photo = file ? URL.createObjectURL(file) : safeAsset(post.images[0]);
    preview.innerHTML = `<span class="field-label">XEM TRƯỚC · ${state.campus === "hcm" ? "TP.HCM" : "QUY NHƠN"}</span><h2>${escapeHtml(post.title)}</h2><small>${escapeHtml(post.date)}.${escapeHtml(post.year)} · ${escapeHtml(post.tag)}</small>${photo ? `<img src="${escapeHtml(photo)}" alt="Ảnh bìa xem trước" />` : ""}<div class="preview-body">${blocksMarkup(post.bodyBlocks)}</div>`;
    preview.hidden = false;
    preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (file) preview.querySelector("img").addEventListener("load", () => URL.revokeObjectURL(photo), { once: true });
  } catch (error) { notice(error.message, true); }
});

async function saveNews(status) {
  if (!state.session || state.busy) return notice("Hãy đăng nhập trước khi lưu bài.", true);
  let post;
  try { post = composePost(status); } catch (error) { return notice(error.message, true); }
  const files = [...($("#news-image-files").files ?? [])];
  if (files.length > 4 || files.some((file) => !popupMimeType(file) || file.size > 20_000_000)) return notice("Tối đa 4 ảnh JPG, PNG, WebP hoặc HEIC, mỗi ảnh dưới 20 MB.", true);
  setBusy(true);
  try {
    if (files.length) {
      post.images = [];
      for (const file of files) {
        notice(`Đang xử lý ảnh ${post.images.length + 1}/${files.length}…`);
        const uploaded = await adminRequest("news-image", { method: "POST", body: JSON.stringify({ mimeType: popupMimeType(file), imageBase64: await imageBase64(file) }) });
        post.images.push(uploaded.image);
      }
    }
    const editing = Boolean(state.editingPostId);
    const result = await adminRequest(editing ? `posts/${encodeURIComponent(post.id)}` : "posts", { method: editing ? "PATCH" : "POST", body: JSON.stringify({ post }) });
    state.shas.posts = result.sha;
    state.posts = editing ? state.posts.map((item) => item.id === post.id ? result.post : item) : [result.post, ...state.posts];
    resetNewsForm();
    renderCounts();
    renderNews();
    void loadPublicData();
    notice(status === "draft" ? `Đã lưu nháp “${post.title}”.` : `Đã xuất bản “${post.title}”.`);
  } catch (error) {
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
}
$("#news-form").addEventListener("submit", (event) => { event.preventDefault(); void saveNews("published"); });
$("#news-draft-button").addEventListener("click", () => void saveNews("draft"));
$("#news-cancel-edit").addEventListener("click", resetNewsForm);

$("#news-list").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-post]");
  if (edit) {
    const post = state.posts.find((item) => item.id === edit.dataset.editPost);
    if (post) loadPostIntoEditor(post);
    return;
  }
  const version = event.target.closest("[data-version-post]");
  if (version) {
    const post = state.posts.find((item) => item.id === version.dataset.versionPost);
    const snapshot = post?.history?.[Number(version.dataset.versionIndex)];
    if (snapshot && statusOf(post) !== "trash") loadPostIntoEditor({ ...snapshot, id: post.id });
    return;
  }
  const restore = event.target.closest("[data-restore-post]");
  if (restore && state.role === "super" && !state.busy) {
    setBusy(true);
    try {
      const result = await adminRequest(`posts/${encodeURIComponent(restore.dataset.restorePost)}/restore`, { method: "POST" });
      state.posts = state.posts.map((item) => item.id === result.post.id ? result.post : item);
      state.shas.posts = result.sha;
      renderCounts(); renderNews(); notice("Đã khôi phục bài thành bản nháp.");
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); }
    return;
  }
  const button = event.target.closest("[data-delete-post]");
  if (!button || state.role !== "super" || state.busy) return;
  const post = state.posts.find((item) => item.id === button.dataset.deletePost);
  if (!post || !window.confirm(`Chuyển bài “${post.title}” vào thùng rác? Có thể khôi phục thành bản nháp.`)) return;
  setBusy(true);
  try {
    const result = await adminRequest(`posts/${encodeURIComponent(post.id)}`, { method: "DELETE" });
    state.shas.posts = result.sha;
    state.posts = state.posts.map((item) => item.id === post.id ? result.post : item);
    renderCounts(); renderNews(); void loadPublicData();
    notice(`Đã chuyển “${post.title}” vào thùng rác.`);
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});

$("#popup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.session || state.busy) return notice("Hãy đăng nhập trước khi lưu popup.", true);
  const form = event.target;
  const popup = {
    enabled: form.elements.enabled.checked,
    title: form.elements.title.value.trim(),
    description: form.elements.description.value.trim(),
    image: form.elements.image.value.trim(),
    facebookUrl: form.elements.facebookUrl.value.trim(),
  };
  if (popup.enabled && (!popup.title || !popup.description)) return notice("Nhập tiêu đề và lời giới thiệu trước khi bật popup.", true);
  if (popup.image && !safeAsset(popup.image)) return notice("Ảnh popup phải là link HTTPS hoặc đường dẫn ảnh hợp lệ.", true);
  if (popup.facebookUrl && !safeFacebook(popup.facebookUrl)) return notice("Link sự kiện phải thuộc Facebook và dùng HTTPS.", true);
  setBusy(true);
  try {
    const file = $("#popup-image-file").files?.[0];
    if (file) {
      notice("Đang tải ảnh lên để xử lý…");
      const uploaded = await adminRequest("popup-image", {
        method: "POST",
        body: JSON.stringify({ mimeType: popupMimeType(file), imageBase64: await imageBase64(file) }),
      });
      popup.image = uploaded.image;
      form.elements.image.value = popup.image;
      $("#popup-image-file").value = "";
      clearPopupPreview();
    }
    const document = { ...popupDocument(state.popup), [state.campus]: popup };
    await saveFile("popup", document);
    state.popup = document;
    renderPopup();
    notice("Đã lưu popup vào database. Website sẽ thấy nội dung mới khi tải lại.");
  } catch (error) {
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
});

$("#news-form [name=date]").valueAsDate = new Date();
try {
  localStorage.removeItem("faerie-house-admin-vault-v1");
  state.session = sessionStorage.getItem(SESSION_KEY) || "";
} catch { state.session = ""; }
if (state.session) {
  enterAdmin().catch(() => logout("Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại."));
}
