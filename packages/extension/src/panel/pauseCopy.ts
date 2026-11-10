import type { PauseReason } from '@rr/protocol';

/** User-facing pause reason copy. Pulse is liveness only — never medical. */
export const PAUSE_REASON_COPY: Record<PauseReason, string> = {
  'not-started': 'Press Start to begin',
  calibrating: 'Look at the middle of your editor',
  'no-face': 'No face in view',
  'multiple-faces': 'Only one person in view, please',
  'face-not-forward': 'Face the screen',
  'looking-down': 'Eyes back on the editor',
  'eyes-closed': 'Eyes open to keep counting',
  'no-pulse-yet': 'Checking for a live viewer…',
  'pulse-lost': 'Live signal lost — receipts paused',
  'too-dark': 'Too dark',
  'too-bright': 'Too bright',
  'excessive-motion': 'Hold still',
  'low-frame-rate': 'Camera too slow',
  'camera-tuning': 'Camera is adjusting…',
  'face-position': 'Center your face in the camera',
  'credits-exhausted':
    'Presage credits used up — receipts paused. Replay mode still works.',
  'auth-failed':
    'Presage API key rejected — run Read Receipt: Set Presage API Key, then Start again',
  network: 'Network error reaching Presage — check your connection, then Start again',
  'camera-unavailable':
    'Camera unavailable — check permissions and that no other app is using it',
  'sdk-error': 'Camera helper error — press Stop, then Start again',
  'panel-hidden': 'Review panel hidden — camera off',
};

export function pauseReasonMessage(reasons: PauseReason[]): string {
  if (reasons.length === 0) return 'Eyes on screen';
  const first = reasons[0];
  if (first === undefined) return 'Eyes on screen';
  return PAUSE_REASON_COPY[first];
}
