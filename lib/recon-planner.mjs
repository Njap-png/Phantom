import { normalizeObservations, getObservationsByType, getObservationsByPhase } from "./recon-analysis.mjs";
import { getMissionLearning, getSuccessfulTechniques, getToolFailureRates } from "./recon-learning.mjs";
import { isInScope, normalizeTarget, loadMission as loadMissionFromMission } from "./mission.mjs";
import { getRecommendedNextActions } from "./recon-intelligence.mjs";

const PASSIVE_TOOLS = [
  "subfinder", "dnsx", "httpx", "nuclei", "whatweb", "wappalyzer", 
  "tlsx", "katana", "gau", "waybackurls", "crt", "amass", "findomain",
  "assetfinder", "chaos", "dnsrecon", "massdns", "shuffledns"
];

function getCompletedActions(missionId) {
  const { observations } = normalizeObservations(missionId);
  const completed = new Set();
  
  for (const obs of observations) {
    // Observations may have 'tool' or 'source' field depending on parser
    const tool = obs.tool || obs.source;
    if (obs.status === "success" && tool) {
      const key = `${tool}:${obs.target}:${obs.phase}`;
      completed.add(key);
    }
  }
  
  return completed;
}

function getInScopeTargets(missionId) {
  const mission = loadMissionFromMission(missionId);
  if (!mission || !mission.scope || !mission.scope.inScope) {
    return [];
  }
  
  return mission.scope.inScope.map(s => ({
    identifier: s.identifier,
    normalized: s.normalized,
    isWildcard: s.isWildcard,
    assetType: s.assetType
  }));
}

function filterTargetsByScope(targets, mission) {
  const allowed = [];
  const denied = [];
  
  for (const target of targets) {
    // Check if target is in scope
    const inScopeCheck = isInScope(target, mission);
    if (!inScopeCheck.allowed) {
      denied.push({ target, scopeReason: inScopeCheck.reason });
      continue;
    }
    
    // Check if target is in exclusions
    const normalized = normalizeTarget(target);
    let isExcluded = false;
    if (mission.scope && mission.scope.exclusions) {
      for (const exclusion of mission.scope.exclusions) {
        const exclusionCheck = isInScope(target, { scope: { inScope: [exclusion] } });
        if (exclusionCheck.allowed) {
          isExcluded = true;
          break;
        }
      }
    }
    
    if (isExcluded) {
      denied.push({ target, scopeReason: "Excluded by scope policy" });
    } else {
      allowed.push({ target, scopeReason: inScopeCheck.reason });
    }
  }
  
  return { allowed, denied };
}

