/**
 * Handles nobody may claim (#430).
 *
 * The concern is impersonation, not routing. `apps/web` resolves public profiles at `/@handle`
 * (`apps/web/lib/resolve-handle.ts` returns null for any segment without the leading `@`), so a
 * handle equal to a literal route never shadows it — the namespaces are disjoint. What no
 * namespace can fix is that `@supporto` or `@athanor_support`, with a chosen display name and
 * avatar, is a credible-looking official account anyone can create for free.
 *
 * Italian and English both, because IT is the canonical catalogue (rules/i18n.md): `@supporto`
 * reads as official to this member base exactly as `@support` does.
 *
 * THE DATABASE IS THE ENFORCER, not this list. `profiles.handle` carries INSERT and UPDATE for
 * `authenticated` (verified against the hosted catalog's column_privileges, not inferred from
 * the migrations), so a client can set and later change its own handle without passing through
 * any schema here. This constant exists so a client can refuse early with a good message, and
 * so the CHECK constraint has one authored home; `reserved-handles.mirror.test.ts` is what keeps
 * the two from drifting.
 *
 * ROLE WORDS ONLY, not brand vocabulary. `aura` is deliberately absent: the score is the
 * product's central term but a member at `@aura` claims no authority, and it is what
 * `suggestHandle` falls back to when an address has no usable local part. Reserving a word for
 * being precious rather than for being impersonated is a naming policy, and this is not one.
 *
 * Sorted, so an addition lands in one obvious place and the mirror test's order equality against
 * the SQL array is mechanical.
 */
export const RESERVED_HANDLES = [
  'abuse',
  'admin',
  'administrator',
  'aiuto',
  'amministratore',
  'assistenza',
  'contact',
  'contatto',
  'help',
  'info',
  'legal',
  'legale',
  'mod',
  'moderator',
  'moderatore',
  'no_reply',
  'noreply',
  'official',
  'root',
  'security',
  'sicurezza',
  'staff',
  'support',
  'supporto',
  'system',
  'team',
  'ufficiale',
] as const;

/**
 * The brand name is a PREFIX rule rather than a list entry: exact matching stops `athanor` and
 * nothing else, while the realistic impersonation is `athanor_support` or `athanorofficial`.
 * Only the brand gets this treatment — `admin` is reserved but `admin_luna` is a person.
 */
export const RESERVED_HANDLE_PREFIX = 'athanor';

/** True when `handle` may not be claimed. Case-insensitive: the client-side call site sees whatever was typed. */
export function isReservedHandle(handle: string): boolean {
  const normalised = handle.toLowerCase();
  return (
    normalised.startsWith(RESERVED_HANDLE_PREFIX) ||
    (RESERVED_HANDLES as readonly string[]).includes(normalised)
  );
}
