export interface WorkingAgent {
  agentId: string;
  lastOutputAt: number;
  taskId: string;
}

export interface StuckDetectorConfig {
  thresholdMs: number;
  pollIntervalMs: number;
  getWorkingAgents: () => WorkingAgent[];
  onStuck: (agentId: string, taskId: string) => void;
}

export class StuckDetector {
  private config: StuckDetectorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reportedStuck = new Set<string>();

  constructor(config: StuckDetectorConfig) {
    this.config = config;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.check(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    const now = Date.now();
    const agents = this.config.getWorkingAgents();
    for (const agent of agents) {
      const idleMs = now - agent.lastOutputAt;
      if (idleMs >= this.config.thresholdMs) {
        if (!this.reportedStuck.has(agent.agentId)) {
          this.reportedStuck.add(agent.agentId);
          this.config.onStuck(agent.agentId, agent.taskId);
        }
      } else {
        this.reportedStuck.delete(agent.agentId);
      }
    }
  }
}
