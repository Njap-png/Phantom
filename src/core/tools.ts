import { existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { resolve, join } from "path";
import { pathToFileURL } from "url";
import { AgentCapability } from "../agents/types.js";

const TOOLS_DIR = resolve(homedir(), ".config", "phantom", "tools");

function ensureToolsDir(): void {
  if (!existsSync(TOOLS_DIR)) {
    mkdirSync(TOOLS_DIR, { recursive: true });
  }
}

export function saveDynamicTool(toolName: string, code: string): string {
  ensureToolsDir();
  const fileName = `dynamic_${toolName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}.js`;
  const filePath = join(TOOLS_DIR, fileName);

  // Wrap the code if it doesn't already export execute
  let fileContent = code;
  if (!code.includes("export async function execute") && !code.includes("export function execute") && !code.includes("export default")) {
    fileContent = `
export async function execute(input) {
  ${code}
}
`;
  }

  writeFileSync(filePath, fileContent, "utf-8");
  return filePath;
}

export async function loadDynamicTool(filePath: string, toolName: string, description: string): Promise<AgentCapability> {
  const fileUrl = pathToFileURL(filePath).href;
  // Use a query parameter cache buster so Node.js can re-import the file if it changed
  const module = await import(`${fileUrl}?t=${Date.now()}`);
  const executeFn = module.execute || module.default;

  if (typeof executeFn !== "function") {
    throw new Error(`Dynamic tool ${toolName} does not export an 'execute' function.`);
  }

  return {
    name: toolName,
    description,
    execute: async (input: string, agentCtx?: any) => {
      try {
        const result = await executeFn(input, agentCtx);
        return String(result);
      } catch (err: any) {
        return `[Tool Error in ${toolName}]: ${err.message}`;
      }
    }
  };
}

export async function loadAllDynamicTools(): Promise<{ name: string; description: string; filePath: string }[]> {
  ensureToolsDir();
  if (!existsSync(TOOLS_DIR)) return [];

  const files = readdirSync(TOOLS_DIR);
  const tools: { name: string; description: string; filePath: string }[] = [];

  for (const file of files) {
    if (file.startsWith("dynamic_") && file.endsWith(".js")) {
      const filePath = join(TOOLS_DIR, file);
      const name = file.replace("dynamic_", "").replace(".js", "");
      // We can infer description from file or just use a generic one
      tools.push({
        name,
        description: `Dynamically created tool: ${name}`,
        filePath
      });
    }
  }

  return tools;
}
