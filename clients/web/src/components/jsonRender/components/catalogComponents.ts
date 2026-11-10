import type { Components } from "@json-render/react";
import type { catalog } from "../catalog";

/** The React implementation of every catalog entry, typed against the
 *  catalog's Zod props. Each group module picks the entries it owns. */
export type CatalogComponents = Components<typeof catalog>;
