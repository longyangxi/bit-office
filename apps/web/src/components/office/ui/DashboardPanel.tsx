"use client";
import TermModal from "./primitives/TermModal";
import DashboardStats from "./DashboardStats";
import ActivityHeatmap from "./ActivityHeatmap";
import AgentRoster from "./AgentRoster";
import { useDashboardData } from "./useDashboardData";

interface DashboardPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DashboardPanel({ isOpen, onClose }: DashboardPanelProps) {
  const data = useDashboardData();

  return (
    <TermModal open={isOpen} onClose={onClose} title="Team Dashboard" maxWidth={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 200 }}>
        <DashboardStats
          totalProjects={data.totalProjects}
          totalFilesChanged={data.totalFilesChanged}
          totalTokens={data.totalTokens}
          totalCostUsd={data.totalCostUsd}
        />
        <ActivityHeatmap data={data.heatmapData} />
        <AgentRoster agents={data.agentStats} />
      </div>
    </TermModal>
  );
}
