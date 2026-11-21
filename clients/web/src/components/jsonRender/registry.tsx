/**
 * The json-render registry: the catalog (``catalog.ts``, the single
 * source of truth the LLM prompt is generated from) bound to the React
 * implementation of each entry, one module per component group.
 */

import { defineRegistry, type ComponentRegistry } from "@json-render/react";
import { useContext, useEffect } from "react";
import { catalog } from "./catalog";
import { ElementFailureContext, guarded } from "./guarded";
import { actionComponents } from "./components/actions";
import { displayComponents } from "./components/display";
import { feedbackComponents } from "./components/feedback";
import { inputComponents } from "./components/inputs";
import { layoutComponents } from "./components/layout";

export const { registry } = defineRegistry(catalog, {
  components: guarded({
    ...layoutComponents,
    ...displayComponents,
    ...actionComponents,
    ...inputComponents,
    ...feedbackComponents,
  }),
});

/** Why the client could not draw an element whose type the catalog
 *  does not know, as the card reports it. */
export const UNKNOWN_TYPE_MESSAGE = "it is not a type the catalog knows";

/** Rendered for a spec element whose type the catalog does not know.
 *  It is registered on the Renderer directly, not through
 *  defineRegistry, so it receives the raw ``ComponentRenderProps``
 *  shape, whose ``element`` names the missing type.
 *
 *  The placeholder is drawn, not thrown, so no boundary catches it: it
 *  tells the card itself that the element was not drawn. Otherwise the
 *  card reports that it drew every element over a placeholder (R666). */
export const unknownComponent: ComponentRegistry[string] = ({ element }) => {
  const type = String(element?.type ?? "?");
  const onFailure = useContext(ElementFailureContext);
  useEffect(() => {
    onFailure({ type, message: UNKNOWN_TYPE_MESSAGE });
  }, [onFailure, type]);
  return (
    <div className="jr-unknown">
      Unknown component <code>{type}</code>
    </div>
  );
};
