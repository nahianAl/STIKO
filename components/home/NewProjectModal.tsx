'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Primitives';
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

  // Closing mid-flight cannot cancel the request, so it must not pretend to:
  // the project would be created anyway, or the error toast would arrive after
  // the modal was gone. This covers Escape and the scrim too, because Modal
  // routes all of its dismiss paths through onClose.
  const requestClose = () => {
    if (!saving) onClose();
  };

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
    } catch (err) {
      // Staying open with the text intact is the only way the person can
      // retry without retyping.
      console.error('Failed to create project', err);
      toast('Could not create the project.');
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="New project"
      subtitle="A project holds the packages you send for review."
      width={440}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!name.trim() || saving}>
            {saving ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      }
    >
      <Field label="Project name">
        <Input
          autoFocus
          value={name}
          placeholder="Riverside Tower"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
      </Field>
      <p className="mt-[10px] text-[12px] text-stiko-muted">
        You can add packages to it straight afterwards.
      </p>
    </Modal>
  );
}
