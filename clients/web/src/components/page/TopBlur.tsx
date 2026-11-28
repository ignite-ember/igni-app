import type { CSSProperties } from "react";

import { topBlurLayers } from "./topBlurLayers";

const LAYERS = topBlurLayers();

/** The top fade's layered blur: drawn inside the chat header's and every page's blur box. */
export function TopBlur() {
  return (
    <>
      {LAYERS.map((layer, i) => {
        const filter = `blur(${layer.blur.toFixed(3)}px)`;
        const style: CSSProperties = {
          height: layer.height,
          backdropFilter: filter,
          WebkitBackdropFilter: filter,
          maskImage: layer.mask,
          WebkitMaskImage: layer.mask,
        };
        return <div key={i} className="top-blur-layer" style={style} />;
      })}
    </>
  );
}
