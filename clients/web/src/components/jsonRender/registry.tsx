/**
 * The json-render registry: the catalog (``catalog.ts``, the single
 * source of truth the LLM prompt is generated from) bound to the React
 * implementation of each entry, one module per component group.
 */

import { defineRegistry, type ComponentRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { actionComponents } from "./components/actions";
import { displayComponents } from "./components/display";
import { feedbackComponents } from "./components/feedback";
import { inputComponents } from "./components/inputs";
import { layoutComponents } from "./components/layout";

export const { registry } = defineRegistry(catalog, {
  components: {
    ...layoutComponents,
    ...displayComponents,
    ...actionComponents,
    ...inputComponents,
    ...feedbackComponents,
  },
});

/** Rendered for a spec element whose type the catalog does not know.
 *  It is registered on the Renderer directly, not through
 *  defineRegistry, so it receives the raw ``ComponentRenderProps``
 *  shape, whose ``element`` names the missing type. */
export const unknownComponent: ComponentRegistry[string] = ({ element }) => (
  <div className="jr-unknown">
    Unknown component <code>{String(element?.type ?? "?")}</code>
  </div>
);
