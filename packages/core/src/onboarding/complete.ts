type CompletenessFields = {
  handle: string | null;
  identity_tags: string[];
  seeking: string[];
};

/** PRD §4.1 acceptance: complete = handle + ≥1 identity tag + ≥1 seeking tag. Dream optional. */
export function isProfileComplete(profile: CompletenessFields): boolean {
  return Boolean(profile.handle) && profile.identity_tags.length > 0 && profile.seeking.length > 0;
}

/**
 * Where an incomplete profile goes next (#782). The funnel's answers come first — they are asked
 * before the account exists and flushed after it — and the @handle is chosen on its own screen
 * once they have landed, never derived from the email. `null` means nothing is left to ask.
 */
export function nextOnboardingStep(profile: CompletenessFields): 'funnel' | 'handle' | null {
  if (profile.identity_tags.length === 0 || profile.seeking.length === 0) return 'funnel';
  return profile.handle ? null : 'handle';
}
