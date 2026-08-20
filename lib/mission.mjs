import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";

const MISSIONS_DIR = resolve(homedir(), ".config", "phantom", "missions");

export function createMission(program, scope) {
  const id = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  
  return {
    id,
    programName: program.name || program.handle,
    programHandle: program.handle,
    programUrl: program.url,
    scope,
    status: "planning",
    objectives: [
      "Passive reconnaissance of in-scope assets",
      "Active HTTP probing and technology detection",
      "Vulnerability validation and reporting"
    ],
    restrictions: [],
    createdAt: now,
    updatedAt: now,
    activityLog: [{
      timestamp: now,
      action: "created",
      details: `Mission created for ${program.name || program.handle} (${program.handle})`
    }]
  };
}

export function saveMission(mission) {
  if (!fs.existsSync(MISSIONS_DIR)) fs.mkdirSync(MISSIONS_DIR, { recursive: true });
  const f = resolve(MISSIONS_DIR, `${mission.id}.json`);
  fs.writeFileSync(f, JSON.stringify(mission, null, 2), "utf-8");
}

export function loadMission(missionId) {
  const f = resolve(MISSIONS_DIR, `${missionId}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf-8"));
}

export function listMissions() {
  if (!fs.existsSync(MISSIONS_DIR)) return [];
  return fs.readdirSync(MISSIONS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const m = JSON.parse(fs.readFileSync(resolve(MISSIONS_DIR, f), "utf-8"));
      return {
        id: m.id,
        programName: m.programName,
        programHandle: m.programHandle,
        status: m.status,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt
      };
    });
}

export function updateMissionStatus(missionId, status) {
  const mission = loadMission(missionId);
  if (!mission) return null;
  mission.status = status;
  mission.updatedAt = new Date().toISOString();
  saveMission(mission);
  return mission;
}

export function addMissionActivity(missionId, activity) {
  const mission = loadMission(missionId);
  if (!mission) return;
  mission.activityLog = mission.activityLog || [];
  mission.activityLog.push({ timestamp: new Date().toISOString(), ...activity });
  saveMission(mission);
}

export function isInScope(target, mission) {
  const normalized = normalizeTarget(target);
  const inScope = mission.scope.inScope.map(s => s.normalized);
  
  for (const scopeEntry of inScope) {
    if (scopeEntry.isWildcard) {
      const base = scopeEntry.normalized.replace(/^\*\./, "");
      if (normalized === base || normalized.endsWith("." + base)) {
        return { allowed: true, reason: "Matches wildcard scope", matchingScopeEntry: scopeEntry };
      }
    } else if (normalized === scopeEntry.normalized) {
      return { allowed: true, reason: "Exact match", matchingScopeEntry: scopeEntry };
    }
  }
  
  return { allowed: false, reason: "Not in scope", matchingScopeEntry: null };
}

export function normalizeTarget(target) {
  return target
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim();
}

export function generateReconPlan(mission) {
  const targets = mission.scope.inScope.map(s => s.normalized);
  return {
    phases: [
      {
        phase: 1,
        name: "Passive Reconnaissance",
        description: "Subdomain enumeration, DNS resolution",
        targets,
        tools: ["subfinder", "dnsx"]
      },
      {
        phase: 2,
        name: "Active HTTP Probing",
        description: "HTTP probing, technology detection",
        targets,
        tools: ["httpx"]
      },
      {
        phase: 3,
        name: "Validation & Reporting",
        description: "Validate findings, generate report",
        targets,
        tools: ["nuclei", "custom"]
      }
    ],
    notes: [
      "Stage 1 only — NO active exploitation",
      "Default deny for all targets not in scope",
      "All findings saved per-target per-phase"
    ]
  };
}

export async function fetchProgramAndScope(handle) {
  const { hackerTools } = await import("./tools.mjs");
  const result = await hackerTools.hackerone(`scope ${handle}`);
  
  const inScope = [];
  const outScope = [];
  const lines = result.split("\n");
  let current = "in";
  
  for (const line of lines) {
    if (line.includes("IN SCOPE")) current = "in";
    else if (line.includes("OUT OF SCOPE")) current = "out";
    else if (line.trim().startsWith("  ") && line.includes("(")) {
      const match = line.match(/^\s+([^\s]+)\s+\(([^)]+)\)/);
      if (match) {
        const [, identifier, assetType] = match;
        const entry = {
          identifier,
          normalized: identifier.replace(/^\*\./, "").toLowerCase(),
          assetType,
          isWildcard: identifier.startsWith("*."),
          maxSeverity: "critical",
          instruction: current === "out" ? "Not eligible" : ""
        };
        if (current === "in") inScope.push(entry);
        else outScope.push(entry);
      }
    }
  }
  
  return {
    program: { handle, name: handle, url: `https://hackerone.com/${handle}` },
    scope: { inScope, exclusions: outScope, restrictions: [] }
  };
}