#!/usr/bin/env node

import { detectEnv } from "./core/config.js";

const env = detectEnv();

if (env.isTermux) {
  const { PhantomTermuxUI } = await import("./ui/termux.js");
  const ui = new PhantomTermuxUI();
  ui.start();
} else if (env.screenSize === "tiny" || env.screenSize === "small") {
  const { PhantomTermuxUI } = await import("./ui/termux.js");
  const ui = new PhantomTermuxUI();
  ui.start();
} else if (env.isWindows && env.terminal === "windows-console") {
  const { PhantomTermuxUI } = await import("./ui/termux.js");
  const ui = new PhantomTermuxUI();
  ui.start();
} else {
  const { PhantomTerminal } = await import("./ui/terminal.js");
  const terminal = new PhantomTerminal();
  terminal.start();
}