function getNextActionsForTarget(target, missionId, observations, learning) {
  if (!target) {
    return [];
  }
  const actions = [];
  const normalized = normalizeTarget(target);
  const completed = getCompletedActions(missionId);
  
  // Check if subfinder already done for this target
  const subfinderDone = completed.has(`subfinder:${normalized}:1`);
  const dnsxDone = completed.has(`dnsx:${normalized}:1`);
  const httpxDone = completed.has(`httpx:${normalized}:2`);
  const nucleiDone = completed.has(`nuclei:${normalized}:3`);
  const tlsxDone = completed.has(`tlsx:${normalized}:2`);
  const whatwebDone = completed.has(`whatweb:${normalized}:2`);
  
  const subdomains = getObservationsByType(missionId, "subdomain");
  const targetSubdomains = subdomains.filter(s => s.target === normalized);
  
  const httpServices = getObservationsByType(missionId, "http_service");
  const targetHttp = httpServices.filter(h => h.target === normalized);
  
  // Priority 1: Subdomain enumeration (if not done)
  if (!subfinderDone) {
    actions.push({
      id: `subfinder:${normalized}:1`,
      target: normalized,
      technique: "passive_subdomain_enum",
      tool: "subfinder",
      phase: 1,
      reason: "No subdomain enumeration recorded for this target",
      priority: "high",
      evidence: {
        subdomainsFound: targetSubdomains.length,
        dnsRecords: getObservationsByType(missionId, "dns_record").filter(d => d.target === normalized).length
      },
      safety: { scopeChecked: true, passive: true }
    });
  }
  
  // Priority 2: DNS resolution on discovered subdomains
  if (subfinderDone && !dnsxDone && targetSubdomains.length > 0) {
    actions.push({
      id: `dnsx:${normalized}:1`,
      target: normalized,
      technique: "dns_resolution",
      tool: "dnsx",
      phase: 1,
      reason: `${targetSubdomains.length} subdomains found but DNS resolution not recorded`,
      priority: "high",
      evidence: { subdomains: targetSubdomains.map(s => s.value) },
      safety: { scopeChecked: true, passive: true }
    });
  }
  
  // Priority 3: HTTP probing on resolved domains
  if (dnsxDone && !httpxDone) {
    const dnsRecords = getObservationsByType(missionId, "dns_record");
    const targetDns = dnsRecords.filter(d => d.target === normalized);
    if (targetDns.length > 0) {
      actions.push({
        id: `httpx:${normalized}:2`,
        target: normalized,
        technique: "http_probing",
        tool: "httpx",
        phase: 2,
        reason: `${targetDns.length} DNS records resolved but HTTP probing not recorded`,
        priority: "high",
        evidence: { dnsRecords: targetDns.map(d => `${d.name} ${d.recordType}`) },
        safety: { scopeChecked: true, passive: true }
      });
    }
  }
  
  // Priority 4: Technology fingerprinting on live HTTP services
  if (httpxDone && !whatwebDone && targetHttp.length > 0) {
    const techObs = getObservationsByType(missionId, "technology");
    const targetTech = techObs.filter(t => t.target === normalized);
    if (targetTech.length === 0) {
      actions.push({
        id: `whatweb:${normalized}:2`,
        target: normalized,
        technique: "technology_fingerprinting",
        tool: "whatweb",
        phase: 2,
        reason: `${targetHttp.length} HTTP services probed but no technology fingerprinting recorded`,
        priority: "medium",
        evidence: { httpServices: targetHttp.map(h => h.url) },
        safety: { scopeChecked: true, passive: true }
      });
    }
  }
  
  // Priority 5: TLS certificate collection on HTTPS services
  const tlsCerts = getObservationsByType(missionId, "tls_certificate");
  const targetTls = tlsCerts.filter(t => t.target === normalized);
  if (httpxDone && !tlsxDone && targetHttp.length > 0 && targetTls.length === 0) {
    const httpsServices = targetHttp.filter(h => h.url.startsWith("https://"));
    if (httpsServices.length > 0) {
      actions.push({
        id: `tlsx:${normalized}:2`,
        target: normalized,
        technique: "tls_certificate_collection",
        tool: "tlsx",
        phase: 2,
        reason: `${httpsServices.length} HTTPS services probed but no TLS certificate data recorded`,
        priority: "medium",
        evidence: { httpsServices: httpsServices.map(h => h.url) },
        safety: { scopeChecked: true, passive: true }
      });
    }
  }
  
  // Priority 6: Nuclei scanning (passive templates only) on HTTP services
  if (httpxDone && !nucleiDone && targetHttp.length > 0) {
    actions.push({
      id: `nuclei:${normalized}:3`,
      target: normalized,
      technique: "passive_security_metadata_collection",
      tool: "nuclei",
      phase: 3,
      reason: `${targetHttp.length} HTTP services available for passive template matching (informational only)`,
      priority: "low",
      evidence: { httpServices: targetHttp.map(h => h.url) },
      safety: { scopeChecked: true, passive: true, informationalOnly: true }
    });
  }
  
  // Priority 7: Deep crawling on web applications
  if (httpxDone && targetHttp.length > 0) {
    const webServices = targetHttp.filter(h => 
      h.url.includes(":80") || h.url.includes(":443") || 
      h.url.includes(":8080") || h.url.includes(":8443")
    );
    if (webServices.length > 0) {
      const katanaDone = completed.has(`katana:${normalized}:3`);
      if (!katanaDone) {
        actions.push({
          id: `katana:${normalized}:3`,
          target: normalized,
          technique: "passive_endpoint_discovery",
          tool: "katana",
          phase: 3,
          reason: `${webServices.length} web services available for passive endpoint discovery`,
          priority: "low",
          evidence: { webServices: webServices.map(h => h.url) },
          safety: { scopeChecked: true, passive: true }
        });
      }
    }
  }
  
  return actions;
}

