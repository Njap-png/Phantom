import { existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { resolve, join } from "path";
import { pathToFileURL } from "url";
const TOOLS_DIR = resolve(homedir(), ".config", "phantom", "tools");
function ensureToolsDir() {
    if (!existsSync(TOOLS_DIR)) {
        mkdirSync(TOOLS_DIR, { recursive: true });
    }
}
export function saveDynamicTool(toolName, code) {
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
export async function loadDynamicTool(filePath, toolName, description) {
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
        execute: async (input, agentCtx) => {
            try {
                const result = await executeFn(input, agentCtx);
                return String(result);
            }
            catch (err) {
                return `[Tool Error in ${toolName}]: ${err.message}`;
            }
        }
    };
}
export async function loadAllDynamicTools() {
    ensureToolsDir();
    if (!existsSync(TOOLS_DIR))
        return [];
    const files = readdirSync(TOOLS_DIR);
    const tools = [];
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
//# sourceMappingURL=tools.js.map