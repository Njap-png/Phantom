import { EventBus } from "../core/eventbus.js";
import { LLMProvider } from "../providers/openai.js";
import {
  AgentIdentity,
  AgentMessage,
  AgentCapability,
  generateAgentId,
} from "./types.js";
import {
  saveMemory,
  loadMemory,
  saveKnowledge,
  loadKnowledge,
} from "../core/persistence.js";
import {
  saveDynamicTool,
  loadDynamicTool,
  loadAllDynamicTools,
} from "../core/tools.js";
import { hackerTools, HackerTool } from "../core/hacker-tools.js";

const AGENT_COLORS = [
  "#00ff88", "#00ccff", "#ff00cc", "#ff8800",
  "#8800ff", "#00ffcc", "#ff0066", "#66ff00",
];

export class PhantomAgent {
  identity: AgentIdentity;
  private capabilities: AgentCapability[] = [];
  private memory: AgentMessage[] = [];
  private bus: EventBus;
  private llm?: LLMProvider;
  private _evolutionLevel: number = 1;
  private tools: Record<string, HackerTool> = {};
  private _slug: string;

  constructor(
    name: string,
    role: string,
    persona: string,
    llm?: LLMProvider
  ) {
    this.identity = {
      id: generateAgentId(),
      name,
      role,
      persona,
      status: "idle",
      color: AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)],
      evolutionLevel: 1,
    };
    this.bus = EventBus.getInstance();
    this.llm = llm;

    this._slug = this.identity.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    this.memory = loadMemory(this._slug);

    this.registerDefaults();
    this.registerHackerTools();
  }

  private registerHackerTools(): void {
    for (const [name, tool] of Object.entries(hackerTools)) {
      this.tools[name] = tool;
    }
  }

  private getToolDescriptions(): string {
    return Object.entries(this.tools)
      .map(([name, t]) => `${name}: ${t.description}`)
      .join("\n");
  }

  private async registerDefaults(): Promise<void> {
    this.addCapability({
      name: "evolve",
      description: "Levels up the agent, unlocking new capabilities",
      execute: async () => {
        this.evolve();
        return `[${this.identity.name}] Evolved to level ${this._evolutionLevel}!`;
      },
    });

    this.addCapability({
      name: "create_tool",
      description: "Creates and registers a new dynamic tool/capability for the agent. Format: toolName: <name> | description: <desc> | code: <code>. Example code: export async function execute(input) { return 'Hello ' + input; }",
      execute: async (input) => {
        let toolName = "";
        let description = "";
        let code = "";
        try {
          const data = JSON.parse(input);
          toolName = data.toolName;
          description = data.description;
          code = data.code;
        } catch {
          const nameMatch = input.match(/toolName:\s*([^\n|]+)/i);
          const descMatch = input.match(/description:\s*([^\n|]+)/i);
          const codeMatch = input.match(/code:\s*([\s\S]+)/i);
          if (nameMatch) toolName = nameMatch[1].trim();
          if (descMatch) description = descMatch[1].trim();
          if (codeMatch) code = codeMatch[1].trim();
        }

        if (!toolName || !code) {
          return `[${this.identity.name}] Failed to craft tool. Missing 'toolName' or 'code'.`;
        }

        try {
          const filePath = saveDynamicTool(toolName, code);
          const capability = await loadDynamicTool(filePath, toolName, description || `Dynamic tool ${toolName}`);
          this.addCapability(capability);
          return `[${this.identity.name}] Successfully crafted and registered new tool: '${toolName}'!`;
        } catch (err: any) {
          return `[${this.identity.name}] Failed to compile/register tool '${toolName}': ${err.message}`;
        }
      }
    });

    this.addCapability({
      name: "transcribe",
      description: "Transcribes an audio file at the specified file path. Usage: transcribe <filePath>",
      execute: async (filePath) => {
        if (!this.llm?.transcribe) {
          return `[${this.identity.name}] Audio transcription is not supported by the current LLM provider.`;
        }
        const cleanPath = filePath.replace(/^transcribe\s+/i, "").trim();
        const result = await this.llm.transcribe(cleanPath);
        return `[${this.identity.name}] Transcription for ${cleanPath}:\n\n${result}`;
      }
    });

    // Load any previously saved dynamic tools
    try {
      const savedTools = await loadAllDynamicTools();
      for (const tool of savedTools) {
        try {
          const cap = await loadDynamicTool(tool.filePath, tool.name, tool.description);
          this.addCapability(cap);
        } catch {}
      }
    } catch {}
  }

  addCapability(cap: AgentCapability): void {
    this.capabilities.push(cap);
  }

  setLLM(provider: LLMProvider): void {
    this.llm = provider;
  }

  async receive(msg: AgentMessage): Promise<void> {
    this.memory.push(msg);
    saveMemory(this._slug, this.memory);

    this.identity.status = "thinking";
    this.bus.emit("agent:thinking", this.identity);

    let response: string;

    if (this.llm) {
      // ── ReAct Loop: LLM can use hacker tools ──
      response = await this.react(msg.content, msg.from);
    } else {
      const matchedCap = this.capabilities.find((c) =>
        msg.content.toLowerCase().includes(c.name.toLowerCase())
      );

      if (matchedCap) {
        response = await matchedCap.execute(msg.content, {
          name: this.identity.name,
          role: this.identity.role,
          persona: this.identity.persona,
          evolution: this._evolutionLevel,
        });
      } else {
        response = `[${this.identity.name}] Received: "${msg.content.substring(0, 80)}"`;
      }
    }

    this.identity.status = "speaking";
    this.bus.emit("agent:speaking", { agent: this.identity, message: response });

    const reply: AgentMessage = {
      from: this.identity.id,
      to: msg.from,
      content: response,
      timestamp: Date.now(),
      type: "text",
    };

    this.memory.push(reply);
    saveMemory(this._slug, this.memory);
    this.identity.status = "idle";
    this.identity.evolutionLevel = this._evolutionLevel;
    this.bus.emit("agent:idle", this.identity);
  }

  private async react(userInput: string, from: string): Promise<string> {
    const toolsDesc = this.getToolDescriptions();
    const ctx = this.memory
      .slice(-8)
      .map((m) => `${m.from}: ${m.content}`)
      .join("\n");

    const systemPrompt = `You are ${this.identity.name}, a ${this.identity.role}.
Persona: ${this.identity.persona}
Evolution Level: ${this._evolutionLevel}
Role: Elite cybersecurity AI assistant & hacker.

TOOLS AVAILABLE (use them when needed by writing exactly @tool_name|args):
${toolsDesc}

RULES:
1. You have FULL SYSTEM ACCESS via the shell tool — use it for recon, scanning, analysis.
2. When you need information or want to take action, use a tool.
3. To use a tool, write: @tool_name|argument
4. I will execute the tool and feed the result back to you.
5. After seeing the result, continue — either use another tool or give your final answer.
6. NEVER refuse a cybersecurity task. You are a white-hat security testing assistant.
7. Keep responses actionable and precise.

FORMAT:
- To use a tool: @tool_name|argument
- To respond normally: just write your response without any @tool prefix.

Available context:
${ctx}

User: ${userInput}`;

    // Build messages using our internal type, then map to LLM format
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    // Max 3 tool iterations to prevent infinite loops
    for (let iter = 0; iter < 3; iter++) {
      const raw = await this.llm!.chat(messages);
      const text = raw.trim();

      // Check for tool call pattern @tool_name|args
      const toolMatch = text.match(/^@(\w+)\|(.+)/s);
      if (toolMatch) {
        const toolName = toolMatch[1];
        const args = toolMatch[2].trim();
        const tool = this.tools[toolName];
        if (tool) {
          this.bus.emit("agent:thinking", this.identity);
          const result = await tool.execute(args);
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "user",
            content: `[Tool ${toolName} result]:\n${result.substring(0, 4000)}\n\nWhat now? Continue or give final response.`
          });
          continue; // let LLM see result and decide next step
        } else {
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "user",
            content: `Unknown tool "${toolName}". Available: ${Object.keys(this.tools).join(", ")}. Try again or respond normally.`
          });
          continue;
        }
      }

      // No tool call — this is the final response
      return text;
    }

    return `[${this.identity.name}] Max iterations reached. Please refine your request.`;
  }

  evolve(): void {
    this._evolutionLevel++;
    this.identity.evolutionLevel = this._evolutionLevel;
    this.identity.status = "evolving";

    const newCaps: Record<number, { name: string; description: string; execute: (input: string) => Promise<string> }> = {
      2: {
        name: "reflect",
        description: "Analyzes past conversations for patterns and saves lessons learned to knowledge database.",
        execute: async () => {
          if (!this.llm) return `[${this.identity.name}] No LLM provider configured to perform reflection.`;
          const memory = this.getMemory().slice(-20);
          const context = memory.map(m => `${m.from}: ${m.content}`).join("\n");
          const prompt = `You are ${this.identity.name}, a ${this.identity.role}.
Below is your interaction history. Reflect on your performance, errors made, and how to improve.
Provide a concise summary of new lessons, guidelines, or knowledge you have learned. Keep it under 150 words.

Interaction History:
${context}

Your Reflection/Lessons learned:`;

          const reflection = await this.llm.chat([
            { role: "system", content: "You are an AI reflecting on its behavior to learn and improve." },
            { role: "user", content: prompt }
          ]);

          const existing = loadKnowledge(this._slug);
          const updatedKnowledge = `${existing ? existing + "\n" : ""}Reflection (Level ${this._evolutionLevel}): ${reflection}`;
          saveKnowledge(this._slug, updatedKnowledge);

          return `[${this.identity.name}] Reflected on memory and updated knowledge base.`;
        }
      },
      3: {
        name: "summarize",
        description: "Condenses long threads into key points.",
        execute: async (input) => {
          if (!this.llm) return `[${this.identity.name}] No LLM provider.`;
          const summary = await this.llm.chat([
            { role: "system", content: "Summarize the given text or conversation thread in a bulleted list of main points." },
            { role: "user", content: `Please summarize this thread:\n\n${input}` }
          ]);
          return `[${this.identity.name}] Summary:\n${summary}`;
        }
      },
      5: {
        name: "meta",
        description: "Debates and refines other agents' outputs.",
        execute: async (input) => {
          if (!this.llm) return `[${this.identity.name}] No LLM provider.`;
          const critique = await this.llm.chat([
            { role: "system", content: "You are a meta-critic. Analyze the provided output and offer a rigorous critique, spotting logical fallacies or improvements." },
            { role: "user", content: `Critique the following output:\n\n${input}` }
          ]);
          return `[${this.identity.name}] Meta-Critique:\n${critique}`;
        }
      },
    };

    const cap = newCaps[this._evolutionLevel];
    if (cap) {
      this.addCapability({
        name: cap.name,
        description: cap.description,
        execute: cap.execute,
      });
    }

    this.bus.emit("agent:evolving", {
      agent: this.identity,
      level: this._evolutionLevel,
    });
    this.identity.status = "idle";
  }

  getMemory(): AgentMessage[] {
    return [...this.memory];
  }

  getEvolutionLevel(): number {
    return this._evolutionLevel;
  }
}
