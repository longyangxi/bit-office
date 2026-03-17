"use client";

import { useState, useCallback } from "react";

function ConfirmModal({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        backgroundColor: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: "#1a1a2e", borderRadius: 14, padding: "28px 24px",
          maxWidth: 380, width: "90%", textAlign: "center",
          border: "1px solid #333", boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ color: "#eee", fontSize: 17, lineHeight: 1.6, marginBottom: 24 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "9px 28px", borderRadius: 8,
              border: "1px solid #444", backgroundColor: "#2a2a3e",
              color: "#aaa", fontSize: 15, cursor: "pointer",
            }}
          >
            No
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "9px 28px", borderRadius: 8, border: "none",
              backgroundColor: "#dc2626", color: "#fff",
              fontSize: 15, fontWeight: 600, cursor: "pointer",
            }}
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ message, resolve });
    });
  }, []);
  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);
  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);
  const modal = state ? (
    <ConfirmModal message={state.message} onConfirm={handleConfirm} onCancel={handleCancel} />
  ) : null;
  return { confirm, modal };
}

export default ConfirmModal;
