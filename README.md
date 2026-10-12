# Faerie House Admin

Static Admin interface at https://faeriehouse-admin.onrender.com/. The login form accepts **Username + Password** only. Credentials and the GitHub token are verified/used by the private Faerie News backend; no secret is included in this site's public files or stored in browser localStorage. The browser keeps a signed 12-hour session in sessionStorage and clears it on logout.

Configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and `GITHUB_TOKEN` as secret environment variables on the **faerienews-backend** Render web service. Follow that repository's README for details. Do not enter these values in this static site's environment or commit them to Git.

The third tab lists the latest 200 successful logins, with time, reported client IP, and an OS/browser label inferred from the User-Agent. A browser cannot reveal the real computer name.

Member changes and News posts are written to the private backend repository through protected API routes. The public site sees updates after Render redeploys the backend. The Admin supports image URLs/paths, but it does not upload image files.
