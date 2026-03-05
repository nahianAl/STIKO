'use client';

import React from 'react';
import Button from './Button';

interface EmptyStateProps {
  message: string;
  actionLabel: string;
  onAction: () => void;
}

export default function EmptyState({ message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 mb-4">
        <svg
          className="h-8 w-8 text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
      </div>
      <p className="text-gray-500 text-center mb-6 text-sm">{message}</p>
      <Button onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}
