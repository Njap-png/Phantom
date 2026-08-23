import { normalizeObservations, getObservationsByType, getObservationsByPhase, loadMissionResults, loadMissionErrors } from "./recon-analysis.mjs";
import { loadLearning, getLearningStats, getSuccessfulTechniques, getToolFailureRates, getDiscoveryMethods, getFalsePositivePatterns, getMissionLearning, sanitize } from "./recon-learning.mjs";

export function getMissionObservationSummary(missionId) {
  const { observations } = normalizeObservations(missionId);
  
  const summary = {
    missionId,
    timestamp: new Date().toISOString(),
    counts: {
      subdomains: 0,
      dnsRecords: 0,
      httpServices: 0,
      tlsCertificates: 0,
      technologies: 0,
      securityMetadata: 0,
      errors: 0
    },
    byPhase: {
      1: { subdomains: 0, dnsRecords: 0, httpServices: 0, technologies: 0, securityMetadata: 0, errors: 0 },
      2: { subdomains: 0, dnsRecords: 0, httpServices: 0, technologies: 0, securityMetadata: 0, errors: 0 },
      3: { subdomains: 0, dnsRecords: 0, httpServices: 0, technologies: 0, securityMetadata: 0, errors: 0 }
    }
  };
  
  for (const obs of observations) {
    if (obs.status === "success") {
      if (summary.counts[obs.type + "s"] !== undefined) {
        summary.counts[obs.type + "s"]++;
      } else if (summary.counts[obs.type] !== undefined) {
        summary.counts[obs.type]++;
      }
      
      if (obs.phase && summary.byPhase[obs.phase]) {
        if (summary.byPhase[obs.phase][obs.type + "s"] !== undefined) {
          summary.byPhase[obs.phase][obs.type + "s"]++;
        } else if (summary.byPhase[obs.phase][obs.type] !== undefined) {
          summary.byPhase[obs.phase][obs.type]++;
        }
      }
    } else if (obs.status === "error") {
      summary.counts.errors++;
      if (obs.phase && summary.byPhase[obs.phase]) {
        summary.byPhase[obs.phase].errors++;
      }
    }
  }
  
  return summary;
}

