// Auto-generated wrapper for httprobe
// Created by Phantom auto-evolution

export default async function(input) {
try {
      const { execSync } = await import("child_process");
      const targets = input.trim();
      if (!targets) return "[httprobe] Usage: @httprobe|<targets>\nProbe for alive HTTP/HTTPS servers. Takes list of hosts.\nExamples:\n  httprobe|example.com:443\n  httprobe|subs.txt";
      const r = execSync(`echo "${targets}" | httprobe`, { encoding: "utf-8", timeout: 60000, maxBuffer: 1024 * 1024 });
      return r.trim() || "(no alive hosts)";
    } catch (e) { return `[httprobe Error] ${e.message}`; }
}
