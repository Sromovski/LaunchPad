import { useState } from 'react';
import { api, type Draft } from './api';

export function DraftEditor({ id, initial, readOnly }: { id: number; initial: Draft; readOnly: boolean }) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [tags, setTags] = useState(initial.hashtags.join(' '));
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });
  // What's on the server now; 'dirty' compares against this, not the first load.
  const [baseline, setBaseline] = useState({ title: initial.title, description: initial.description, tags: initial.hashtags.join(' ') });

  const dirty = title !== baseline.title || description !== baseline.description || tags !== baseline.tags;

  const save = async () => {
    setState({ kind: 'saving' });
    try {
      await api.saveDraft(id, { title, description, hashtags: tags.split(/\s+/).filter(Boolean) });
      setBaseline({ title, description, tags });
      setState({ kind: 'saved' });
    } catch (e) {
      setState({ kind: 'error', msg: (e as Error).message });
    }
  };

  const field = 'mt-1 w-full rounded-lg border border-line bg-panel p-2 text-ink disabled:opacity-60';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="font-semibold">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} maxLength={100} className={field} data-testid="draft-title" />
      </label>
      <label className="block">
        <span className="font-semibold">Description</span>
        <span className="ml-2 text-sm text-muted">Must keep the credits, the source links and "Narration voice is AI-generated."</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} rows={12} className={`${field} text-base`} />
      </label>
      <label className="block">
        <span className="font-semibold">Hashtags</span>
        <span className="ml-2 text-sm text-muted">3 to 5, separated by spaces</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)} disabled={readOnly} className={field} />
      </label>
      {!readOnly && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!dirty || state.kind === 'saving'} className="rounded-lg bg-glow px-4 py-2 font-bold text-bg disabled:opacity-40">
            Save text
          </button>
          {state.kind === 'saved' && !dirty && <span className="text-ok">Saved.</span>}
          {state.kind === 'saved' && dirty && <span className="text-muted">Unsaved changes.</span>}
          {state.kind === 'error' && (
            <span className="text-rust" role="alert">
              Not saved: {state.msg}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
