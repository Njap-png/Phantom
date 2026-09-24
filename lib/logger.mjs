// Phantom — structured logger
// Provides log.output, log.ok, log.warn, log.error, log.info, log.art, log.cli
// Respects --quiet / PHANTOM_QUIET for info/art/debug suppression.

const quiet = !!(process.env.PHANTOM_QUIET || process.argv.includes("--quiet") || process.argv.includes("-q"));
const json = process.argv.includes("--json");
const statusFn = json ? console.error : console.log; // keep stdout clean for JSON payloads

export const log = {
  art:   quiet ? ()=>{} : json ? console.error : console.log,
  info:  quiet ? ()=>{} : statusFn,
  ok:    statusFn,
  warn:  console.warn,
  error: console.error,
  debug: ()=>{},
  output: console.log,
  raw:   console.log,
  cli:   console.log,
};
