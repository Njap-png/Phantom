import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";

const MISSIONS_DIR = resolve(homedir(), ".config", "phantom", "missions");

function parseSubfinderOutput(output, target, phase) {
  const results = [];
  if (!output || typeof output !== "string") return results;
  
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith("Error")) continue;
    
    const subdomain = trimmed.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (subdomain && subdomain.includes(".")) {
      results.push({
        type: "subdomain",
        value: subdomain,
        target,
        phase,
        source: "subfinder",
        timestamp: new Date().toISOString(),
        status: "success"
      });
    }
  }
  return results;
}

function parseDnsxOutput(output, target, phase) {
  const results = [];
  if (!output || typeof output !== "string") return results;
  
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.host) {
        results.push({
          type: "dns_record",
          name: parsed.host,
          recordType: parsed.a ? "A" : parsed.aaaa ? "AAAA" : parsed.cname ? "CNAME" : parsed.txt ? "TXT" : parsed.mx ? "MX" : parsed.ns ? "NS" : "UNKNOWN",
          value: parsed.a || parsed.aaaa || parsed.cname || parsed.txt || parsed.mx || parsed.ns || "",
          target,
          phase,
          source: "dnsx",
          timestamp: new Date().toISOString(),
          status: "success"
        });
      }
    } catch {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        results.push({
          type: "dns_record",
          name: parts[0],
          recordType: parts[1].toUpperCase(),
          value: parts.slice(2).join(" "),
          target,
          phase,
          source: "dnsx",
          timestamp: new Date().toISOString(),
          status: "success"
        });
      }
    }
  }
  return results;
}

function parseHttpxOutput(output, target, phase) {
  const results = [];
  if (!output || typeof output !== "string") return results;
  
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.url) {
        results.push({
          type: "http_service",
          url: parsed.url,
          statusCode: parsed.status_code,
          contentLength: parsed.content_length,
          technology: parsed.tech ? parsed.tech.map(t => t.toLowerCase()) : [],
          title: parsed.title || "",
          webServer: parsed.webserver || "",
          target,
          phase,
          source: "httpx",
          timestamp: new Date().toISOString(),
          status: "success"
        });
      }
    } catch {
      const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        results.push({
          type: "http_service",
          url: urlMatch[0],
          target,
          phase,
          source: "httpx",
          timestamp: new Date().toISOString(),
          status: "success"
        });
      }
    }
  }
  return results;
}

function parseNucleiOutput(output, target, phase) {
  const results = [];
  if (!output || typeof output !== "string") return results;
  
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.template_id) {
        results.push({
          type: "security_metadata",
          templateId: parsed.template_id,
          severity: parsed.info?.severity || "info",
          name: parsed.info?.name || "",
          description: parsed.info?.description || "",
          matchedAt: parsed.matched_at,
          target,
          phase,
          source: "nuclei",
          timestamp: new Date().toISOString(),
          status: "success"
        });
      }
    } catch {
      const sevMatch = trimmed.match(/\[(critical|high|medium|low|info)\]/i);
      if (sevMatch) {
        results.push({
          type: "security_metadata",
          raw: trimmed,
          severity: sevMatch[1].toLowerCase(),
          target,
          phase,
          source: "nuclei",
          timestamp: new Date().toISOString(),
          status: "success"
        });
      }
    }
  }
  return results;
}

function parseTLSOutput(output, target, phase) {
  const results = [];
  if (!output || typeof output !== "string") return results;
  
  try {
    const parsed = JSON.parse(output);
    if (parsed.subject || parsed.issuer || parsed.notAfter || parsed.notBefore || parsed.sans) {
      results.push({
        type: "tls_certificate",
        subject: parsed.subject || "",
        issuer: parsed.issuer || "",
        notBefore: parsed.notBefore || "",
        notAfter: parsed.notAfter || "",
        sans: parsed.sans || [],
        fingerprint: parsed.fingerprint || "",
        target,
        phase,
        source: "tlsx",
        timestamp: new Date().toISOString(),
        status: "success"
      });
    }
  } catch {
    // Text format - minimal parsing
    const certMatch = output.match(/subject=(.+)/i) || output.match(/issuer=(.+)/i);
    if (certMatch) {
      results.push({
        type: "tls_certificate",
        raw: output,
        target,
        phase,
        source: "tlsx",
        timestamp: new Date().toISOString(),
        status: "success"
      });
    }
  }
  return results;
}

