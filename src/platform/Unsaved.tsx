import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Button } from '../components/Button';
import { Modal } from '../components/CounterDialogs';

type Form = { label: string; reset: () => void };

type UnsavedContext = {
  register: (id: string, form: Form) => void;
  unregister: (id: string) => void;
  /**
   * Resolves true when it's fine to go ahead: nothing else is unsaved, or the
   * person chose to discard it (those forms are reset). `except` is the form
   * doing the asking, whose own changes aren't being thrown away.
   */
  confirmDiscard: (except?: string) => Promise<boolean>;
};

const Context = createContext<UnsavedContext | null>(null);

function useUnsavedContext(): UnsavedContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useUnsaved outside UnsavedChangesProvider');
  return ctx;
}

/**
 * Marks a form as holding unsaved changes while `dirty`. Returns its id and
 * `confirmDiscard`, for actions that would throw away other forms' changes.
 */
export function useUnsaved(label: string, dirty: boolean, reset: () => void) {
  const { register, unregister, confirmDiscard } = useUnsavedContext();
  const id = useId();
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    if (!dirty) return;
    register(id, { label, reset: () => resetRef.current() });
    return () => unregister(id);
  }, [dirty, label, id, register, unregister]);

  return { id, confirmDiscard };
}

/** For actions outside any form (sign out) that must not lose edits. */
export function useConfirmDiscard() {
  return useUnsavedContext().confirmDiscard;
}

/**
 * Tracks every form on the platform with unsaved changes, and asks before
 * anything would lose them: changing page, signing out, closing the tab, or
 * an action that reloads the data under a half-edited form.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const forms = useRef(new Map<string, Form>());
  const [asking, setAsking] = useState<{ labels: string[]; answer: (discard: boolean) => void } | null>(null);

  const register = useCallback((id: string, form: Form) => {
    forms.current.set(id, form);
  }, []);
  const unregister = useCallback((id: string) => {
    forms.current.delete(id);
  }, []);

  const confirmDiscard = useCallback((except?: string) => {
    const others = [...forms.current].filter(([id]) => id !== except);
    if (others.length === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setAsking({
        labels: others.map(([, f]) => f.label),
        answer: (discard) => {
          setAsking(null);
          if (discard) {
            for (const [id, form] of others) {
              forms.current.delete(id);
              form.reset();
            }
          }
          resolve(discard);
        },
      });
    });
  }, []);

  // Changing page inside the platform.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      forms.current.size > 0 && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirmDiscard().then((discard) => (discard ? blocker.proceed() : blocker.reset()));
    // Runs once per block; the blocker object changes identity with its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // Closing or reloading the tab: the browser shows its own warning.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (forms.current.size === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const labels = asking?.labels ?? [];
  return (
    <Context.Provider value={{ register, unregister, confirmDiscard }}>
      {children}
      <Modal
        open={asking !== null}
        title="Discard unsaved changes?"
        sub={
          labels.length === 1
            ? `${labels[0]} has changes that haven’t been saved.`
            : `${labels.join(', ')} have changes that haven’t been saved.`
        }
        onClose={() => asking?.answer(false)}
      >
        <div className="pf-confirm">
          <Button variant="secondary" onClick={() => asking?.answer(false)} autoFocus>
            Keep editing
          </Button>
          <Button className="pf-discard" onClick={() => asking?.answer(true)}>
            Discard changes
          </Button>
        </div>
      </Modal>
    </Context.Provider>
  );
}
