/**
 * The top fade's blur, as the owner tuned it in the playground
 * (``?demo=fade``, 27 Nov): eight layers, each blurring a little more and
 * reaching a little less far down, so content blurs progressively — in
 * both directions — before the opacity mask (``--top-fade-mask``)
 * dissolves it. One definition for the chat's header and every page.
 *
 * Distances are from the top of the blur's box: the window's top over the
 * chat, the matching point above a page's fixed header row.
 */

/** The tuned values. */
export const TOP_BLUR = {
  /** The strongest blur, in px, on the top layer. */
  maxBlur: 5,
  /** How many layers build it up. */
  layers: 8,
  /** Where the blur begins: content below is sharp. */
  start: 68,
  /** Where the blur reaches its strongest. */
  full: 18,
} as const;

/** One layer of the stack. */
export interface TopBlurLayer {
  /** Its blur, in px. */
  blur: number;
  /** Fully on from the top down to here. */
  solidTo: number;
  /** Gone from here down. */
  goneAt: number;
  /** Its box's height: past ``goneAt``, so the blur has content below
   *  its band to sample instead of smearing at the box's edge. */
  height: number;
  /** Its mask: on above ``solidTo``, off below ``goneAt``, smoothstep between. */
  mask: string;
}

/** Smoothstep at nine points between two y positions, as gradient stops. */
function smoothStops(from: number, to: number, fromAlpha: number, toAlpha: number): string {
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = fromAlpha + (toAlpha - fromAlpha) * t * t * (3 - 2 * t);
    stops.push(`rgba(0, 0, 0, ${a.toFixed(3)}) ${(from + (to - from) * t).toFixed(2)}px`);
  }
  return stops.join(", ");
}

/** The stack, weakest (reaching furthest down) first. */
export function topBlurLayers(params: typeof TOP_BLUR = TOP_BLUR): TopBlurLayer[] {
  const step = Math.max(1, params.start - params.full) / params.layers;
  return Array.from({ length: params.layers }, (_, k) => {
    const blur = (params.maxBlur * (k + 1)) / params.layers;
    const goneAt = params.start - k * step;
    const solidTo = Math.max(0, goneAt - step);
    return {
      blur,
      solidTo,
      goneAt,
      height: Math.ceil(goneAt) + 1 + Math.ceil(Math.max(24, blur * 4)),
      mask: `linear-gradient(to bottom, #000 0px, ${smoothStops(solidTo, goneAt, 1, 0)}, transparent ${(goneAt + 0.01).toFixed(2)}px, transparent 100%)`,
    };
  });
}
