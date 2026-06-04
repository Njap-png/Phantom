export type AgentStatus = "idle" | "thinking" | "speaking" | "error" | "evolving";

export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
  persona: string;
  status: AgentStatus;
  color: string;
}

export interface AgentMessage {
  from: string;
  to: string | "all";
  content: string;
  timestamp: number;
  type: "text" | "code" | "command" | "system";
}

export interface AgentCapability {
  name: string;
  description: string;
  execute: (input: string) => Promise<string>;
}

export function generateAgentId(): string {
  const prefix = "PX";
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}
