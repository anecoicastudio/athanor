type CompletenessFields = {
  handle: string | null;
  identity_tags: string[];
  seeking: string[];
};

/**
 * Where an incomplete profile goes next (#782). The funnel's answers come first — they are asked
 * before the account exists and flushed after it — and the @handle is chosen on its own screen
 * once they have landed, never derived from the email. `null` means complete, PRD §4.1's
 * acceptance: a handle, ≥1 identity tag and ≥1 seeking tag (the dream is optional).
 */
export function nextOnboardingStep(profile: CompletenessFields): 'funnel' | 'handle' | null {
  if (profile.identity_tags.length === 0 || profile.seeking.length === 0) return 'funnel';
  return profile.handle ? null : 'handle';
}
