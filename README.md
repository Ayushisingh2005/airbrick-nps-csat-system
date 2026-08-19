# AirBrick Infra — Automated NPS & CSAT Measurement System (Prototype)

Built for the Founders Office PM case assignment.

## What's here
- `backend/` — Node.js/Express API: trigger detection, survey dispatch, scoring engine, escalation, dashboard API. Deploy to **Render**.
- `frontend/` — Static HTML/JS: tracker simulator, live dashboard, public survey form. Deploy to **Vercel**.

## Run locally first
```
cd backend
npm install
npm start          # runs on http://localhost:3000
```
Then open `frontend/index.html` and `frontend/tracker.html` directly in your browser (or `npx serve frontend`). The API URL defaults to `http://localhost:3000` — editable in the config box at the top of each page.

## Deploy backend to Render
1. Push this whole folder to a new GitHub repo (e.g. `airbrick-nps-csat`).
2. Go to render.com → New → Web Service → connect your GitHub repo.
3. Root directory: `backend`
4. Build command: `npm install`
5. Start command: `npm start`
6. Instance type: Free
7. Deploy. Copy the resulting URL, e.g. `https://airbrick-nps-backend.onrender.com`

Note: Render's free tier spins down when idle and the filesystem resets on redeploy — fine for a demo (mock data only, as the brief allows). In production this would be Postgres, documented in the Design Note.

## Deploy frontend to Vercel
1. Same GitHub repo (or push `frontend/` as its own repo).
2. Go to vercel.com → New Project → import the repo.
3. Root directory: `frontend`
4. Framework preset: **Other** (no build step needed — it's static HTML)
5. Deploy. Copy the resulting URL, e.g. `https://airbrick-nps-csat.vercel.app`
6. Open the deployed dashboard, paste your Render backend URL into the "Backend API URL" box at the top, click Save. It's stored in your browser and used for all API calls.

## Demo flow for your Loom video
1. Open `tracker.html` on the deployed Vercel site.
2. Pick a project → click **Run Full Lifecycle Demo** (fires Onboarding → WIP → Handover in sequence, all automatic).
3. Open one of the generated survey links → submit a response with a low score (e.g. NPS 4, CSAT 2).
4. Switch to `index.html` (Dashboard) → show the score updating live and the alert appearing in the escalation feed within 5 seconds (auto-polls every 5s).
5. Narrate: "No one clicked calculate, no one sent this survey, no one is watching for detractors — the system did it."

## Repo structure
```
nps-csat-system/
  backend/
    server.js
    package.json
  frontend/
    index.html      (dashboard)
    tracker.html     (mock project tracker + demo runner)
    survey.html      (customer-facing survey)
    style.css
    config.js
```
