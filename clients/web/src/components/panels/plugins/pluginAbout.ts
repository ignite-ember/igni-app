import type { WirePayload } from "../../../protocol/wirePayload";

/** What every plugin row says about itself, installed or in a catalog.
 *  An absent description or version reads as the empty string. */
export class PluginAbout {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly version: string,
  ) {}

  static read(p: WirePayload): PluginAbout {
    return new PluginAbout(p.string("name"), p.string("description"), p.string("version"));
  }

  /** This, with each empty field taken from ``fallback``. */
  or(fallback: PluginAbout): PluginAbout {
    return new PluginAbout(
      this.name || fallback.name,
      this.description || fallback.description,
      this.version || fallback.version,
    );
  }
}