function parseTechnologyOutput(output, target, phase, source) {
  const results = [];
  if (!output || typeof output !== "string") return results;
  
  const techPatterns = [
    /nginx\/[\d.]+/gi, /apache\/[\d.]+/gi, /iis\/[\d.]+/gi, /openresty\/[\d.]+/gi,
    /cloudflare/gi, /aws/gi, /google/gi, /microsoft/gi, /cloudfront/gi, /akamai/gi,
    /wordpress/gi, /drupal/gi, /joomla/gi, /magento/gi,
    /php\/[\d.]+/gi, /python\/[\d.]+/gi, /node\.js/gi, /express/gi, /django/gi, /rails/gi, /laravel/gi,
    /react/gi, /vue/gi, /angular/gi, /next\.js/gi, /nuxt/gi,
    /kubernetes/gi, /docker/gi, /traefik/gi, /envoy/gi, /haproxy/gi,
    /postgresql/gi, /mysql/gi, /mongodb/gi, /redis/gi,
    /grafana/gi, /prometheus/gi, /kibana/gi,
    /jenkins/gi, /gitlab/gi, /github/gi, /bitbucket/gi,
    /ssh/gi, /ftp/gi, /smtp/gi, /imap/gi
  ];
  
  for (const pattern of techPatterns) {
    const matches = output.match(pattern);
    if (matches) {
      for (const match of matches) {
        results.push({
          type: "technology",
          name: match.toLowerCase(),
          source,
          target,
          phase,
          timestamp: new Date().toISOString(),
          status: "success"
        });
      }
    }
  }
  return results;
}

export function normalizeObservations(missionId) {
  const missionDir = resolve(MISSIONS_DIR, missionId);
  if (!fs.existsSync(missionDir)) {
    return { observations: [], errors: ["Mission directory not found"] };
  }
  
  const observations = [];
  const errors = [];
  
  const phaseDirs = ["phase1_passive", "phase2_active", "phase3_validation"];
  
  for (const phaseDir of phaseDirs) {
    const dir = resolve(missionDir, phaseDir);
    if (!fs.existsSync(dir)) continue;
    
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(resolve(dir, file), "utf-8"));
        const result = content.result;
        const tool = content.tool;
        const target = content.target;
        const phase = content.phase;
        const savedAt = content.savedAt;
        
        if (!result) continue;
        
        let parsed = [];
        switch (tool) {
          case "subfinder":
            parsed = parseSubfinderOutput(result, target, phase);
            break;
          case "dnsx":
            parsed = parseDnsxOutput(result, target, phase);
            break;
          case "httpx":
            parsed = parseHttpxOutput(result, target, phase);
            break;
          case "nuclei":
            parsed = parseNucleiOutput(result, target, phase);
            break;
          case "tlsx":
            parsed = parseTLSOutput(result, target, phase);
            break;
          case "whatweb":
          case "wappalyzer":
          case "techdetect":
            parsed = parseTechnologyOutput(result, target, phase, tool);
            break;
        }
        
        // Extract technologies from any tool output
        if (typeof result === "string") {
          parsed.push(...parseTechnologyOutput(result, target, phase, tool));
        }
        
        // Add savedAt timestamp if available
        for (const obs of parsed) {
          if (savedAt) obs.savedAt = savedAt;
        }
        
        observations.push(...parsed);
      } catch (e) {
        errors.push({ file, error: e.message });
      }
    }
  }
  
  // Also parse error files to capture failed tool status
  const errorsDir = resolve(missionDir, "errors");
  if (fs.existsSync(errorsDir)) {
    const errorFiles = fs.readdirSync(errorsDir);
    for (const file of errorFiles) {
      try {
        const content = JSON.parse(fs.readFileSync(resolve(errorsDir, file), "utf-8"));
        observations.push({
          type: "error",
          tool: content.tool,
          target: content.target,
          phase: content.phase,
          error: content.error,
          timestamp: content.timestamp,
          status: "error"
        });
      } catch {
        // Ignore parse errors in error files
      }
    }
  }
  
  return { observations, errors };
}

export function loadMissionResults(missionId) {
  const { observations, errors } = normalizeObservations(missionId);
  return observations;
}

export function loadMissionErrors(missionId) {
  const { observations } = normalizeObservations(missionId);
  return observations.filter(o => o.status === "error");
}

export function getObservationsByType(missionId, type) {
  const { observations } = normalizeObservations(missionId);
  return observations.filter(o => o.type === type && o.status === "success");
}

export function getObservationsByPhase(missionId, phase) {
  const { observations } = normalizeObservations(missionId);
  return observations.filter(o => o.phase === phase && o.status === "success");
}