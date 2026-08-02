import { useCallback, useReducer } from "react";

/**
 * Generic linear undo/redo history over a single value `T` — the editor
 * uses exactly one of these over its whole document (style, cursor, zoom
 * keyframes, slices, clip trim, aspect ratio; see `document.ts`), not one
 * per field. A single shared timeline is what makes "Undo" mean "undo the
 * last edit, whatever it touched" instead of raising "undo *what*,
 * specifically?" — per-field stacks would let a style change and a slice
 * change interleave in an order undo can't reconstruct.
 *
 * Two ways to change `present`, matching the two shapes user input takes:
 * - `set(updater)`: one call = one undo step. For discrete actions (a
 *   button click, a toggle, a menu selection).
 * - `setTransient(updater)` + `commit()`: for a continuous interaction (a
 *   slider drag, a timeline drag). `setTransient` is called on every
 *   intermediate value so the UI stays live; only `commit()` — called once,
 *   when the interaction ends — turns the *whole drag* into a single undo
 *   step. The value pushed onto `past` is the one from just before the
 *   first `setTransient` call after the last commit, captured in
 *   `pendingSnapshot`, not whatever `present` happens to be by the time
 *   `commit` fires.
 */

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  /** Snapshot of `present` from just before the in-progress transient
   * sequence started; `null` when nothing is pending. */
  pendingSnapshot: T | null;
}

type Updater<T> = T | ((prev: T) => T);

function resolve<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
}

type HistoryAction<T> =
  | { type: "set"; updater: Updater<T> }
  | { type: "setTransient"; updater: Updater<T> }
  | { type: "commit" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "patch"; patch: Partial<T> }
  | { type: "reset"; state: T };

export function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "set": {
      const next = resolve(action.updater, state.present);
      if (Object.is(next, state.present)) return state;
      return { past: [...state.past, state.present], present: next, future: [], pendingSnapshot: null };
    }
    case "setTransient": {
      const next = resolve(action.updater, state.present);
      if (Object.is(next, state.present)) return state;
      // Only the *first* transient update since the last commit captures
      // the snapshot — later ones in the same drag must not overwrite it
      // with an already-live (uncommitted) value.
      const pendingSnapshot = state.pendingSnapshot ?? state.present;
      return { ...state, present: next, pendingSnapshot };
    }
    case "commit": {
      if (state.pendingSnapshot === null) return state;
      return { past: [...state.past, state.pendingSnapshot], present: state.present, future: [], pendingSnapshot: null };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        pendingSnapshot: null,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest, pendingSnapshot: null };
    }
    case "patch":
      // Merges initial async data (bundle load, video metadata) into
      // `present` without creating an undo step — only used during setup,
      // before the user could have made an edit for this to clobber.
      return { ...state, present: { ...state.present, ...action.patch } };
    case "reset":
      return { past: [], present: action.state, future: [], pendingSnapshot: null };
    default:
      return state;
  }
}

function initialHistoryState<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [], pendingSnapshot: null };
}

export interface UseHistoryResult<T> {
  state: T;
  canUndo: boolean;
  canRedo: boolean;
  /** One discrete edit = one undo step. */
  set: (updater: Updater<T>) => void;
  /** Live update during a continuous interaction — pair with `commit()`. */
  setTransient: (updater: Updater<T>) => void;
  /** Collapses everything since the last commit into a single undo step. */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  /** Merges initial data in without creating an undo step. */
  patch: (patch: Partial<T>) => void;
}

export function useHistoryState<T>(initial: T): UseHistoryResult<T> {
  const [state, dispatch] = useReducer(historyReducer<T>, initial, initialHistoryState);

  const set = useCallback((updater: Updater<T>) => dispatch({ type: "set", updater }), []);
  const setTransient = useCallback((updater: Updater<T>) => dispatch({ type: "setTransient", updater }), []);
  const commit = useCallback(() => dispatch({ type: "commit" }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const patch = useCallback((p: Partial<T>) => dispatch({ type: "patch", patch: p }), []);

  return {
    state: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    set,
    setTransient,
    commit,
    undo,
    redo,
    patch,
  };
}