export function getMissionPlan(missionId) {
  const mission = loadMissionFromMission(missionId);
  if (!mission) {
    return {
      missionId,
      timestamp: new Date().toISOString(),
      actions: [],
      error: "Mission not found",
      safety: { scopeValid: false }
    };
  }
  
  const inScopeTargets = getInScopeTargets(missionId);
  if (inScopeTargets.length === 0) {
    return {
      missionId,
      timestamp: new Date().toISOString(),
      actions: [],
      error: "No in-scope targets found. Mission scope is empty.",
      safety: { scopeValid: false, reason: "Empty scope" }
    };
  }
  
  // Filter to only domain-like targets (containing dot or wildcard)
  // Exclude URLs (starting with http:// or https://)
  const domainTargets = inScopeTargets.filter(t => {
    const id = t.identifier;
    if (id.startsWith('http://') || id.startsWith('https://')) return false;
    return id.includes('.') || id.startsWith('*.');
  });
  
  if (domainTargets.length === 0) {
    return {
      missionId,
      timestamp: new Date().toISOString(),
      actions: [],
      error: "No domain-like targets in scope. Only non-domain entries (e.g., 'Pages', 'CDNJS') found.",
      safety: { scopeValid: false, reason: "No actionable domains in scope" }
    };
  }
  
  const { observations } = normalizeObservations(missionId);
  const learning = getMissionLearning(missionId);
  
  // Filter targets by scope guard - use original identifiers for scope checking
    const { allowed, denied } = filterTargetsByScope(
      domainTargets.map(t => t.identifier), 
      mission
    );
  
    if (allowed.length === 0) {
      return {
        missionId,
        timestamp: new Date().toISOString(),
        actions: [],
        error: "All targets denied by scope guard",
        safety: { 
          scopeValid: false, 
          deniedTargets: denied.map(d => ({ target: d.target, reason: d.scopeReason })),
          reason: "Stage 1 scope guard rejected all targets"
        }
      };
    }
  
    // Get successful techniques and tool failure rates from learning
    const successfulTechs = getSuccessfulTechniques();
    const toolFailures = getToolFailureRates();
  
    // Build ranked action plan
    const allActions = [];
  
    for (const allowedTarget of allowed) {
      // Find the original domain target object to get full properties
      const domainTarget = domainTargets.find(t => t.identifier === allowedTarget.target);
      if (!domainTarget) continue;
    
      const targetActions = getNextActionsForTarget(allowedTarget.target, missionId, observations, learning);
    
      // Add scope context and learning-based priority adjustment
      for (const action of targetActions) {
        action.target = domainTarget.normalized;
        action.targetOriginal = domainTarget.identifier;
        action.targetIsWildcard = domainTarget.isWildcard;
        action.assetType = domainTarget.assetType;
        action.scopeReason = allowedTarget.scopeReason;
      
        // Adjust priority based on learning
        const toolFailure = toolFailures.find(f => f.tool === action.tool);
        if (toolFailure && toolFailure.failureRate > 0.5) {
          action.priority = "low";
          action.reason += ` (Note: ${action.tool} has high failure rate: ${Math.round(toolFailure.failureRate * 100)}%)`;
        }
      
        const techSuccess = successfulTechs.find(t => t.technique === action.tool);
        if (techSuccess && techSuccess.count > 2) {
          if (action.priority !== "high") action.priority = "high";
          action.reason += ` (${action.tool} has ${techSuccess.count} prior successes)`;
        }
      
        // Add learning-based technique suggestions
        if (learning.length > 0) {
          const latest = learning[learning.length - 1];
          if (latest.discoveryMethods?.includes("passive_subdomain_enum") && action.technique === "passive_subdomain_enum") {
            action.reason += " (Learning: passive subdomain enumeration previously successful)";
          }
        }
      }
    
      allActions.push(...targetActions);
    }
  
  // Sort by priority (high > medium > low) then by phase (1 > 2 > 3)
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  allActions.sort((a, b) => {
    const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (pDiff !== 0) return pDiff;
    return a.phase - b.phase;
  });
  
  // Remove duplicates (same tool+target+phase)
  const seen = new Set();
  const uniqueActions = allActions.filter(a => {
    const key = `${a.tool}:${a.target}:${a.phase}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  return {
    missionId,
    timestamp: new Date().toISOString(),
    actions: uniqueActions,
    deniedTargets: denied.map(d => ({ target: d.target, reason: d.scopeReason })),
    scopeValid: true,
    safety: {
      scopeGuard: "Stage 1 scope guard applied",
      allActionsPassive: true,
      noExploitation: true,
      informationalOnly: true
    }
  };
}

export function getNextAction(missionId) {
  const plan = getMissionPlan(missionId);
  if (!plan.scopeValid || plan.actions.length === 0) {
    return {
      missionId,
      action: null,
      reason: plan.error || "No valid actions available",
      safety: plan.safety
    };
  }
  
  return {
    missionId,
    action: plan.actions[0],
    alternatives: plan.actions.slice(1, 3),
    reason: `Selected highest-priority passive action`,
    safety: plan.safety
  };
}

export function getAllPlannedActions(missionId) {
  return getMissionPlan(missionId);
}