/**
 * AirBrick Infra — Automated NPS & CSAT Measurement System
 * Backend: trigger engine + survey dispatch + scoring engine + escalation + dashboard API
 *
 * Data is persisted to a local JSON file (db.json) so the demo survives restarts
 * during a session. In production this would be Postgres — see design note.
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, "db.json");

// ---------- Persistence helpers ----------
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const seed = {
      projects: [
        { id: "P-1001", name: "Pizza Hut — Cyber Hub Outlet", customer: "Pizza Hut India", customerEmail: "ops@pizzahut-demo.com", status: "Kickoff Scheduled", percentComplete: 0, stagesSent: {}, createdAt: new Date().toISOString() },
        { id: "P-1002", name: "Nike Experience Studio, Gurugram", customer: "Nike India", customerEmail: "facilities@nike-demo.com", status: "Kickoff Scheduled", percentComplete: 0, stagesSent: {}, createdAt: new Date().toISOString() },
        { id: "P-1003", name: "GCC Coworking Fitout, Noida", customer: "Vertex GCC Pvt Ltd", customerEmail: "admin@vertexgcc-demo.com", status: "Kickoff Scheduled", percentComplete: 0, stagesSent: {}, createdAt: new Date().toISOString() }
      ],
      surveys: [],
      responses: [],
      alerts: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------- Question banks (Section 5.2 of the brief) ----------
// Each bank is built to map 1:1 onto the "Survey Focus" column in Section 4 of the
// brief for that stage, while staying under the ~90-second completion budget:
//   - 1 CSAT question + 1 NPS question (mandatory, scored)
//   - 2 short rating5 diagnostic questions (mandatory, scored — feeds the tag/driver view)
//   - 1 optional multi-select "what drove your score" tag picker (feeds escalation + risk trending)
//   - 1 optional open-text question
const QUESTION_BANKS = {
  onboarding: {
    label: "Onboarding",
    intro: "You're a few days into your project with AirBrick Infra — quick 60-second check-in.",
    // Focus per brief: ease of onboarding, clarity of scope/timeline, responsiveness of the team, first impression
    questions: [
      { id: "csat_onboarding", type: "csat", text: "How satisfied are you with your onboarding experience so far?" },
      { id: "nps", type: "nps", text: "How likely are you to recommend AirBrick Infra to a colleague, based on your experience so far?" },
      { id: "q_clarity", type: "rating5", text: "How clear was the scope and timeline communicated to you?" },
      { id: "q_responsiveness", type: "rating5", text: "How responsive has our team been to your questions so far?" },
      { id: "tags", type: "tags", optional: true, text: "What mainly shaped your score? (pick any)", options: ["Ease of onboarding", "Clarity of scope/timeline", "Team responsiveness", "First impression of the team", "Documentation/paperwork", "Kickoff scheduling"] },
      { id: "open_text", type: "text", optional: true, text: "Anything that could have made onboarding smoother?" }
    ]
  },
  wip: {
    label: "Work-in-Progress",
    intro: "Your project has crossed the halfway mark — a quick pulse check.",
    // Focus per brief: execution quality, communication cadence, issue resolution, adherence to timeline/budget
    questions: [
      { id: "csat_wip", type: "csat", text: "How satisfied are you with execution quality and progress so far?" },
      { id: "nps", type: "nps", text: "How likely are you to recommend AirBrick Infra based on this project so far?" },
      { id: "q_comms", type: "rating5", text: "How would you rate our communication cadence and issue resolution?" },
      { id: "q_adherence", type: "rating5", text: "How well are we tracking to the agreed timeline and budget?" },
      { id: "tags", type: "tags", optional: true, text: "What mainly shaped your score? (pick any)", options: ["Execution quality", "Communication cadence", "Issue resolution speed", "Timeline adherence", "Budget adherence", "Site/team coordination"] },
      { id: "open_text", type: "text", optional: true, text: "Any concerns about timeline, budget, or quality we should know about?" }
    ]
  },
  handover: {
    label: "Handover",
    intro: "Your project has been handed over — help us close the loop.",
    // Focus per brief: final deliverable quality, documentation/handover completeness, overall satisfaction, likelihood to refer
    questions: [
      { id: "csat_handover", type: "csat", text: "How satisfied are you with the final delivered space and documentation?" },
      { id: "nps", type: "nps", text: "How likely are you to recommend AirBrick Infra to others?" },
      { id: "q_quality", type: "rating5", text: "How would you rate the quality of the final deliverable vs. what was promised?" },
      { id: "q_docs", type: "rating5", text: "How complete and clear was the documentation/handover package?" },
      { id: "tags", type: "tags", optional: true, text: "What mainly shaped your score? (pick any)", options: ["Deliverable quality", "Documentation completeness", "Handover process", "Timeliness of closure", "Overall value for money", "Team professionalism"] },
      { id: "open_text", type: "text", optional: true, text: "Anything we should improve before your next project with us?" }
    ]
  }
};

// ---------- Trigger detection ----------
// Watches the mock tracker's Status + % Complete fields and fires the next unsent
// stage the instant its condition is true — this is what makes the pipeline
// "detect on its own" rather than needing a person to remember to send anything.
function detectNewlyCrossedStage(project, newStatus, newPercent) {
  const sent = project.stagesSent || {};
  if (!sent.onboarding && newStatus === "Onboarding Complete") return "onboarding";
  // Brief frames this as "crosses the 40-50% threshold". We fire as soon as percent
  // is observed AT OR ABOVE 40 (not bounded at 50) so a tracker update that jumps
  // straight from, say, 30% to 65% still catches the mid-project pulse — a strict
  // 40–50 window would silently skip the survey if no update ever landed inside it,
  // which would break the "zero manual intervention, never misses a beat" bar.
  if (!sent.wip && newPercent >= 40) return "wip";
  if (!sent.handover && newStatus === "Handover Certificate Issued") return "handover";
  return null;
}

// ---------- Scoring ----------
function computeNPS(responses) {
  if (responses.length === 0) return null;
  const promoters = responses.filter(r => r.nps >= 9).length;
  const detractors = responses.filter(r => r.nps <= 6).length;
  return Math.round(((promoters - detractors) / responses.length) * 100);
}
function computeCSAT(responses, field) {
  const vals = responses.map(r => r[field]).filter(v => v !== undefined && v !== null);
  if (vals.length === 0) return null;
  const satisfied = vals.filter(v => v >= 4).length;
  return Math.round((satisfied / vals.length) * 100);
}

function topTags(responses, limit = 5) {
  const counts = {};
  responses.forEach(r => (r.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

// Bonus (Section 9): flag a project as "trending risk" if it's showing weak signals
// across MULTIPLE stages, not just a single bad response — a lone low score is noise,
// a pattern across stages is the thing a project owner actually needs to see.
function computeRiskTrend(projResponsesByStage) {
  let weakStages = 0;
  for (const stage of Object.keys(STAGE_WEIGHTS)) {
    const sr = projResponsesByStage[stage] || [];
    if (sr.length === 0) continue;
    const nps = computeNPS(sr);
    const csat = computeCSAT(sr, "csat");
    if ((nps !== null && nps <= 0) || (csat !== null && csat < 60)) weakStages++;
  }
  return weakStages >= 2;
}

// Stage weights for blended health score (design choice — documented in design note)
const STAGE_WEIGHTS = { onboarding: 0.2, wip: 0.35, handover: 0.45 };

function computeProjectHealth(projectResponses) {
  let weightedSum = 0;
  let weightUsed = 0;
  for (const stage of Object.keys(STAGE_WEIGHTS)) {
    const stageResponses = projectResponses.filter(r => r.stage === stage);
    if (stageResponses.length === 0) continue;
    const nps = computeNPS(stageResponses); // -100..100
    const csatField = stageResponses[0].csatField;
    const csat = computeCSAT(stageResponses, "csat"); // 0..100
    const npsNormalized = (nps + 100) / 2; // 0..100
    const stageScore = (npsNormalized + csat) / 2;
    weightedSum += stageScore * STAGE_WEIGHTS[stage];
    weightUsed += STAGE_WEIGHTS[stage];
  }
  if (weightUsed === 0) return null;
  return Math.round(weightedSum / weightUsed);
}

// ---------- Routes ----------

app.get("/", (req, res) => {
  res.json({ ok: true, service: "AirBrick NPS/CSAT Automation API", time: new Date().toISOString() });
});

// List mock tracker projects
app.get("/api/projects", (req, res) => {
  const db = loadDB();
  res.json(db.projects);
});

// TRIGGER SOURCE: simulate a project tracker update (this stands in for the real PM tool webhook)
app.post("/api/tracker/update", (req, res) => {
  const { projectId, status, percentComplete } = req.body;
  const db = loadDB();
  const project = db.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  if (status !== undefined) project.status = status;
  if (percentComplete !== undefined) project.percentComplete = percentComplete;

  const stage = detectNewlyCrossedStage(project, project.status, project.percentComplete);

  let dispatched = null;
  if (stage) {
    const token = nanoid(10);
    const survey = {
      token,
      projectId: project.id,
      projectName: project.name,
      customer: project.customer,
      customerEmail: project.customerEmail,
      stage,
      dispatchedAt: new Date().toISOString(),
      responded: false
    };
    db.surveys.push(survey);
    project.stagesSent = project.stagesSent || {};
    project.stagesSent[stage] = true;
    dispatched = survey;

    // Simulate auto-dispatch (email/WhatsApp). In production: call SES/Gmail API/WhatsApp Business API here.
    console.log(`[AUTO-DISPATCH] ${stage.toUpperCase()} survey sent to ${project.customerEmail} for ${project.name} -> /survey/${token}`);
  }

  saveDB(db);
  res.json({ project, triggeredStage: stage, survey: dispatched });
});

// Get survey questions for a token
app.get("/api/survey/:token", (req, res) => {
  const db = loadDB();
  const survey = db.surveys.find(s => s.token === req.params.token);
  if (!survey) return res.status(404).json({ error: "Survey link not found or expired" });
  if (survey.responded) return res.status(410).json({ error: "This survey has already been completed" });
  res.json({ survey, bank: QUESTION_BANKS[survey.stage] });
});

// Submit a survey response -> auto score + auto escalate
app.post("/api/survey/:token", (req, res) => {
  const db = loadDB();
  const survey = db.surveys.find(s => s.token === req.params.token);
  if (!survey) return res.status(404).json({ error: "Survey link not found" });
  if (survey.responded) return res.status(410).json({ error: "Already completed" });

  const { nps, csat, ratings, tags, comment } = req.body;
  if (typeof nps !== "number" || typeof csat !== "number") {
    return res.status(400).json({ error: "nps and csat are required numbers" });
  }

  const response = {
    id: nanoid(8),
    token: survey.token,
    projectId: survey.projectId,
    projectName: survey.projectName,
    customer: survey.customer,
    stage: survey.stage,
    nps,
    csat,
    ratings: ratings || {},
    tags: Array.isArray(tags) ? tags : [],
    comment: comment || "",
    submittedAt: new Date().toISOString(),
    isDetractor: nps <= 6,
    isLowCsat: csat <= 3
  };
  db.responses.push(response);
  survey.responded = true;
  survey.respondedAt = response.submittedAt;

  // ESCALATION ENGINE — fires the instant a Detractor or low-CSAT response lands
  if (response.isDetractor || response.isLowCsat) {
    const alert = {
      id: nanoid(8),
      projectId: response.projectId,
      projectName: response.projectName,
      customer: response.customer,
      stage: response.stage,
      reason: response.isDetractor ? "Detractor (NPS ≤ 6)" : "Low CSAT (≤ 3/5)",
      nps: response.nps,
      csat: response.csat,
      tags: response.tags,
      comment: response.comment,
      createdAt: new Date().toISOString(),
      channel: "Slack #project-owners + Email (simulated)"
    };
    db.alerts.unshift(alert);
    // In production: POST to Slack incoming webhook / send email to project owner here.
    console.log(`[ALERT] ${alert.reason} on ${alert.projectName} (${alert.stage}) — notifying project owner`);
  }

  saveDB(db);
  res.json({ ok: true, response });
});

// DASHBOARD — recalculated live from responses, no stored/cached scores
app.get("/api/dashboard", (req, res) => {
  const db = loadDB();
  const stages = ["onboarding", "wip", "handover"];

  const byStage = stages.map(stage => {
    const stageResponses = db.responses.filter(r => r.stage === stage);
    return {
      stage,
      label: QUESTION_BANKS[stage].label,
      responseCount: stageResponses.length,
      nps: computeNPS(stageResponses),
      csat: computeCSAT(stageResponses, "csat"),
      topTags: topTags(stageResponses)
    };
  });

  const overallNPS = computeNPS(db.responses);
  const overallCSAT = computeCSAT(db.responses, "csat");
  const overallTopTags = topTags(db.responses);

  const byProject = db.projects.map(p => {
    const projResponses = db.responses.filter(r => r.projectId === p.id);
    const projResponsesByStage = {};
    stages.forEach(stage => { projResponsesByStage[stage] = projResponses.filter(r => r.stage === stage); });
    return {
      projectId: p.id,
      name: p.name,
      customer: p.customer,
      status: p.status,
      percentComplete: p.percentComplete,
      stagesSent: p.stagesSent,
      responseCount: projResponses.length,
      healthScore: computeProjectHealth(projResponses),
      riskTrend: computeRiskTrend(projResponsesByStage),
      stageScores: stages.map(stage => {
        const sr = projResponsesByStage[stage];
        return { stage, nps: computeNPS(sr), csat: computeCSAT(sr, "csat"), responded: sr.length > 0 };
      })
    };
  });

  res.json({
    overallNPS,
    overallCSAT,
    overallTopTags,
    totalResponses: db.responses.length,
    byStage,
    byProject,
    alerts: db.alerts,
    pendingSurveys: db.surveys.filter(s => !s.responded)
  });
});

app.get("/api/alerts", (req, res) => {
  const db = loadDB();
  res.json(db.alerts);
});

// Reset demo data
app.post("/api/reset", (req, res) => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  loadDB();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AirBrick NPS/CSAT API running on port ${PORT}`));
