/** How the catalog grid is ordered and narrowed — the sort and the
 *  category filter the header's two menus drive, applied to the
 *  search-matched entries. */

import type { CatalogEntry } from "./marketplace";

export type SortKey = "default" | "name-asc" | "name-desc" | "category";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "default", label: "Default order" },
  { key: "name-asc", label: "Name (A–Z)" },
  { key: "name-desc", label: "Name (Z–A)" },
  { key: "category", label: "Category" },
];

/** The filter value that keeps every category. */
export const ALL_CATEGORIES = "all";

/** The distinct categories the catalog actually uses, alphabetical. */
export function categoriesOf(entries: CatalogEntry[]): string[] {
  const seen = new Set<string>();
  for (const { plugin } of entries) if (plugin.category) seen.add(plugin.category);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** A category key as a title-cased label; the "all" sentinel reads
 *  "All categories". */
export function categoryLabel(category: string): string {
  if (category === ALL_CATEGORIES) return "All categories";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Keep only the chosen category, then order — leaving the catalog's own
 *  order alone for ``default``. */
export function applyCatalogView(
  entries: CatalogEntry[],
  sort: SortKey,
  category: string,
): CatalogEntry[] {
  let out = entries;
  if (category !== ALL_CATEGORIES) out = out.filter((e) => e.plugin.category === category);
  const byName = (a: CatalogEntry, b: CatalogEntry) =>
    a.plugin.name.localeCompare(b.plugin.name);
  if (sort === "name-asc") out = [...out].sort(byName);
  else if (sort === "name-desc") out = [...out].sort((a, b) => byName(b, a));
  else if (sort === "category")
    out = [...out].sort(
      (a, b) => (a.plugin.category || "").localeCompare(b.plugin.category || "") || byName(a, b),
    );
  return out;
}