export function getTechnologySummary(missionId) {
  const technologies = getObservationsByType(missionId, "technology");
  const techCounts = new Map();
  
  for (const tech of technologies) {
    const name = tech.name || tech.value;
    if (name) {
      techCounts.set(name, (techCounts.get(name) || 0) + 1);
    }
  }
  
  return {
    missionId,
    timestamp: new Date().toISOString(),
    uniqueTechnologies: techCounts.size,
    totalObservations: technologies.length,
    technologies: Array.from(techCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  };
}

export function getHttpSummary(missionId) {
  const httpServices = getObservationsByType(missionId, "http_service");
  
  const statusCodes = new Map();
  const webServers = new Map();
  const titles = new Map();
  const withTech = 0;
  let withTechCount = 0;
  
  for (const svc of httpServices) {
    if (svc.statusCode) {
      statusCodes.set(svc.statusCode, (statusCodes.get(svc.statusCode) || 0) + 1);
    }
    if (svc.webServer) {
      webServers.set(svc.webServer, (webServers.get(svc.webServer) || 0) + 1);
    }
    if (svc.title) {
      titles.set(svc.title, (titles.get(svc.title) || 0) + 1);
    }
    if (svc.technology && svc.technology.length > 0) {
      withTechCount++;
    }
  }
  
  return {
    missionId,
    timestamp: new Date().toISOString(),
    totalServices: httpServices.length,
    statusCodes: Object.fromEntries(statusCodes),
    webServers: Object.fromEntries(webServers),
    uniqueTitles: titles.size,
    servicesWithTech: withTechCount
  };
}

export function getDnsSummary(missionId) {
  const dnsRecords = getObservationsByType(missionId, "dns_record");
  
  const recordTypes = new Map();
  const uniqueNames = new Set();
  
  for (const dns of dnsRecords) {
    recordTypes.set(dns.recordType, (recordTypes.get(dns.recordType) || 0) + 1);
    uniqueNames.add(dns.name);
  }
  
  return {
    missionId,
    timestamp: new Date().toISOString(),
    totalRecords: dnsRecords.length,
    uniqueNames: uniqueNames.size,
    recordTypes: Object.fromEntries(recordTypes)
  };
}

export function getSecurityMetadataSummary(missionId) {
  const securityMeta = getObservationsByType(missionId, "security_metadata");
  
  const severities = new Map();
  const templates = new Map();
  
  for (const meta of securityMeta) {
    if (meta.severity) {
      severities.set(meta.severity, (severities.get(meta.severity) || 0) + 1);
    }
    if (meta.templateId) {
      templates.set(meta.templateId, (templates.get(meta.templateId) || 0) + 1);
    }
  }
  
  return {
    missionId,
    timestamp: new Date().toISOString(),
    totalFindings: securityMeta.length,
    note: "Security metadata are informational observations from passive scanning templates. They are NOT vulnerability confirmations.",
    severities: Object.fromEntries(severities),
    templates: Object.fromEntries(templates)
  };
}

export function getLearnedSummary(missionId) {
  const learning = getMissionLearning(missionId);
  
  if (learning.length === 0) {
    return {
      missionId,
      timestamp: new Date().toISOString(),
      hasLearning: false,
      message: "No learning recorded for this mission"
    };
  }
  
  const latest = learning[learning.length - 1];
  
  return {
    missionId,
    timestamp: new Date().toISOString(),
    hasLearning: true,
    successfulTechniques: latest.successfulTechniques || [],
    toolFailures: latest.toolFailures || [],
    duration: latest.duration,
    discoveryMethods: latest.discoveryMethods || [],
    falsePositivePatterns: latest.falsePositivePatterns || [],
    targetCount: latest.targetCount || 0,
    phaseResults: latest.phaseResults || {}
  };
}

export function getGlobalLearningStats() {
  return getLearningStats();
}

export function getRecommendedNextActions(missionId) {
  const { observations } = normalizeObservations(missionId);
  const learning = getMissionLearning(missionId);
  
  const actions = [];
  
  const subdomains = observations.filter(o => o.type === "subdomain" && o.status === "success");
  const httpServices = observations.filter(o => o.type === "http_service" && o.status === "success");
  const dnsRecords = observations.filter(o => o.type === "dns_record" && o.status === "success");
  const errors = observations.filter(o => o.status === "error");
  
  // Only passive, advisory recommendations
  
  if (subdomains.length > 0 && httpServices.length === 0) {
    actions.push({
      priority: "high",
      action: "Probe discovered subdomains with HTTP/HTTPS",
      rationale: `${subdomains.length} subdomains found but no HTTP probing yet. Consider running httpx against subdomain list.`,
      tools: ["httpx"],
      passive: true
    });
  }
  
  if (dnsRecords.length > 0 && subdomains.length === 0) {
    actions.push({
      priority: "medium",
      action: "Enumerate subdomains for resolved domains",
      rationale: `${dnsRecords.length} DNS records found but no subdomain enumeration yet. Consider running subfinder.`,
      tools: ["subfinder"],
      passive: true
    });
  }
  
  if (httpServices.length > 0) {
    const techObs = observations.filter(o => o.type === "technology" && o.status === "success");
    if (techObs.length === 0) {
      actions.push({
        priority: "medium",
        action: "Deep technology fingerprinting on live services",
        rationale: `${httpServices.length} HTTP services probed but no technology details captured. Consider running whatweb/wappalyzer.`,
        tools: ["whatweb", "wappalyzer"],
        passive: true
      });
    }
  }
  
  if (errors.length > 0) {
    const failedTools = [...new Set(errors.map(e => e.tool))];
    actions.push({
      priority: "low",
      action: "Investigate and fix tool failures",
      rationale: `${errors.length} errors from tools: ${failedTools.join(", ")}. Check installation and permissions.`,
      tools: failedTools,
      passive: true
    });
  }
  
  // Learning-based recommendations
  if (learning.length > 0) {
    const latest = learning[learning.length - 1];
    
    if (latest.falsePositivePatterns && latest.falsePositivePatterns.length > 0) {
      actions.push({
        priority: "low",
        action: "Review false-positive patterns in nuclei results",
        rationale: latest.falsePositivePatterns.join("; "),
        tools: ["nuclei"],
        passive: true
      });
    }
    
    const successfulTechs = latest.successfulTechniques || [];
    if (successfulTechs.includes("subfinder") && !successfulTechs.includes("dnsx")) {
      actions.push({
        priority: "medium",
        action: "Run DNS resolution on discovered subdomains",
        rationale: "Subfinder succeeded but DNS resolution (dnsx) not recorded. Validate subdomains exist.",
        tools: ["dnsx"],
        passive: true
      });
    }
  }
  
  // TLS certificate analysis
  const tlsCerts = observations.filter(o => o.type === "tls_certificate" && o.status === "success");
  if (tlsCerts.length === 0 && httpServices.length > 0) {
    actions.push({
      priority: "low",
      action: "Collect TLS certificate details from HTTPS services",
      rationale: `${httpServices.length} HTTPS services probed but no TLS certificate data. Consider running tlsx.`,
      tools: ["tlsx"],
      passive: true
    });
  }
  
  return {
    missionId,
    timestamp: new Date().toISOString(),
    actions: actions.sort((a, b) => {
      const priority = { high: 3, medium: 2, low: 1 };
      return priority[b.priority] - priority[a.priority];
    })
  };
}

export function getMissionIntelligence(missionId) {
  return {
    missionId,
    timestamp: new Date().toISOString(),
    observationSummary: getMissionObservationSummary(missionId),
    technologySummary: getTechnologySummary(missionId),
    httpSummary: getHttpSummary(missionId),
    dnsSummary: getDnsSummary(missionId),
    securityMetadataSummary: getSecurityMetadataSummary(missionId),
    learnedSummary: getLearnedSummary(missionId),
    recommendedActions: getRecommendedNextActions(missionId),
    globalLearning: getGlobalLearningStats()
  };
}

export function formatIntelligenceReport(missionId) {
  const intel = getMissionIntelligence(missionId);
  
  let report = `\n🧠 MISSION INTELLIGENCE — ${intel.missionId}\n`;
  report += `════════════════════════════════════════\n`;
  report += `Generated: ${intel.timestamp}\n\n`;
  
  // Observation Summary
  const obs = intel.observationSummary;
  report += `📊 OBSERVATION SUMMARY\n`;
  report += `  Subdomains: ${obs.counts.subdomains}\n`;
  report += `  DNS Records: ${obs.counts.dnsRecords}\n`;
  report += `  HTTP Services: ${obs.counts.httpServices}\n`;
  report += `  TLS Certificates: ${obs.counts.tlsCertificates}\n`;
  report += `  Technologies: ${obs.counts.technologies}\n`;
  report += `  Security Metadata: ${obs.counts.securityMetadata}\n`;
  report += `  Errors: ${obs.counts.errors}\n\n`;
  
  // Technology Summary
  const tech = intel.technologySummary;
  if (tech.uniqueTechnologies > 0) {
    report += `🔧 TECHNOLOGIES (${tech.uniqueTechnologies} unique)\n`;
    for (const t of tech.technologies.slice(0, 10)) {
      report += `  ${t.name}: ${t.count}\n`;
    }
    report += `\n`;
  }
  
  // HTTP Summary
  const http = intel.httpSummary;
  if (http.totalServices > 0) {
    report += `🌐 HTTP SERVICES (${http.totalServices})\n`;
    report += `  Status Codes: ${Object.entries(http.statusCodes).map(([k,v]) => `${k}:${v}`).join(", ") || "none"}\n`;
    report += `  Web Servers: ${Object.entries(http.webServers).map(([k,v]) => `${k}:${v}`).join(", ") || "none"}\n`;
    report += `  With Tech: ${http.servicesWithTech}/${http.totalServices}\n\n`;
  }
  
  // DNS Summary
  const dns = intel.dnsSummary;
  if (dns.totalRecords > 0) {
    report += `🔍 DNS RECORDS (${dns.totalRecords} across ${dns.uniqueNames} names)\n`;
    report += `  Types: ${Object.entries(dns.recordTypes).map(([k,v]) => `${k}:${v}`).join(", ")}\n\n`;
  }
  
  // Security Metadata
  const sec = intel.securityMetadataSummary;
  if (sec.totalFindings > 0) {
    report += `🛡️ SECURITY METADATA (${sec.totalFindings}) [INFORMATIONAL ONLY]\n`;
    report += `  ${sec.note}\n`;
    report += `  Severities: ${Object.entries(sec.severities).map(([k,v]) => `${k}:${v}`).join(", ")}\n\n`;
  }
  
  // Learned Summary
  const learned = intel.learnedSummary;
  if (learned.hasLearning) {
    report += `📚 LEARNED FROM THIS MISSION\n`;
    report += `  Successful: ${learned.successfulTechniques.join(", ") || "none"}\n`;
    report += `  Failed: ${learned.toolFailures.map(f => `${f.tool}(${f.target})`).join(", ") || "none"}\n`;
    report += `  Methods: ${learned.discoveryMethods.join(", ") || "none"}\n`;
    if (learned.falsePositivePatterns.length > 0) {
      report += `  ⚠️ ${learned.falsePositivePatterns.join("; ")}\n`;
    }
    report += `\n`;
  }
  
  // Recommended Actions
  const actions = intel.recommendedActions.actions;
  if (actions.length > 0) {
    report += `🎯 RECOMMENDED NEXT PASSIVE ACTIONS\n`;
    for (const a of actions) {
      report += `  [${a.priority.toUpperCase()}] ${a.action}\n`;
      report += `    Rationale: ${a.rationale}\n`;
      report += `    Tools: ${a.tools.join(", ")} (passive)\n\n`;
    }
  } else {
    report += `✅ No immediate passive actions recommended\n\n`;
  }
  
  report += `════════════════════════════════════════\n`;
  report += `Read-only intelligence. No targets authorized. No exploitation.\n`;
  
  return report;
}