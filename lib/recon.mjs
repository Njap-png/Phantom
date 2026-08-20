import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { BASE_DIR, REPORTS_DIR, MISSIONS_DIR } from "./config.mjs";
import { isInScope, createMission, saveMission, loadMission, listMissions, updateMissionStatus, addMissionActivity, generateReconPlan, fetchProgramAndScope } from "./mission.mjs";

const EXEC_STATES = {
  PLANNING: "planning",
  READY: "ready",
  RECONNAISSANCE: "reconnaissance",
  PAUSED: "paused",
  FAILED: "failed",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
};

const VALID_TRANSITIONS = {
  [EXEC_STATES.PLANNING]: [EXEC_STATES.READY],
  [EXEC_STATES.READY]: [EXEC_STATES.RECONNAISSANCE],
  [EXEC_STATES.RECONNAISSANCE]: [EXEC_STATES.PAUSED, EXEC_STATES.FAILED, EXEC_STATES.COMPLETED, EXEC_STATES.CANCELLED],
  [EXEC_STATES.PAUSED]: [EXEC_STATES.RECONNAISSANCE, EXEC_STATES.CANCELLED],
  [EXEC_STATES.FAILED]: [EXEC_STATES.RECONNAISSANCE, EXEC_STATES.CANCELLED],
  [EXEC_STATES.COMPLETED]: [],
  [EXEC_STATES.CANCELLED]: []
};

function getMissionDir(missionId) {
  return resolve(MISSIONS_DIR, missionId);
}

function getExecutionStateFile(missionId) {
  return resolve(getMissionDir(missionId), "state.json");
}

function getExecutionState(missionId) {
  const f = getExecutionStateFile(missionId);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf-8")).state; } catch { return null; }
}

function setExecutionState(missionId, state) {
  const dir = getMissionDir(missionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getExecutionStateFile(missionId), JSON.stringify({ state, updatedAt: new Date().toISOString() }), "utf-8");
}

function transitionState(missionId, newState) {
  const current = getExecutionState(missionId);
  if (!current) throw new Error(`Mission ${missionId} has no execution state`);
  const allowed = VALID_TRANSITIONS[current] || [];
  if (!allowed.includes(newState)) throw new Error(`Invalid transition: ${current} → ${newState}`);
  setExecutionState(missionId, newState);
  return { state: newState, previous: current };
}

function ensureMissionDirs(missionId) {
  const dir = getMissionDir(missionId);
  const phaseDirs = ["phase1_passive", "phase2_active", "phase3_validation", "errors"];
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const d of phaseDirs) {
    if (!fs.existsSync(resolve(dir, d))) fs.mkdirSync(resolve(dir, d), { recursive: true });
  }
  return dir;
}

