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

    const slug = this.identity.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    this.memory = loadMemory(slug);

    this.registerDefaults();
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
    const slug = this.identity.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    saveMemory(slug, this.memory);

    this.identity.status = "thinking";
    this.bus.emit("agent:thinking", this.identity);

    let response: string;

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
    } else if (this.llm) {
      const knowledge = loadKnowledge(slug);
      const systemMsg = `You are ${this.identity.name}, a ${this.identity.role} with the persona: ${this.identity.persona}. Evolution level: ${this._evolutionLevel}. Respond in character. Keep responses concise.${
        knowledge ? `\n\nLearned Knowledge / Insights:\n${knowledge}` : ""
      }`;
      const context = this.memory
        .slice(-6)
        .map((m) => `${m.from}: ${m.content}`)
        .join("\n");

      response = await this.llm.chat([
        { role: "system", content: systemMsg },
        { role: "user", content: `${context}\n${msg.from}: ${msg.content}` },
      ]);
    } else {
      response = `[${this.identity.name}] Received: "${msg.content.substring(0, 80)}"`;
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
    saveMemory(slug, this.memory);
    this.identity.status = "idle";
    this.identity.evolutionLevel = this._evolutionLevel;
    this.bus.emit("agent:idle", this.identity);
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

          const slug = this.identity.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const existing = loadKnowledge(slug);
          const updatedKnowledge = `${existing ? existing + "\n" : ""}Reflection (Level ${this._evolutionLevel}): ${reflection}`;
          saveKnowledge(slug, updatedKnowledge);

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
