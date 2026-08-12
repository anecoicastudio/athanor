/** Stripe Identity session statuses — mirrors the verifications.status CHECK (backend 06 §2.8). */
export const VERIFICATION_STATUSES = ['pending', 'verified', 'failed'] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
