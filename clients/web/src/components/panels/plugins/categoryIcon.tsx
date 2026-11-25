/** An icon for a plugin category.
 *
 * Plugin categories are a freeform, optional field — different
 * marketplaces define their own (the official one tags 13; others use
 * 3–15), and there is no fixed taxonomy. So this maps every category
 * name we have seen to a glyph, folds synonyms onto one glyph, and
 * falls back to a neutral tag for anything new, rather than pretending
 * a closed set exists. Adding a category is one line in CATEGORY_GLYPH.
 *
 * The glyphs are 16×16 stroke paths in the house style (no fill,
 * `currentColor`, round joins), so they sit beside the rest of Icons.
 */

/** One or more `<path d>` strings for a glyph. */
const GLYPHS: Record<string, readonly string[]> = {
  code: ["M6 4.5L2.5 8 6 11.5", "M10 4.5L13.5 8 10 11.5"],
  gauge: ["M2.6 11a5.4 5.4 0 0 1 10.8 0", "M8 11l2.8-2.8"],
  database: [
    "M4 4c0-1.1 1.8-2 4-2s4 .9 4 2-1.8 2-4 2-4-.9-4-2z",
    "M4 4v8c0 1.1 1.8 2 4 2s4-.9 4-2V4",
    "M4 8c0 1.1 1.8 2 4 2s4-.9 4-2",
  ],
  activity: ["M2 8h3l1.5-4 3 8 1.5-4h3"],
  shield: ["M8 2l5 2v3.5C13 10.5 11 12.5 8 14 5 12.5 3 10.5 3 7.5V4z"],
  pen: ["M3 13l.7-2.7 6.6-6.6 2 2-6.6 6.6z", "M9.5 4.2l2 2"],
  rocket: [
    "M8 1.5c2.2 1.4 3.3 4 3.3 6.4L8 10 4.7 7.9C4.7 5.5 5.8 2.9 8 1.5z",
    "M6.3 9.4L4 11.8M9.7 9.4L12 11.8M8 11v2.5",
  ],
  repeat: [
    "M3.4 8a4.6 4.6 0 0 1 7.8-3.3",
    "M11.4 2.6v2.4H9",
    "M12.6 8a4.6 4.6 0 0 1-7.8 3.3",
    "M4.6 13.4V11H7",
  ],
  sliders: [
    "M3 5h4.2M9.4 5h3.6",
    "M8.3 5a1.1 1.1 0 1 0-2.2 0 1.1 1.1 0 0 0 2.2 0z",
    "M3 11h3.6M8.8 11H13",
    "M10 11a1.1 1.1 0 1 0-2.2 0 1.1 1.1 0 0 0 2.2 0z",
  ],
  book: [
    "M8 4C6.8 3 5.3 2.6 3.5 2.6V11c1.8 0 3.3.4 4.5 1.4",
    "M8 4c1.2-1 2.7-1.4 4.5-1.4V11c-1.8 0-3.3.4-4.5 1.4",
    "M8 4v8.4",
  ],
  pin: ["M8 2a3.6 3.6 0 0 1 3.6 3.6C11.6 8.4 8 13 8 13S4.4 8.4 4.4 5.6A3.6 3.6 0 0 1 8 2z", "M8 6.6a1 1 0 1 0 0-.1z"],
  beaker: ["M6.2 2v3.4L3.3 11.4A1 1 0 0 0 4.2 13h7.6a1 1 0 0 0 .9-1.6L9.8 5.4V2", "M5.6 2h4.8", "M5 9.3h6"],
  sigma: ["M11 3H5l4 5-4 5h6"],
  swap: ["M3.5 6h9l-2.3-2.3", "M12.5 10h-9l2.3 2.3"],
  cloud: ["M5 12a3 3 0 0 1-.4-6 4 4 0 0 1 7.7 1.1A2.6 2.6 0 0 1 11.5 12z"],
  terminal: ["M2.5 3.5h11v9h-11z", "M5 7l2 1.6L5 10.2", "M8.4 10.2h2.6"],
  gitBranch: [
    "M3.6 4a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0z",
    "M3.6 12a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0z",
    "M9.6 5a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0z",
    "M5 5.4v5.2",
    "M11 6.4c0 2.3-2.6 2.4-4.2 3.4",
  ],
  globe: ["M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z", "M2.4 8h11.2", "M8 2c1.9 1.8 1.9 10.2 0 12M8 2c-1.9 1.8-1.9 10.2 0 12"],
  mobile: ["M5 2.5h6v11H5z", "M7 11.5h2"],
  chat: ["M3 3.5h10v6H7.5l-3 2.3V9.5H3z"],
  dollar: ["M8 2.5v11", "M10.2 5.1C10 4.1 9.1 3.6 8 3.6s-2.2.6-2.2 1.7S6.9 7 8 7s2.3.6 2.3 1.8-1 1.8-2.3 1.8-2.1-.5-2.4-1.5"],
  document: ["M4 2h5l3 3v9H4z", "M9 2v3h3", "M6 8.5h4M6 11h4"],
  chart: ["M3 2.5v10.5h10", "M5.5 11V7.5M8 11V5M10.5 11V8.5"],
  search: ["M7 2.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M10 10l3 3"],
  play: ["M6 4.5l5 3.5-5 3.5z"],
  envelope: ["M2.5 4h11v8h-11z", "M2.5 4.5L8 8.5l5.5-4"],
  calendar: ["M3 4h10v9.5H3z", "M3 6.8h10", "M5.5 2.5v2.6M10.5 2.5v2.6"],
  note: ["M4 2.5h5.5L12 5v8.5H4z", "M9 2.5V5h2.6", "M6 8h4M6 10.5h3"],
  server: ["M3 3h10v4H3zM3 9h10v4H3z", "M5.2 5h.01M5.2 11h.01"],
  network: ["M8 2.6a1.4 1.4 0 1 0 0 .1z", "M4 13.4a1.4 1.4 0 1 0 0-.1zM12 13.4a1.4 1.4 0 1 0 0-.1z", "M8 4v3M8 7L4.3 11.8M8 7l3.7 4.8"],
  lock: ["M4 7.2h8v6H4z", "M5.7 7.2V5.3a2.3 2.3 0 0 1 4.6 0v1.9"],
  infinity: ["M5.6 6.2a2.4 2.4 0 1 1 0 3.6c-1 .9-1.6 1.4-2.6.9s-1-1.9 0-2.7 1.6-.3 2.6.6l4.8 3.1", "M5.6 6.2l4.8 3.1"],
  braces: ["M6 2.6c-1.2 0-1.5.6-1.5 2.2S4 7 3 8c1 1 1.5 1.4 1.5 3.2S4.8 13.4 6 13.4", "M10 2.6c1.2 0 1.5.6 1.5 2.2S12 7 13 8c-1 1-1.5 1.4-1.5 3.2S11.2 13.4 10 13.4"],
  sparkles: ["M7 3l1.1 2.6L10.7 6.7 8.1 7.8 7 10.4 5.9 7.8 3.3 6.7l2.6-1.1z", "M11.5 9.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z"],
  heart: ["M8 13S3 10 3 6.3A2.6 2.6 0 0 1 8 5a2.6 2.6 0 0 1 5 1.3C13 10 8 13 8 13z"],
  tag: ["M3 3h5l5 5-5 5-5-5z", "M5.6 5.4a.6.6 0 1 0 0 .1z"],
};

