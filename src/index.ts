#!/usr/bin/env node

import { isTermux } from "./core/config.js";

if (isTermux()) {
  const { PhantomTermuxUI } = await import("./ui/termux.js");
  const ui = new PhantomTermuxUI();
  ui.start();
} else {
  const { PhantomTerminal } = await import("./ui/terminal.js");
  const terminal = new PhantomTerminal();
  terminal.start();
}
