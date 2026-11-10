import { FlameIcon } from "./Icons";

/** The group's mark, or igni's flame when it has none.
 *
 *  A group's mark renders as an ``img``, never inlined as markup: an SVG
 *  document can carry script, the same bytes in an ``img`` cannot. See
 *  ``lib/theme.ts``. */
export function BrandMark({ mark, size }: { mark: string | null; size: number }) {
  return mark ? (
    <img className="brand-mark" src={mark} alt="" width={size} height={size} />
  ) : (
    <FlameIcon size={size} />
  );
}