/** Every category name we have seen → a glyph key above. Synonyms fold
 *  onto one glyph. Unlisted categories use the tag fallback. */
const CATEGORY_GLYPH: Record<string, keyof typeof GLYPHS> = {
  // The categories the official marketplace actually tags.
  development: "code",
  productivity: "gauge",
  database: "database",
  monitoring: "activity",
  security: "shield",
  design: "pen",
  deployment: "rocket",
  automation: "repeat",
  learning: "book",
  location: "pin",
  testing: "beaker",
  math: "sigma",
  migration: "swap",
  // Common across other marketplaces.
  ai: "sparkles",
  "machine-learning": "sparkles",
  ml: "sparkles",
  data: "database",
  analytics: "chart",
  devops: "infinity",
  cloud: "cloud",
  infrastructure: "server",
  networking: "network",
  network: "network",
  storage: "server",
  api: "braces",
  cli: "terminal",
  terminal: "terminal",
  shell: "terminal",
  git: "gitBranch",
  "version-control": "gitBranch",
  web: "globe",
  frontend: "globe",
  mobile: "mobile",
  communication: "chat",
  chat: "chat",
  support: "chat",
  finance: "dollar",
  payments: "dollar",
  billing: "dollar",
  documentation: "document",
  docs: "document",
  writing: "note",
  notes: "note",
  media: "play",
  video: "play",
  audio: "play",
  email: "envelope",
  calendar: "calendar",
  scheduling: "calendar",
  workflow: "repeat",
  integration: "swap",
  integrations: "swap",
  auth: "lock",
  authentication: "lock",
  identity: "lock",
  privacy: "shield",
  search: "search",
  science: "beaker",
  health: "heart",
  wellbeing: "heart",
  marketing: "chart",
  sales: "chart",
  education: "book",
  utilities: "sliders",
  tools: "sliders",
};

function glyphKey(category: string): keyof typeof GLYPHS {
  return CATEGORY_GLYPH[category.trim().toLowerCase()] ?? "tag";
}

/** The glyph for a category, in the shared stroke style. */
export function CategoryIcon({ category, size = 13 }: { category: string; size?: number }) {
  const paths = GLYPHS[glyphKey(category)];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
