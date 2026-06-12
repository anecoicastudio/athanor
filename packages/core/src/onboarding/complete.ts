type CompletenessFields = {
  handle: string | null;
  identity_tags: string[];
  seeking: string[];
};

/** PRD §4.1 acceptance: complete = handle + ≥1 identity tag + ≥1 seeking tag. Dream optional. */
export function isProfileComplete(profile: CompletenessFields): boolean {
  return Boolean(profile.handle) && profile.identity_tags.length > 0 && profile.seeking.length > 0;
}
