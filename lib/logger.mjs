// Phantom — structured logger
// Provides log.output, log.ok, log.warn, log.error, log.info, log.art, log.cli
// Respects --quiet / PHANTOM_QUIET for info/art/debug suppression.

const quiet = !!(process.env.PHANTOM_QUIET || process.argv.includes("--quiet") || process.argv.includes("-q"));

export const log = {
  art:   quiet ? ()=>{} : console.log,
  info:  quiet ? ()=>{} : console.log,
  ok:    console.log,
  warn:  console.warn,
  error: console.error,
  debug: ()=>{},
  output: console.log,
  raw:   console.log,
  cli:   console.log,
};
