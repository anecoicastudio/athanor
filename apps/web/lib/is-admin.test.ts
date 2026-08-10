import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { isAdmin } from './is-admin';

const userWith = (meta: Partial<Pick<User, 'app_metadata' | 'user_metadata'>>) =>
  ({ app_metadata: {}, user_metadata: {}, ...meta }) as User;

describe('isAdmin', () => {
  it('admits a user whose app_metadata.role is admin', () => {
    expect(isAdmin(userWith({ app_metadata: { role: 'admin' } }))).toBe(true);
  });

  it('IGNORES user_metadata.role — it is self-writable, so trusting it would make admin self-grantable', () => {
    expect(isAdmin(userWith({ user_metadata: { role: 'admin' } }))).toBe(false);
  });

  it('does not admit an unrelated role', () => {
    expect(isAdmin(userWith({ app_metadata: { role: 'moderator' } }))).toBe(false);
  });

  it('does not admit a user with no role at all', () => {
    expect(isAdmin(userWith({}))).toBe(false);
  });

  it('does not admit an anonymous visitor', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('requires an exact match, not a prefix or different case', () => {
    expect(isAdmin(userWith({ app_metadata: { role: 'Admin' } }))).toBe(false);
    expect(isAdmin(userWith({ app_metadata: { role: 'administrator' } }))).toBe(false);
  });
});
