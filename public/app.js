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
  const newsButton = $("#news-form button[type=submit]");
  const popupButton = $("#popup-form button[type=submit]");
  loginButton.disabled = busy;
  $("#auth-toggle").disabled = busy;
  if (memberButton) memberButton.disabled = busy || !state.session;
  const memberImage = $("#member-form input[name=memberImage]");
  if (memberImage) memberImage.disabled = busy || !state.session;
  newsButton.disabled = busy || !state.session;
  popupButton.disabled = busy || !state.session;
  $("#popup-image-file").disabled = busy || !state.session;
}

function renderCounts() {
  $("#sidebar-member-count").textContent = state.members.length || "—";
  $("#member-count").textContent = `${state.members.length} thành viên`;
  $("#sidebar-news-count").textContent = String(state.news.length).padStart(2, "0");
  $("#news-count").textContent = `${state.news.length} câu chuyện`;
}

function renderMemberList() {
  const query = $("#member-search").value.trim().toLocaleLowerCase("vi");
  const matches = state.members.map((person, index) => ({ person, index })).filter(({ person }) =>
    `${person.name} ${person.fullName ?? ""} ${person.title}`.toLocaleLowerCase("vi").includes(query));
  $("#member-list").innerHTML = matches.length ? matches.map(({ person, index }) => `
    <button class="member-row ${index === state.selectedMemberIndex ? "active" : ""}" type="button" data-member-index="${index}" aria-pressed="${index === state.selectedMemberIndex}">
      ${photoMarkup(person.photo, person.name)}
      <span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.title)}</small></span><span class="arrow" aria-hidden="true">↗</span>
    </button>`).join("") : `<p class="empty-message">Không tìm thấy thành viên phù hợp.</p>`;
}

function renderMemberDetail() {
  const person = state.members[state.selectedMemberIndex];
  const detail = $("#member-detail");
  if (!person) {
    detail.innerHTML = `<div class="empty-detail"><span>✦</span><h3>Chọn một thành viên</h3><p>Ảnh và thông tin sẽ hiển thị ở đây.</p></div>`;
    return;
  }
  detail.innerHTML = `
    <div class="profile-top">${photoMarkup(person.photo, person.name, "profile-photo")}<div><span class="field-label">HỒ SƠ / ${String(state.selectedMemberIndex + 1).padStart(2, "0")}</span><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(person.title)}</p></div></div>
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
      <div class="form-actions"><span>Thay đổi sẽ được lưu vào database.</span><button class="button button-primary" type="submit" ${!state.session ? "disabled" : ""}>Lưu hồ sơ <span aria-hidden="true">↗</span></button></div>
    </form><div class="profile-save-note">Ảnh tải lên được nén và lưu trong database. Ngày sinh và chứng nhận sẽ xuất hiện công khai sau khi lưu.</div>`;
  const form = $("#member-form");
  ["name", "fullName", "title", "group", "cohort", "photo", "facebookUrl", "birthDate", "interests", "introduction", "message"].forEach((field) => {
    form.elements[field].value = person[field] ?? "";
  });
  form.elements.certificates.value = Array.isArray(person.certificates) ? person.certificates.map((item) => `${item.title} | ${item.url}`).join("\n") : "";
  form.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = !state.session; });
}

function renderNews() {
  $("#news-list").innerHTML = state.news.length ? state.news.map((item) => `
    <article class="news-row">
      ${safeAsset(item.images?.[0])
        ? `<img src="${escapeHtml(safeAsset(item.images[0]))}" alt="" loading="lazy" />`
        : `<span class="news-image-fallback">FAERIE<br />NEWS</span>`}
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.date)}.${escapeHtml(item.year)} · ${escapeHtml(item.tag)}</small><p>${escapeHtml(item.description)}</p></div>
    </article>`).join("") : `<p class="empty-message">Chưa có bài đăng.</p>`;
  $("#news-hint").textContent = "Bài được lưu vào repo và xuất hiện sau khi Render cập nhật API.";
  $("#news-form button[type=submit]").disabled = !state.session || state.busy;
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
  const popup = state.popup ?? { enabled: false, title: "", description: "", image: "", facebookUrl: "" };
  clearPopupPreview();
  $("#popup-image-file").value = "";
  form.elements.enabled.checked = popup.enabled;
  for (const field of ["title", "description", "image", "facebookUrl"]) form.elements[field].value = popup[field] ?? "";
  form.querySelectorAll("input, textarea").forEach((input) => { input.disabled = !state.session; });
  form.querySelector('button[type="submit"]').disabled = !state.session || state.busy;
  updatePopupPreview();
}

function renderAuth() {
  $("#auth-status").textContent = state.session ? "Đã đăng nhập" : "Đã đăng xuất";
  renderMemberDetail();
  renderNews();
  renderPopup();
}

