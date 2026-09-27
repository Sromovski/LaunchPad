import { useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, api, type Decision } from './api';

export type DecisionMode = null | 'approve' | 'changes' | 'reject';

const DECISION: Record<Exclude<DecisionMode, null>, Decision> = {
  approve: 'approved',
  changes: 'changes_requested',
  reject: 'rejected',
};

interface Props {
  id: number;
  status: string;
  rightsNeeded: { nasa_id: string }[];
  mode: DecisionMode;
  setMode: (m: DecisionMode) => void;
  onDone: () => void;
}

export function DecisionPanel({ id, status, rightsNeeded, mode, setMode, onDone }: Props) {
  const [rightsChecked, setRightsChecked] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const rightsBox = useRef<HTMLInputElement>(null);
  const notesBox = useRef<HTMLTextAreaElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  const gateBlocked = rightsNeeded.length > 0 && !rightsChecked;

  // Opening a mode moves focus where the next keystroke belongs.
  useEffect(() => {
    setError(null);
    if (mode === 'approve' && gateBlocked) rightsBox.current?.focus();
    else if (mode === 'changes' || mode === 'reject') notesBox.current?.focus();
    else if (mode === 'approve') confirmBtn.current?.focus();
  }, [mode, gateBlocked]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode(null);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [mode, setMode]);

  if (status === 'changes_requested') {
    return (
      <p className="mt-4 text-center text-muted" data-testid="revision-pending">
        {done ? `${done} ` : ''}Claude applies your notes at the next automatic run (7:00 or 15:00), or right away with /revise-video {id} in Claude Code. The new version comes back to the queue.
      </p>
    );
  }
  if (status !== 'in_review') {
    return <p className="mt-4 text-center text-muted">{done ?? `${STATUS_LABEL[status] ?? status}. Nothing to decide.`}</p>;
  }

  const submit = async () => {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      await api.review(id, DECISION[mode], notes, rightsChecked);
      setDone(`${mode === 'approve' ? 'Approved' : mode === 'changes' ? 'Changes requested' : 'Rejected'}. Press J for the next video.`);
      setMode(null);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approveDisabled = gateBlocked || busy;
  const notesRequired = mode === 'changes';

  return (
    <div className="mt-4 rounded-2xl border border-line bg-panel p-4" data-testid="decision">
      {rightsNeeded.length > 0 && (
        <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-lg bg-dust-soft p-3">
          <input
            ref={rightsBox}
            type="checkbox"
            checked={rightsChecked}
            onChange={(e) => setRightsChecked(e.target.checked)}
            className="mt-1 h-5 w-5 accent-[var(--dust)]"
            data-testid="rights-checked"
          />
          <span>
            <span className="font-semibold">I checked the rights</span> for {rightsNeeded.map((r) => r.nasa_id).join(', ')}
          </span>
        </label>
      )}

      {mode === null && (
        <div className="grid grid-cols-3 gap-2">
          <ActionButton onClick={() => setMode('approve')} disabled={approveDisabled} tone="glow" hint="A" testId="approve">
            Approve
          </ActionButton>
          <ActionButton onClick={() => setMode('changes')} tone="dust" hint="C" testId="changes">
            Request changes
          </ActionButton>
          <ActionButton onClick={() => setMode('reject')} tone="rust" hint="R" testId="reject">
            Reject
          </ActionButton>
        </div>
      )}
      {mode === null && gateBlocked && <p className="mt-2 text-sm text-dust">Approve unlocks after you tick the rights box.</p>}

      {mode === 'approve' && (
        <div>
          {gateBlocked ? (
            <p className="text-dust">Tick "I checked the rights" first, then press A again.</p>
          ) : (
            <p>Approve this video? It will be ready to schedule. Nothing is posted yet.</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              ref={confirmBtn}
              onClick={submit}
              disabled={approveDisabled}
              className="flex-1 rounded-lg bg-glow px-4 py-2 font-bold text-bg disabled:opacity-40"
              data-testid="confirm"
            >
              Approve
            </button>
            <button onClick={() => setMode(null)} className="rounded-lg border border-line px-4 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {(mode === 'changes' || mode === 'reject') && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="font-semibold">{mode === 'changes' ? 'What should change?' : 'Reason (optional)'}</span>
            <textarea
              ref={notesBox}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={4}
              required={notesRequired}
              placeholder={mode === 'changes' ? 'e.g. Show the Sun earlier, slow the last line down' : 'e.g. Duplicate of video 1'}
              className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-ink placeholder:text-muted"
              data-testid="notes"
            />
          </label>
          <p className="text-sm text-muted">Ctrl+Enter to send, Esc to cancel.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={busy || (notesRequired && !notes.trim())}
              className={`flex-1 rounded-lg px-4 py-2 font-bold text-bg disabled:opacity-40 ${mode === 'changes' ? 'bg-dust' : 'bg-rust'}`}
              data-testid="confirm"
            >
              {mode === 'changes' ? 'Request changes' : 'Reject'}
            </button>
            <button type="button" onClick={() => setMode(null)} className="rounded-lg border border-line px-4 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-3 text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone,
  hint,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: 'glow' | 'dust' | 'rust';
  hint: string;
  testId: string;
}) {
  const color = { glow: 'bg-glow', dust: 'bg-dust', rust: 'bg-rust' }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2 py-2.5 font-bold leading-tight text-bg disabled:cursor-not-allowed disabled:opacity-40 ${color}`}
      aria-keyshortcuts={hint}
      data-testid={testId}
    >
      {children}
      <span className="block text-xs font-normal opacity-80">key {hint}</span>
    </button>
  );
}
