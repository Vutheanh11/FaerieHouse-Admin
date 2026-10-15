# Faerie House Admin

Static Admin interface at https://faeriehouse-admin.onrender.com/. The login form accepts **Username + Password** only. Credentials and the GitHub token are verified/used by the private Faerie News backend; no secret is included in this site's public files or stored in browser localStorage. The browser keeps a signed 12-hour session in sessionStorage and clears it on logout.

The backend stores database admin accounts as password hashes. The Render environment username/password fallback is off by default. `ADMIN_SESSION_SECRET` and `DATABASE_URL` belong on the **faerienews-backend** Render service; do not put credentials in this static site's environment or Git.

The login-history tab lists the latest 200 successful/failed logins, with time, reported client IP, and an OS/browser label inferred from the User-Agent. A browser cannot reveal the real computer name. Only a super admin can see this tab, manage members, create editor accounts, or move database News posts to trash and restore them. Editors can create drafts, edit/publish posts, and manage the event popup. Database accounts can change their own password under Tài khoản. Super admins can also enroll a TOTP authenticator after the backend migration is applied.

Member changes, News posts, and separate popup settings for TP.HCM/Quy Nhơn are stored in Neon through protected API routes and appear without a Render redeploy. Existing data without a campus remains TP.HCM. News supports drafts, preview, editing, revision history, recoverable trash, and up to four uploaded images per post. The backend converts member, popup and News uploads to WebP before saving to Neon.
