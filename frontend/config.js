// Backend API base URL — hardcoded so users never see or touch this.
// If you redeploy the backend on Render and get a new URL, update ONLY this line.
const DEFAULT_API_BASE = "https://airbrick-nps-csat-system.onrender.com";

function getApiBase() {
  return DEFAULT_API_BASE;
}

// Kept as a no-op so existing calls to renderApiConfigBox() in index.html,
// tracker.html, and survey.html don't need to be touched — it now renders nothing.
function renderApiConfigBox(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = "";
}
