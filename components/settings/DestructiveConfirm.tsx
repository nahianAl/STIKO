'use client';

import React, { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Note } from '@/components/ui/Primitives';

/**
 * 3q — destructive confirmation.
 *
 * Three rules for every destructive confirm: count what dies, require typing
 * the name, and offer the reversible alternative.
 */
export function DestructiveConfirm({
  isOpen,
  onClose,
  onConfirm,
  title,
  name,
  consequence,
  inventory,
  reversibleHint,
  confirmLabel,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** Typed back verbatim to confirm. */
  name: string;
  consequence: string;
  inventory: { label: string; value: number; urgent?: boolean }[];
  reversibleHint?: string;
  confirmLabel: string;
}) {
  const [typed, setTyped] = useState('');

  // A stale value from a previous open must never leave the button armed.
  useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen]);

  const matches = typed.trim() === name.trim();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="-mt-2 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
            style={{ background: '#FFE2E2' }}
          >
            <svg
              className="h-[18px] w-[18px]"
              style={{ color: '#B23A52' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </span>
          <h2 className="text-[17px] font-extrabold text-stiko-ink">{title}</h2>
        </div>

        <p className="text-[13px] leading-[1.6] text-stiko-secondary">
          {consequence}
        </p>

        {/* Count what dies. These are real numbers, not placeholders. */}
        <div className="rounded-inset bg-stiko-app p-4">
          {inventory.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between py-[5px] text-[12.5px]"
            >
              <span className="text-stiko-secondary">{row.label}</span>
              <span
                className="font-extrabold"
                style={{ color: row.urgent ? '#B23A52' : '#1C2030' }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <label className="block">
          <span className="mb-[6px] block text-[12px] font-bold text-stiko-secondary">
            Type <span className="text-stiko-ink">{name}</span> to confirm
          </span>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </label>

        {reversibleHint && <Note>{reversibleHint}</Note>}
      </div>
    </Modal>
  );
}
