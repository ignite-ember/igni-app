/**
 * Putting text in the composer from outside it — a skill picked from a
 * panel, a message to edit and resend. The text is the model's
 * (``ui.composer``); the caret is the editor's, reached through the
 * handle the Composer fills in.
 */

import type { RefObject } from "react";

import type { WindowModel } from "../clientState";
import type { ComposerHandle } from "../components/composer/composerContract";
import { ComposerDraft } from "../components/composer/composerDraft";

export class ComposerSeeder {
  constructor(
    private readonly windowModel: Pick<WindowModel, "write">,
    private readonly handle: RefObject<ComposerHandle | null>,
  ) {}

  /** Arrow-bound: ``ShellPort.seedComposer`` holds it. A pre-fill enters
   *  the mode its prefix asks for, as typing it would. */
  seed = (text: string): void => {
    this.windowModel.write("composer", ComposerDraft.fromWire(text).toModel(), { force: true });
    this.handle.current?.focusAtEnd();
  };
}
