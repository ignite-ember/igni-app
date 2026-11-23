/**
 * A human name from an email address, for when the igni server has not
 * sent the account's real display name yet (offline, air-gapped, or
 * still loading). ``ada.lovelace@acme.com`` → ``Ada Lovelace``.
 *
 * A best-effort stand-in only: it is never used when the account's own
 * name is known, and the full address stays in the account menu. The
 * local part is split on the separators people put between names
 * (``.`` ``_`` ``+`` ``-``) and each word is capitalised.
 */
export function nameFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
