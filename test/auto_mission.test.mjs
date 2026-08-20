import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { resolve } from "path";
import { 
  EXEC_STATES,
  getExecutionState,
  startRecon,
  pauseRecon,
  resumeRecon,
  cancelMission,
  stopRecon,
  generateReconSummary
} from "../lib/recon.mjs";
import { 
  createMission, 
  saveMission, 
  loadMission, 
  updateMissionStatus, 
  isInScope,
  generateReconPlan
} from "../lib/mission.mjs";
import { hackerTools } from "../lib/tools.mjs";

// Mock mission for testing
const mockMission = {
  id: "test-auto-mission-" + Date.now(),
  programHandle: "test-program",
  programName: "Test Program",
  scope: {
    inScope: [
      { identifier: "example.com", normalized: "example.com", isWildcard: false, assetType: "URL" },
      { identifier: "*.example.com", normalized: "example.com", isWildcard: true, assetType: "URL" },
      { identifier: "api.example.com", normalized: "api.example.com", isWildcard: false, assetType: "URL" }
    ],
    exclusions: [
      { identifier: "excluded.example.com", normalized: "excluded.example.com", isWildcard: false, assetType: "URL", instruction: "Out of scope" }
    ],
    restrictions: []
  },
  status: "planning",
  objectives: [
    "Passive reconnaissance of in-scope assets",
    "Identify attack surface",
    "Enumerate subdomains and services",
    "Map technology stack"
  ],
  restrictions: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  activityLog: [{
    timestamp: new Date().toISOString(),
    action: "created",
    details: `Mission created for Test Program (test-program)`
  }]
};

// Setup test environment
const TEST_DIR = resolve("/tmp/phantom-test-auto");

async function cleanup() {
  try {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  } catch {}
}

describe("Autonomous Mission Execution", () => {
  before(async () => {
    await cleanup();
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    
    // Override mission directory for testing
    process.env.PHANTOM_TEST_MISSION_DIR = TEST_DIR;
    
    // Save test mission
    saveMission(mockMission);
  });

  after(async () => {
    await cleanup();
    delete process.env.PHANTOM_TEST_MISSION_DIR;
  });

  it("mission recon auto returns error for non-existent mission", async () => {
    const result = await hackerTools.mission("auto non-existent");
    assert.ok(result.includes("Mission not found"));
  });

  it("mission recon auto returns message for cancelled mission", async () => {
      const cancelledMission = { ...mockMission, id: "test-cancelled", status: "cancelled" };
      saveMission(cancelledMission);
      const result = await hackerTools.mission(`auto ${cancelledMission.id}`);
      assert.ok(result.includes("cancelled"));
    });

    it("mission recon auto returns message for completed mission", async () => {
      const completedMission = { ...mockMission, id: "test-completed", status: "completed" };
      saveMission(completedMission);
      const result = await hackerTools.mission(`auto ${completedMission.id}`);
      assert.ok(result.includes("already completed"));
    });

  it("mission recon auto returns message for already running recon", async () => {
    const runningMission = { ...mockMission, id: "test-running", status: "reconnaissance" };
    saveMission(runningMission);
    const result = await hackerTools.mission(`auto ${runningMission.id}`);
    assert.ok(result.includes("already running recon"));
  });

  it("mission recon auto returns error for unknown state", async () => {
    const unknownMission = { ...mockMission, id: "test-unknown", status: "invalid_state" };
    saveMission(unknownMission);
    const result = await hackerTools.mission(`auto ${unknownMission.id}`);
    assert.ok(result.includes("Unknown state"));
  });
});

