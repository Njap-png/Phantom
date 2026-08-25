import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";

const LEARNING_DIR = resolve(homedir(), ".config", "phantom", "learning");
const LEARNING_FILE = resolve(LEARNING_DIR, "recon.jsonl");

if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });

const SECRET_PATTERNS = [
  /api[_-]?key/i, /token/i, /password/i, /secret/i, /credential/i,
  /authorization/i, /bearer/i, /cookie/i, /session/i, /jwt/i,
  /private[_-]?key/i, /access[_-]?key/i, /aws[_-]?secret/i,
  /x-api-key/i, /client[_-]?secret/i, /ssh[_-]?key/i
];

function containsSecret(text) {
  if (!text) return false;
  const str = String(text).toLowerCase();
  return SECRET_PATTERNS.some(p => p.test(str));
}

function sanitize(text) {
  if (!text) return text;
  let result = String(text);
  
  // Patterns for secret values (key=value, key: value, etc.)
  const valuePatterns = [
    /(api[_-]?key\s*[=:]?\s*)[^\s,}]+/gi,
    /(token\s*[=:]?\s*)[^\s,}]+/gi,
    /(password\s*[=:]?\s*)[^\s,}]+/gi,
    /(secret\s*[=:]?\s*)[^\s,}]+/gi,
    /(credential\s*[=:]?\s*)[^\s,}]+/gi,
    /(authorization\s*[=:]?\s*)[^\s,}]+/gi,
    /(bearer\s+)[^\s,}]+/gi,
    /(cookie\s*[=:]?\s*)[^\s,}]+/gi,
    /(session\s*[=:]?\s*)[^\s,}]+/gi,
    /(jwt\s*[=:]?\s*)[^\s,}]+/gi,
    /(private[_-]?key\s*[=:]?\s*)[^\s,}]+/gi,
    /(access[_-]?key\s*[=:]?\s*)[^\s,}]+/gi,
    /(aws[_-]?secret\s*[=:]?\s*)[^\s,}]+/gi,
    /(x-api-key\s*[=:]?\s*)[^\s,}]+/gi,
    /(client[_-]?secret\s*[=:]?\s*)[^\s,}]+/gi,
    /(ssh[_-]?key\s*[=:]?\s*)[^\s,}]+/gi
  ];
  
  for (const pattern of valuePatterns) {
    result = result.replace(pattern, "$1[REDACTED]");
  }
  
  // Additional pass for "Bearer token123" format (token after space)
  result = result.replace(/(bearer\s+)[^\s]+\s+[^\s,}]+/gi, "$1[REDACTED] [REDACTED]");
  result = result.replace(/(authorization:\s*bearer\s+)[^\s]+\s+[^\s,}]+/gi, "$1[REDACTED] [REDACTED]");
  
  return result;
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return sanitize(obj);
  const result = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (containsSecret(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      result[key] = sanitize(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function recordLearning(entry) {
  const timestamp = new Date().toISOString();
  const learningEntry = {
    timestamp,
    ...sanitizeObject(entry)
  };
  
  try {
    fs.appendFileSync(LEARNING_FILE, JSON.stringify(learningEntry) + "\n", "utf-8");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export function recordReconLearning(missionId, data) {
  const entry = {
    type: "recon_learning",
    missionId,
    successfulTechniques: data.successfulTechniques || [],
    toolFailures: data.toolFailures || [],
    duration: data.duration || null,
    discoveryMethods: data.discoveryMethods || [],
    falsePositivePatterns: data.falsePositivePatterns || [],
    targetCount: data.targetCount || 0,
    phaseResults: data.phaseResults || {}
  };
  return recordLearning(entry);
}

export function recordToolFailure(tool, target, phase, error) {
  return recordLearning({
    type: "tool_failure",
    tool,
    target: sanitize(target),
    phase,
    error: sanitize(String(error)),
    timestamp: new Date().toISOString()
  });
}

export function recordTechniqueSuccess(technique, missionId, targetCount) {
  return recordLearning({
    type: "technique_success",
    technique,
    missionId,
    targetCount,
    timestamp: new Date().toISOString()
  });
}

export function loadLearning(options = {}) {
  const { type, missionId, since, limit } = options;
  
  if (!fs.existsSync(LEARNING_FILE)) return [];
  
  const content = fs.readFileSync(LEARNING_FILE, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  
  const results = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      
      if (type && entry.type !== type) continue;
      if (missionId && entry.missionId !== missionId) continue;
      if (since && entry.timestamp < since) continue;
      
      results.push(entry);
    } catch {
      // Skip malformed entries - recoverable
      continue;
    }
  }
  
  if (limit && results.length > limit) {
    return results.slice(-limit);
  }
  return results;
}

export function getLearningStats() {
  const entries = loadLearning();
  
  const stats = {
    totalEntries: entries.length,
    byType: {},
    successfulTechniques: new Map(),
    toolFailures: new Map(),
    totalDuration: 0,
    missionsAnalyzed: new Set()
  };
  
  for (const entry of entries) {
    stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
    
    if (entry.missionId) stats.missionsAnalyzed.add(entry.missionId);
    
    if (entry.successfulTechniques) {
      for (const tech of entry.successfulTechniques) {
        stats.successfulTechniques.set(tech, (stats.successfulTechniques.get(tech) || 0) + 1);
      }
    }
    
    if (entry.toolFailures) {
      for (const tf of entry.toolFailures) {
        const key = `${tf.tool}:${tf.target || "unknown"}`;
        stats.toolFailures.set(key, (stats.toolFailures.get(key) || 0) + 1);
      }
    }
    
    if (entry.duration) {
      stats.totalDuration += entry.duration;
    }
  }
  
  return {
    totalEntries: stats.totalEntries,
    byType: stats.byType,
    successfulTechniques: Object.fromEntries(stats.successfulTechniques),
    toolFailures: Object.fromEntries(stats.toolFailures),
    averageDuration: stats.missionsAnalyzed.size > 0 ? stats.totalDuration / stats.missionsAnalyzed.size : 0,
    missionsAnalyzed: stats.missionsAnalyzed.size
  };
}

export function getSuccessfulTechniques() {
  const entries = loadLearning({ type: "recon_learning" });
  const techCounts = new Map();
  
  for (const entry of entries) {
    if (entry.successfulTechniques) {
      for (const tech of entry.successfulTechniques) {
        techCounts.set(tech, (techCounts.get(tech) || 0) + 1);
      }
    }
  }
  
  return Array.from(techCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([technique, count]) => ({ technique, count }));
}

export function getToolFailureRates() {
  const entries = loadLearning({ type: "recon_learning" });
  const failureCounts = new Map();
  const totalCounts = new Map();
  
  for (const entry of entries) {
    if (entry.toolFailures) {
      for (const tf of entry.toolFailures) {
        const key = tf.tool;
        failureCounts.set(key, (failureCounts.get(key) || 0) + 1);
      }
    }
    // Also count successes to calculate rate
    if (entry.successfulTechniques) {
      for (const tech of entry.successfulTechniques) {
        totalCounts.set(tech, (totalCounts.get(tech) || 0) + 1);
      }
    }
  }
  
  return Array.from(failureCounts.entries())
    .map(([tool, failures]) => ({
      tool,
      failures,
      totalRuns: (totalCounts.get(tool) || 0) + failures,
      failureRate: (totalCounts.get(tool) || 0) + failures > 0 
        ? failures / ((totalCounts.get(tool) || 0) + failures) 
        : 0
    }))
    .sort((a, b) => b.failureRate - a.failureRate);
}

export function getDiscoveryMethods() {
  const entries = loadLearning({ type: "recon_learning" });
  const methodCounts = new Map();
  
  for (const entry of entries) {
    if (entry.discoveryMethods) {
      for (const method of entry.discoveryMethods) {
        methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
      }
    }
  }
  
  return Array.from(methodCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => ({ method, count }));
}

export function getFalsePositivePatterns() {
  const entries = loadLearning({ type: "recon_learning" });
  const patterns = [];
  
  for (const entry of entries) {
    if (entry.falsePositivePatterns) {
      patterns.push(...entry.falsePositivePatterns);
    }
  }
  
  return [...new Set(patterns)];
}

export function getMissionLearning(missionId) {
  return loadLearning({ missionId, type: "recon_learning" });
}

export function clearLearning() {
  if (fs.existsSync(LEARNING_FILE)) {
    fs.unlinkSync(LEARNING_FILE);
  }
}

export function getLearningFilePath() {
  return LEARNING_FILE;
}

export { sanitize, containsSecret, SECRET_PATTERNS };