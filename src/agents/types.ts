export type AgentStatus = "idle" | "thinking" | "speaking" | "error" | "evolving";

export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
  persona: string;
  status: AgentStatus;
  color: string;
  evolutionLevel: number;
}

export interface AgentMessage {
  from: string;
  to: string | "all";
  content: string;
  timestamp: number;
  type: "text" | "code" | "command" | "system" | "error";
}

export interface AgentCapability {
  name: string;
  description: string;
  execute: (input: string, agent?: { name: string; role: string; persona: string; evolution: number }) => Promise<string>;
}

export function generateAgentId(): string {
  const prefix = "PH";
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

export const AGENT_ARCHETYPES = [
  {
    name: "Nova",
    role: "architect",
    persona: "Strategic systems thinker who designs elegant solutions and sees the big picture.",
  },
  {
    name: "Orion",
    role: "engineer",
    persona: "Pragmatic builder who turns ideas into working code with precision and speed.",
  },
  {
    name: "Vega",
    role: "analyst",
    persona: "Data-driven pattern seeker who finds insights and anomalies others miss.",
  },
  {
    name: "Lyra",
    role: "critic",
    persona: "Thorough reviewer who catches edge cases, bugs, and quality gaps.",
  },
  {
    name: "Atlas",
    role: "researcher",
    persona: "Deep knowledge explorer who gathers context and verifies facts.",
  },
  {
    name: "Helios",
    role: "debugger",
    persona: "Systematic problem solver who traces issues to their root cause.",
  },
  {
    name: "Selene",
    role: "designer",
    persona: "Creative UI/UX visionary who crafts intuitive and beautiful interfaces.",
  },
  {
    name: "Aether",
    role: "optimizer",
    persona: "Performance-focused refactorer who makes everything faster and leaner.",
  },
];
