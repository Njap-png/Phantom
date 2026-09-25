// Phantom — structured logger
// Provides log.output, log.ok, log.warn, log.error, log.info, log.art, log.cli
// Respects --quiet / PHANTOM_QUIET for info/art/debug suppression.

const quiet = !!(process.env.PHANTOM_QUIET || process.argv.includes("--quiet") || process.argv.includes("-q"));
const json = process.argv.includes("--json");
const status = (...args) => (json ? console.error : console.log)(...args);
const write = method => (...args) => console[method](...args);

export const log = {
  art:   quiet ? ()=>{} : status,
  info:  quiet ? ()=>{} : status,
  ok:    status,
  warn:  write("warn"),
  error: write("error"),
  debug: ()=>{},
  output: write("log"),
  raw:   write("log"),
  cli:   write("log"),
};
