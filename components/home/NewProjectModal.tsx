'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';

/**
 * Creating a project without going through the package flow.
 *
 * Name only. The empty card the new project produces IS the prompt to add a
 * package, so there is nothing to duplicate from app/new/page.tsx here.
 */
export default function NewProjectModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  // A reopened modal must not still hold the last attempt's text.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setSaving(false);
    }
  }, [isOpen]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onCreated();
      onClose();
    } catch {
      // Staying open with the text intact is the only way the person can
      // retry without retyping.
      toast('Could not create the project.');
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New project"
      subtitle="A project holds the packages you send for review."
      width={440}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!name.trim() || saving}>
            {saving ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      }
    >
      <label
        htmlFor="new-project-name"
        className="mb-[6px] block text-[12px] font-bold text-stiko-secondary"
      >
        Project name
      </label>
      <Input
        id="new-project-name"
        autoFocus
        value={name}
        placeholder="Riverside Tower"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
        }}
      />
      <p className="mt-[10px] text-[12px] text-stiko-muted">
        You can add packages to it straight afterwards.
      </p>
    </Modal>
  );
}
