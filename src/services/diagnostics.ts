import { invoke } from '@tauri-apps/api/core';
import type { DiagnosticsSnapshot } from '../shared/types';

export function getDiagnosticsSnapshot(lineLimit = 80): Promise<DiagnosticsSnapshot> {
  return invoke<DiagnosticsSnapshot>('get_diagnostics_snapshot', { lineLimit });
}
