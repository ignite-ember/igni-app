/**
 * A change the panel can have in flight, named so the button that
 * started it can tell it is busy. Every button acting on one plugin
 * shares {@link PluginAction.plugin}, so its page and its catalog card
 * cannot start a second install of it while the first runs.
 */
export class PluginAction {
  private constructor(private readonly key: string) {}

  static refresh(): PluginAction {
    return new PluginAction("refresh");
  }

  /** Installing from the pasted git ref on the Installed tab. */
  static installRef(): PluginAction {
    return new PluginAction("install-ref");
  }

  /** Installing, enabling, disabling or removing one plugin. */
  static plugin(name: string): PluginAction {
    return new PluginAction(`plugin:${name}`);
  }

  static addMarketplace(): PluginAction {
    return new PluginAction("add-marketplace");
  }

  static removeMarketplace(name: string): PluginAction {
    return new PluginAction(`remove-marketplace:${name}`);
  }

  is(other: PluginAction): boolean {
    return this.key === other.key;
  }
}
