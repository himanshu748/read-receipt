/** SmartSpectra ValidationCode integers (from SDK docs). */
export const ValidationCode = {
  kOk: 0,
  kNoFaceFound: 1,
  kMultipleFacesFound: 2,
  kFaceNotCentered: 3,
  kFaceSizeOutOfRange: 4,
  kTooDark: 5,
  kTooBright: 6,
  kCameraTuning: 10,
  kFrameRateTooLow: 11,
  kExcessiveMotion: 12,
  kFaceTooClose: 13,
  kFaceTooFar: 14,
  kFaceTooHigh: 15,
  kFaceTooLow: 16,
  kFaceNotForward: 17,
} as const;

/** SmartSpectra SmartSpectraErrorCode integers used by the helper. */
export const ErrorCode = {
  kAuthenticationFailed: 2,
  kCreditExhausted: 4,
  kNetworkError: 5,
  kInputUnavailable: 7,
  kSustainedLowFrameRate: 14,
} as const;

export const FACE_POSITION_CODES: ReadonlySet<number> = new Set([
  ValidationCode.kFaceNotCentered,
  ValidationCode.kFaceSizeOutOfRange,
  ValidationCode.kFaceTooClose,
  ValidationCode.kFaceTooFar,
  ValidationCode.kFaceTooHigh,
  ValidationCode.kFaceTooLow,
]);

export const UNUSABLE_VALIDATION_CODES: ReadonlySet<number> = new Set([
  ValidationCode.kTooDark,
  ValidationCode.kTooBright,
  ValidationCode.kExcessiveMotion,
  ValidationCode.kFrameRateTooLow,
  ValidationCode.kCameraTuning,
]);
