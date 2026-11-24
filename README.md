# Campus Find: deploy steps

## 1. Database (Neon or Supabase, free)
Create a Postgres DB, then run `schema.sql` in its SQL editor. Copy the connection string.

## 2. API on Render
- Push the `server/` folder to GitHub, then Render → New → Web Service.
- Build: `npm install` | Start: `npm start`
- Environment variables:
  - `DATABASE_URL` = your Postgres connection string
  - `JWT_SECRET` = a long random string
  - `FRONTEND_ORIGIN` = your Cloudflare Pages URL (add after step 3)
- Check `https://<your-app>.onrender.com/health` returns `ok`.

## 3. Frontend on Cloudflare Pages
- In `web/index.html`, set `API` to your Render URL.
- Push `web/` to GitHub (or upload directly), then Cloudflare Pages → Create project. No build command; output dir is the folder itself.
- Put the Pages URL into `FRONTEND_ORIGIN` on Render.

## Image upload (Cloudinary, free)
1. Sign up, copy your **Cloud name** from the dashboard.
2. Settings → Upload → Add upload preset → Signing mode **Unsigned** → copy the preset name.
3. In `web/index.html` set `CLOUD_NAME` and `UPLOAD_PRESET`.
4. On Render add env var `CLOUDINARY_CLOUD_NAME` = same cloud name (the API rejects any other image host).

## SMS alerts (Arkesel)
Add these env vars on Render:
- `ARKESEL_API_KEY` = your Arkesel v2 API key
- `ARKESEL_SENDER` = your approved sender ID (max 11 chars)
- `APP_URL` = your Cloudflare Pages URL (included in the SMS)

When a FOUND item is posted, owners of open LOST reports in the same category (last 30 days) with a matching ID or shared title word get a text. The SMS carries no item details. Phones can be `024xxxxxxx` or `23324xxxxxxx`.

## Upgrade: reports, admin, password reset (run once)
1. Supabase → SQL Editor → paste `migration.sql` → Run.
2. To make yourself an admin, run (with your email):
   `UPDATE users SET role='admin' WHERE student_email='you@school.edu.gh';`
   Then log out and back in; **Account → Admin panel** appears.
3. Replace `server/server.js` and `web/index.html` in GitHub.

How it behaves:
- 3 different people reporting a post hides it until an admin reviews it.
- Posts disappear from the feed after 60 days.
- Password reset texts a 6-digit code (needs the Arkesel env vars). Codes last 10 minutes, 5 tries.
- SMS also goes to the finder when a correct answer arrives, and to the owner when a claim is approved.

## Photo and category checking (Claude)
Every new post is checked: the item must fit the chosen category and the photo must show it.
Add these env vars on Render:
- `ANTHROPIC_API_KEY` = your key from console.anthropic.com (needs a little credit)
- `ANTHROPIC_MODEL` = optional, defaults to `claude-haiku-5-5`
Without the key, posting is refused (checking fails closed). Each user gets 15 checks per 15 minutes.

## Documentation, tests, CI, Docker and analytics

**API documentation:** `docs/API.md` lists every endpoint with who can call it, an example request and the replies. A test fails if a route is added to `server.js` without being documented there.

**Tests:** from the `server/` folder run `npm install` then `npm test`. They cover the rules that matter (a finder can never claim or close their own item, attempt locks, ID masking, phone checks, encryption of secret answers), that every protected route refuses logged-out requests, and that the docs match the code.

**CI:** `.github/workflows/ci.yml` runs on every push to GitHub: the API tests, a front-end check (`node scripts/check-frontend.js`) and a Docker build. Pushing already redeploys Render and Cloudflare, so a red check tells you something broke before people see it.

**Docker (run everything on one machine):**
1. `cp .env.example .env` and fill it in (at least `JWT_SECRET`).
2. In `web/index.html` set `API` to `http://localhost:3000`.
3. `docker compose up --build`
4. Open http://localhost:8080. The API is on port 3000 and the database on 5432. The tables are created automatically from `schema.sql` and `migration.sql`.

**Analytics:** after you become admin, open **Account → Admin panel → Overview** for student and post counts, return rate, a 14-day chart, posts by category and moderation numbers. **Posts** is the moderation list.

## Notes
- Render free tier sleeps after idle, so the first request can take ~30s.
- Photos: paste a Cloudinary/R2 image URL for now; direct upload is the next step.
- Admin role: set manually with `UPDATE users SET role='admin' WHERE student_email='...';`
