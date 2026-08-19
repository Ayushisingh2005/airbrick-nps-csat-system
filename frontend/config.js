// Set this to your deployed Render backend URL, e.g. https://airbrick-nps-backend.onrender.com
// It's stored in localStorage so you only need to set it once per browser.
const DEFAULT_API_BASE = "http://localhost:3000";

function getApiBase() {
  return localStorage.getItem("airbrick_api_base") || DEFAULT_API_BASE;
}
function setApiBase(url) {
  localStorage.setItem("airbrick_api_base", url.replace(/\/$/, ""));
}
function renderApiConfigBox(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <details class="config-box">
      <summary>Backend API URL</summary>
      <div class="config-body">
        <input id="apiBaseInput" type="text" value="${getApiBase()}" placeholder="https://your-backend.onrender.com" />
        <button id="apiBaseSave" style="width:auto;padding:8px 14px;margin-left:8px;">Save</button>
        <p class="config-help">
          The dashboard and backend are separate apps (e.g. this frontend on Vercel, the API on Render) —
          this tells the page which backend to call. It's saved in your browser only, so each device sets it once.
          Locally it already defaults to <code>http://localhost:3000</code>; you only need to touch this after deploying.
        </p>
      </div>
    </details>`;
  document.getElementById("apiBaseSave").addEventListener("click", () => {
    setApiBase(document.getElementById("apiBaseInput").value.trim());
    location.reload();
  });
}
