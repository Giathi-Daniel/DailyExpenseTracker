import { createContext, useContext } from 'react';
import type { Transaction, TxKind } from '../core/schema';

export interface Editor {
  add: (kind: TxKind) => void;
  edit: (tx: Transaction) => void;
}

/** Opens the shared add/edit transaction dialog from anywhere in the app. */
export const EditorContext = createContext<Editor>({ add: () => {}, edit: () => {} });
export const useEditor = () => useContext(EditorContext);
