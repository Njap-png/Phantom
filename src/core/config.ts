export interface PhantomConfig {
  agents: {
    maxInstances: number;
    defaultModel: string;
    heartbeatInterval: number;
  };
  ui: {
    borderStyle: string;
    animationSpeed: number;
    starfieldParticles: number;
  };
  network: {
    allowedOrigins: string[];
    port: number;
  };
}

export const defaultConfig: PhantomConfig = {
  agents: {
    maxInstances: 8,
    defaultModel: "gpt-4o",
    heartbeatInterval: 3000,
  },
  ui: {
    borderStyle: "line",
    animationSpeed: 50,
    starfieldParticles: 120,
  },
  network: {
    allowedOrigins: ["*"],
    port: 8080,
  },
};
