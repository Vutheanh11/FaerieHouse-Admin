# Faerie House Admin

Static Admin interface at https://faeriehouse-admin.onrender.com/. The login form accepts **Username + Password** only. Credentials and the GitHub token are verified/used by the private Faerie News backend; no secret is included in this site's public files or stored in browser localStorage. The browser keeps a signed 12-hour session in sessionStorage and clears it on logout.

The backend stores database admin accounts as password hashes. Its existing Render environment account remains as a temporary fallback. `ADMIN_SESSION_SECRET` and `DATABASE_URL` belong on the **faerienews-backend** Render service; do not put credentials in this static site's environment or Git.

The login-history tab lists the latest 200 successful logins, with time, reported client IP, and an OS/browser label inferred from the User-Agent. A browser cannot reveal the real computer name. Only a super admin can see this tab, manage members, create editor accounts, or delete database News posts. Editor accounts can publish new posts and manage the event popup only. Database accounts can change their own password under Tài khoản.

Member changes and News posts are stored in Neon through protected API routes and appear without a Render redeploy. The Admin supports uploading member and popup images, which the backend converts to WebP before saving to Neon.