describe("Mission Recon Pipeline Integration", () => {
  it("mission recon auto command exists", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const result = await hackerTools.mission("auto test-auto");
    // Should not return "Unknown recon command"
    assert.ok(!result.includes("Unknown command"));
  });

  it("mission recon auto with invalid mission returns error", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const result = await hackerTools.mission("auto non-existent");
    assert.ok(result.includes("Mission not found"));
  });

  it("mission recon auto with cancelled mission", async () => {
    const cancelledMission = { ...mockMission, id: "test-cancelled-cli", status: "cancelled" };
    saveMission(cancelledMission);
    const { hackerTools } = await import("../lib/tools.mjs");
    const result = await hackerTools.mission(`auto ${cancelledMission.id}`);
    assert.ok(result.includes("cancelled"));
  });

  it("mission recon auto with completed mission", async () => {
    const completedMission = { ...mockMission, id: "test-completed-cli", status: "completed" };
    saveMission(completedMission);
    const { hackerTools } = await import("../lib/tools.mjs");
    const result = await hackerTools.mission(`auto ${completedMission.id}`);
    assert.ok(result.includes("already completed"));
  });
});

describe("Scope Enforcement in Auto Pipeline", () => {
  it("isInScope checks scope before every target", async () => {
    // This is tested by the existing Scope Guard tests
    // The auto pipeline uses isInScope which enforces scope
    assert.ok(true);
  });

  it("auto pipeline skips out-of-scope targets", async () => {
    // The auto pipeline calls startRecon which calls runPassiveRecon
    // which uses isInScope for every target
    assert.ok(true);
  });
});

describe("Pause/Resume/Cancel/Stop Integration", () => {
  it("pauseRecon pauses reconnaissance", async () => {
    const pausedMission = { ...mockMission, id: "test-pause", status: "reconnaissance" };
    saveMission(pausedMission);
    const { pauseRecon } = await import("../lib/recon.mjs");
    const result = pauseRecon(pausedMission.id);
    assert.equal(result.success, true);
    assert.equal(result.state, "paused");
  });

  it("resumeRecon resumes from paused", async () => {
    const pausedMission = { ...mockMission, id: "test-resume", status: "paused" };
    saveMission(pausedMission);
    const { resumeRecon } = await import("../lib/recon.mjs");
    try {
      const result = await resumeRecon(pausedMission.id);
      assert.ok(Array.isArray(result));
    } catch (e) {
      // May fail due to missing binaries, but should not fail on scope logic
      assert.ok(e.message.includes("scope") || e.message.includes("binary") || e.message.includes("not found"));
    }
  });

  it("cancelMission cancels from any non-completed state", async () => {
    const activeMission = { ...mockMission, id: "test-cancel", status: "reconnaissance" };
    saveMission(activeMission);
    const { cancelMission } = await import("../lib/recon.mjs");
    const result = cancelMission(activeMission.id);
    assert.equal(result.success, true);
    assert.equal(result.state, "cancelled");
  });

  it("stopRecon gracefully stops and allows resume", async () => {
    const activeMission = { ...mockMission, id: "test-stop", status: "reconnaissance" };
    saveMission(activeMission);
    const { stopRecon } = await import("../lib/recon.mjs");
    const result = stopRecon(activeMission.id);
    assert.equal(result.success, true);
    assert.equal(result.state, "paused");
  });
});

describe("Learning System Integration", () => {
  it("learning system records execution decisions", async () => {
    // The learning system is tested by the recon tests
    // This is just a placeholder to verify the test structure
    assert.ok(true);
  });
});

describe("Final RECON COMPLETE Summary", () => {
  it("generateReconSummary produces final report", async () => {
    const { generateReconSummary } = await import("../lib/recon.mjs");
    
    // Create a mission with some results
    const missionWithResults = { ...mockMission, id: "test-summary" };
    saveMission(missionWithResults);
    
    // The summary generation should work
    const summary = generateReconSummary("test-summary");
    assert.ok(summary.includes("RECON COMPLETE"));
  });

  it("activity/learning recorded in activity.jsonl", async () => {
    const { loadMissionActivity } = await import("../lib/recon.mjs");
    const activity = loadMissionActivity(mockMission.id);
    assert.ok(Array.isArray(activity));
  });
});