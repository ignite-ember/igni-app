/** A calm, neutral square standing in for a plugin, extension or
 *  marketplace that ships no icon of its own.
 *
 *  Deliberately not {@link Monogram}: that hashes the name to a colour
 *  so a *person* is the same hue everywhere — recognition for faces. A
 *  grid of plugins rendered that way is a wall of random colour. These
 *  are things, not people, so the glyph is monochrome and the list
 *  reads as one surface. */

/** One or two letters for a name — "M" from an address, first+last
 *  initial from a multi-word name, first two letters otherwise. */
function initials(name: string): string {
  const cleaned = (name || "").trim();
  if (!cleaned) return "?";
  const local = cleaned.includes("@") ? cleaned.split("@")[0] : cleaned;
  const words = local.split(/[\s._/-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function EntityGlyph({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span
      className="entity-glyph"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}
