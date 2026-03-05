'use client';

import React from 'react';

interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
}

interface VersionTimelineProps {
  versions: Version[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function VersionTimeline({
  versions,
  selectedVersionId,
  onSelectVersion,
}: VersionTimelineProps) {
  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Versions</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {versions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            Submit your first version to get started
          </p>
        ) : (
          versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            return (
              <button
                key={version.id}
                onClick={() => onSelectVersion(version.id)}
                className={`w-full text-left rounded-lg p-3 transition-colors duration-150 ${
                  isSelected
                    ? 'bg-blue-50 border-2 border-blue-500'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-sm font-semibold ${
                      isSelected ? 'text-blue-700' : 'text-gray-900'
                    }`}
                  >
                    V{version.versionNumber}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  {formatDate(version.createdAt)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Submitted by Anonymous
                </p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
