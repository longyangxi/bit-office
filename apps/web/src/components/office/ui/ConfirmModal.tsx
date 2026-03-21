"use client";

import { useState, useCallback } from "react";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";

function ConfirmModal({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <TermModal
      open={true}
      onClose={onCancel}
      maxWidth={380}
      title="Confirm"
      footer={
        <>
          <TermButton variant="dim" onClick={onCancel}>No</TermButton>
          <TermButton variant="danger" onClick={onConfirm}>Yes</TermButton>
        </>
      }
    >
      <div style={{ textAlign: "center", lineHeight: 1.6 }}>
        {message}
      </div>
    </TermModal>
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
