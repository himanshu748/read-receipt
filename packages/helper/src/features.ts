/**
 * Derive face pose / openness ratios from MediaPipe 478-point landmarks.
 * Raw landmarks never leave this module.
 */

export interface Landmark {
  x: number;
  y: number;
}

export interface FaceFeatures {
  /** (nose.y − eyeMid.y) / faceHeight */
  pitch: number;
  /** (nose.x − eyeMid.x) / interocular */
  yaw: number;
  /** mean vertical lid gap / interocular */
  eyeOpenness: number;
}

/** MediaPipe Face Mesh indices used for ratios. */
const IDX = {
  noseTip: 1,
  forehead: 10,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  leftEyeLower: 145,
  chin: 152,
  leftEyeUpper: 159,
  rightEyeOuter: 263,
  rightEyeInner: 362,
  rightEyeLower: 374,
  rightEyeUpper: 386,
} as const;

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function meanPoint(points: readonly Landmark[]): Landmark {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  const n = points.length;
  return { x: x / n, y: y / n };
}

/**
 * Convert a 478-point landmark list into pitch/yaw/eyeOpenness ratios.
 * Returns null if required indices are missing or denominators are ~0.
 */
export function featuresFromLandmarks(
  landmarks: readonly Landmark[],
): FaceFeatures | null {
  const need = Object.values(IDX);
  for (const i of need) {
    if (landmarks[i] === undefined) return null;
  }

  const nose = landmarks[IDX.noseTip]!;
  const forehead = landmarks[IDX.forehead]!;
  const chin = landmarks[IDX.chin]!;
  const leftOuter = landmarks[IDX.leftEyeOuter]!;
  const leftInner = landmarks[IDX.leftEyeInner]!;
  const rightOuter = landmarks[IDX.rightEyeOuter]!;
  const rightInner = landmarks[IDX.rightEyeInner]!;
  const leftUpper = landmarks[IDX.leftEyeUpper]!;
  const leftLower = landmarks[IDX.leftEyeLower]!;
  const rightUpper = landmarks[IDX.rightEyeUpper]!;
  const rightLower = landmarks[IDX.rightEyeLower]!;

  const eyeMid = meanPoint([leftOuter, leftInner, rightOuter, rightInner]);
  const interocular = dist(leftOuter, rightOuter);
  const faceHeight = dist(forehead, chin);

  if (interocular < 1e-9 || faceHeight < 1e-9) return null;

  const leftGap = dist(leftUpper, leftLower);
  const rightGap = dist(rightUpper, rightLower);
  const eyeOpenness = (leftGap + rightGap) / 2 / interocular;

  return {
    pitch: (nose.y - eyeMid.y) / faceHeight,
    yaw: (nose.x - eyeMid.x) / interocular,
    eyeOpenness,
  };
}