function getResultKey(phase, tool, target) {
  return `${phase}_${tool}_${target.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
}

function resultExists(missionId, key) {
  const dir = getMissionDir(missionId);
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith(".json"));
  return files.some(f => f.includes(key));
}

function saveResult(missionId, key, data) {
  const dir = getMissionDir(missionId);
  fs.writeFileSync(resolve(dir, `${key}.json`), JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2), "utf-8");
}

function loadExistingResult(missionId, key) {
  const dir = getMissionDir(missionId);
  const f = resolve(dir, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf-8"));
}

function saveError(missionId, phase, tool, target, error) {
  const dir = resolve(getMissionDir(missionId), "errors");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const key = `${phase}_${tool}_${target.replace(/[^a-zA-Z0-9.-]/g, "_")}_error.json`;
  fs.writeFileSync(resolve(dir, key), JSON.stringify({ phase, tool, target, error: String(error), timestamp: new Date().toISOString() }, null, 2), "utf-8");
}

function appendActivity(missionId, activity) {
  const dir = getMissionDir(missionId);
  const f = resolve(dir, "activity.jsonl");
  const entry = { timestamp: new Date().toISOString(), ...activity };
  fs.appendFileSync(f, JSON.stringify(entry) + "\n", "utf-8");
}

async function startRecon(missionId) {
  const mission = loadMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);
  
  ensureMissionDirs(missionId);
  transitionState(missionId, EXEC_STATES.RECONNAISSANCE);
  updateMissionStatus(missionId, "reconnaissance");
  appendActivity(missionId, { action: "recon_start", phase: 1 });
  
  // Phase 1: Passive recon
  const findings = [];
  const inScopeTargets = mission.scope.inScope.map(s => s.normalized);
  
  for (const target of inScopeTargets) {
    if (getExecutionState(missionId) !== EXEC_STATES.RECONNAISSANCE) break;
    
    try {
      const { subfinder, dnsx, httpx } = await import("./tools.mjs");
      
      const subResult = await subfinder(target);
      saveResult(missionId, getResultKey(1, "subfinder", target), { target, tool: "subfinder", result: subResult, phase: 1 });
      appendActivity(missionId, { action: "tool_complete", phase: 1, tool: "subfinder", target });
      
      // Extract subdomains and run dnsx
      const subs = subResult.split("\n").filter(l => l.trim() && !l.startsWith("[")).slice(0, 50);
      if (subs.length > 0) {
        const dnsResult = await dnsx(subs.join(" "));
        saveResult(missionId, getResultKey(1, "dnsx", target), { target, tool: "dnsx", result: dnsResult, phase: 1 });
        appendActivity(missionId, { action: "tool_complete", phase: 1, tool: "dnsx", target });
      }
      
      findings.push({ target, phase: 1, status: "success", tools: ["subfinder", "dnsx"] });
    } catch (e) {
      saveError(missionId, 1, "subfinder", target, e);
      findings.push({ target, phase: 1, status: "error", error: String(e) });
    }
  }
  
  // Phase 2: Active recon (httpx)
  if (getExecutionState(missionId) === EXEC_STATES.RECONNAISSANCE) {
    appendActivity(missionId, { action: "phase_start", phase: 2 });
    
    for (const target of inScopeTargets) {
      if (getExecutionState(missionId) !== EXEC_STATES.RECONNAISSANCE) break;
      
      try {
        const { httpx } = await import("./tools.mjs");
        const httpResult = await httpx(target);
        saveResult(missionId, getResultKey(2, "httpx", target), { target, tool: "httpx", result: httpResult, phase: 2 });
        appendActivity(missionId, { action: "tool_complete", phase: 2, tool: "httpx", target });
        findings.push({ target, phase: 2, status: "success", tools: ["httpx"] });
      } catch (e) {
        saveError(missionId, 2, "httpx", target, e);
        findings.push({ target, phase: 2, status: "error", error: String(e) });
      }
    }
  }
  
  // Phase 3: Validation
  if (getExecutionState(missionId) === EXEC_STATES.RECONNAISSANCE) {
    appendActivity(missionId, { action: "phase_start", phase: 3 });
    transitionState(missionId, EXEC_STATES.COMPLETED);
    updateMissionStatus(missionId, "completed");
    appendActivity(missionId, { action: "recon_complete" });
  }
  
  return findings;
}

function pauseRecon(missionId) {
  const state = getExecutionState(missionId);
  if (state !== EXEC_STATES.RECONNAISSANCE) throw new Error(`Cannot pause: current state is ${state}`);
  transitionState(missionId, EXEC_STATES.PAUSED);
  updateMissionStatus(missionId, "paused");
  appendActivity(missionId, { action: "recon_pause" });
  return { success: true, state: EXEC_STATES.PAUSED };
}

async function resumeRecon(missionId) {
  const state = getExecutionState(missionId);
  if (state !== EXEC_STATES.PAUSED && state !== EXEC_STATES.FAILED) {
    throw new Error(`Cannot resume: current state is ${state}`);
  }
  return await startRecon(missionId);
}

function cancelMission(missionId) {
  const state = getExecutionState(missionId);
  if (state === EXEC_STATES.COMPLETED || state === EXEC_STATES.CANCELLED) {
    throw new Error(`Mission already ${state}`);
  }
  transitionState(missionId, EXEC_STATES.CANCELLED);
  updateMissionStatus(missionId, "cancelled");
  appendActivity(missionId, { action: "mission_cancel" });
  return { success: true, state: EXEC_STATES.CANCELLED };
}

function stopRecon(missionId) {
  const state = getExecutionState(missionId);
  if (state !== EXEC_STATES.RECONNAISSANCE) {
    return { success: false, message: `No active recon to stop (state: ${state})`, state };
  }
  transitionState(missionId, EXEC_STATES.PAUSED);
  updateMissionStatus(missionId, "paused");
  appendActivity(missionId, { action: "recon_stop" });
  return { success: true, message: "Reconnaissance stopped, can resume", state: EXEC_STATES.PAUSED };
}

function getExecutionSummary(missionId) {
  const state = getExecutionState(missionId);
  if (!state) return { error: "No execution state" };
  const dir = getMissionDir(missionId);
  if (!fs.existsSync(dir)) return { state, findings: 0, errors: 0 };
  
  const files = fs.readdirSync(dir, { recursive: true });
  const results = files.filter(f => f.endsWith(".json") && !f.includes("error") && f !== "state.json").length;
  const errors = files.filter(f => f.includes("error")).length;
  const activityFile = resolve(dir, "activity.jsonl");
  const activity = fs.existsSync(activityFile) ? fs.readFileSync(activityFile, "utf-8").trim().split("\n").filter(Boolean).length : 0;
  
  return { state, findings: results, errors, activity };
}

function generateReconSummary(missionId) {
  const mission = loadMission(missionId);
  if (!mission) return null;
  
  const summary = getExecutionSummary(missionId);
  const findings = getMissionFindings(missionId);
  
  let out = `📋 RECON COMPLETE — ${mission.programName} (${missionId})\n`;
  out += `State: ${summary.state}\n`;
  out += `Findings: ${summary.findings} | Errors: ${summary.errors} | Activity: ${summary.activity}\n\n`;
  
  out += `📊 PHASE 1 — Passive Reconnaissance\n`;
  const phase1 = findings.filter(f => f.phase === 1);
  out += `  Targets processed: ${phase1.length}\n`;
  out += `  Successful: ${phase1.filter(f => f.status === "success").length}\n`;
  out += `  Errors: ${phase1.filter(f => f.status === "error").length}\n\n`;
  
  out += `📊 PHASE 2 — Active HTTP Probing\n`;
  const phase2 = findings.filter(f => f.phase === 2);
  out += `  Targets processed: ${phase2.length}\n`;
  out += `  Successful: ${phase2.filter(f => f.status === "success").length}\n\n`;
  
  out += `📊 PHASE 3 — Validation\n`;
  out += `  Completed: ${summary.state === "completed" ? "Yes" : "Pending"}\n\n`;
  
  out += `💾 Results saved in: ${getMissionDir(missionId)}`;
  
  return out;
}

function getMissionFindings(missionId) {
  const dir = getMissionDir(missionId);
  if (!fs.existsSync(dir)) return [];
  
  const findings = [];
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith(".json") && !f.includes("error") && f !== "state.json");
  
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(resolve(dir, f), "utf-8"));
      if (data.phase) findings.push(data);
    } catch {}
  }
  
  return findings;
}

function loadMissionResults(missionId) {
  const dir = getMissionDir(missionId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith(".json") && !f.includes("error") && f !== "state.json");
}

function loadMissionErrors(missionId) {
  const dir = resolve(getMissionDir(missionId), "errors");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".json"));
}

function loadMissionActivity(missionId) {
  const f = resolve(getMissionDir(missionId), "activity.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf-8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

export {
  EXEC_STATES,
  VALID_TRANSITIONS,
  startRecon,
  pauseRecon,
  resumeRecon,
  cancelMission,
  stopRecon,
  getExecutionState,
  transitionState,
  getExecutionSummary,
  generateReconSummary,
  getMissionFindings,
  loadMissionResults,
  loadMissionErrors,
  loadMissionActivity,
  ensureMissionDirs,
  getResultKey,
  resultExists,
  saveResult,
  loadExistingResult,
  saveError,
  appendActivity
};