function switchView(view) {
  state.view = view;
  $("#members-view").hidden = view !== "members";
  $("#news-view").hidden = view !== "news";
  $("#popup-view").hidden = view !== "popup";
  $("#logs-view").hidden = view !== "logs";
  $("#page-title").textContent = view === "members" ? "Quản lý thành viên" : view === "news" ? "Xuất bản News" : view === "popup" ? "Popup sự kiện" : "Nhật ký đăng nhập";
  if (view === "logs") void loadLogs();
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
      fetch(`${API}/api/v1/members?year=2026`),
      fetch(`${API}/api/v1/news`),
    ]);
    if (!membersResponse.ok || !newsResponse.ok) throw new Error("API tạm thời chưa sẵn sàng.");
    const [membersData, newsData] = await Promise.all([membersResponse.json(), newsResponse.json()]);
    if (!Array.isArray(membersData.members) || !Array.isArray(newsData.news)) throw new Error("Dữ liệu API không hợp lệ.");
    if (!state.session) state.members = membersData.members;
    state.news = newsData.news;
    state.selectedMemberIndex = state.members.length ? 0 : null;
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
    if (response.status === 401 && path !== "login") logout("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
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
  list.innerHTML = `<tr><td colspan="4">Đang tải nhật ký…</td></tr>`;
  try {
    const { logs } = await adminRequest("login-logs");
    list.innerHTML = logs.length ? logs.map((entry) => `<tr><td>${escapeHtml(new Date(entry.time).toLocaleString("vi-VN"))}</td><td>${escapeHtml(entry.username)}</td><td>${escapeHtml(entry.ip)}</td><td>${escapeHtml(entry.device)}</td></tr>`).join("") : `<tr><td colspan="4">Chưa có lượt đăng nhập.</td></tr>`;
  } catch (error) {
    list.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  }
}

function logout(message = "") {
  clearPopupPreview();
  state.session = "";
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage may be disabled. */ }
  state.shas = { members: "", posts: "", popup: "" };
  state.members = [];
  state.news = [];
  state.posts = [];
  state.popup = null;
  state.selectedMemberIndex = null;
  $(".shell").hidden = true;
  $("#login-screen").hidden = false;
  $("#login-form").reset();
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
  state.members = data.members.data;
  state.posts = data.posts.data;
  state.popup = data.popup.data;
  state.shas = { members: data.members.sha, posts: data.posts.sha, popup: data.popup.sha };
  state.selectedMemberIndex = state.members.length ? 0 : null;
  renderCounts();
  renderMemberList();
  renderAuth();
  $("#login-screen").hidden = true;
  $(".shell").hidden = false;
  void loadPublicData();
  notice(`Đã đăng nhập với tài khoản ${data.username}.`);
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#logs-refresh").addEventListener("click", loadLogs);
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
    const result = await adminRequest("login", { method: "POST", body: JSON.stringify({ username, password }) });
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
  if (!state.session || state.busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  const updated = {
    ...state.members[state.selectedMemberIndex],
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
  if (state.members.some((person, index) => index !== state.selectedMemberIndex && person.name === updated.name)) return notice("Tên hiển thị đã có trong danh sách.", true);
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
    const next = state.members.with(state.selectedMemberIndex, updated);
    await saveFile("members", next);
    state.members = next;
    renderMemberList();
    renderMemberDetail();
    notice(`Đã lưu hồ sơ ${updated.name}. Trang công khai sẽ cập nhật trong khoảng một phút.`);
  } catch (error) {
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
});
$("#news-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.session || state.busy) return notice("Hãy đăng nhập trước khi đăng bài.", true);
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  const bodyBlocks = serializeNewsEditor();
  const articleText = bodyBlocks.map((block) => block.runs.map((run) => run.text).join("")).join(" ").replace(/\s+/g, " ").trim();
  const [year, month, day] = values.date.split("-");
  if (!year || !month || !day || !values.title.trim() || !articleText) return notice("Điền tiêu đề, ngày và nội dung bài đăng.", true);
  if (articleText.length > 10000) return notice("Bài viết tối đa 10.000 ký tự.", true);
  if (values.image && !safeAsset(values.image)) return notice("Ảnh bài đăng phải là URL HTTPS.", true);
  const post = {
    id: crypto.randomUUID(),
    date: `${day}.${month}`,
    year,
    title: values.title.trim(),
    description: `${articleText.slice(0, 260).trimEnd()}${articleText.length > 260 ? "…" : ""}`,
    bodyBlocks,
    tag: values.tag.trim() || "NEWS",
    location: values.location.trim() || "Faerie House",
    tone: "mint",
    images: values.image ? [values.image.trim()] : [],
  };
  setBusy(true);
  try {
    const next = [post, ...state.posts];
    await saveFile("posts", next);
    state.posts = next;
    state.news = [post, ...state.news].sort((first, second) => `${second.year}${second.date.slice(3)}${second.date.slice(0, 2)}`.localeCompare(`${first.year}${first.date.slice(3)}${first.date.slice(0, 2)}`));
    form.reset();
    newsEditor.innerHTML = "";
    savedEditorRange = null;
    form.elements.date.valueAsDate = new Date();
    renderCounts();
    renderNews();
    notice(`Đã đăng “${post.title}”. Bài sẽ xuất hiện trên trang Faerie sau khi Render cập nhật API.`);
  } catch (error) {
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
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
    await saveFile("popup", popup);
    state.popup = popup;
    renderPopup();
    notice("Đã lưu popup. Website sẽ cập nhật sau khi Render triển khai backend.");
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
