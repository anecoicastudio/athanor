/** Derive an @handle suggestion from an email. Rules: ^[a-z0-9_]{3,30}$ (schemas.handleSchema). */
export function suggestHandle(email: string): string {
  const local = email.split('@')[0] ?? '';
  let handle = local
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (handle.length === 0) return 'stella';
  while (handle.length < 3) handle += '_';
  return handle.slice(0, 30);
}
