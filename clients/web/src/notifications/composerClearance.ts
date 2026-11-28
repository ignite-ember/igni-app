/** Where the toast stack sits so it never covers the composer: at the
 *  window's bottom-right corner when the composer is clear of that
 *  corner, lifted above the composer when the two would overlap. */

/** The box a toast stack is measured against. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class ComposerClearance {
  constructor(
    /** The stack's widest width, in px. */
    private readonly stackWidth: number,
    /** The gap to the window's edge and to the composer, in px. */
    private readonly gutter: number,
  ) {}

  /** The stack's distance from the window's bottom edge, in px. */
  bottomFor(composer: Box | null, viewport: { width: number; height: number }): number {
    if (!composer) return this.gutter;
    const stackLeft = viewport.width - this.gutter - this.stackWidth;
    const besideIt = stackLeft >= composer.right + this.gutter;
    const offScreen = composer.top >= viewport.height;
    if (besideIt || offScreen) return this.gutter;
    return Math.max(this.gutter, viewport.height - composer.top + this.gutter);
  }
}
