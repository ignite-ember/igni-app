/**
 * What this window knows about the files it uploaded: their names and
 * their sizes.
 *
 * The upload RPC answers with the size, and the composer knows the
 * name — but neither survives in the message, which carries only the
 * path (or the cloud's ``attachment:<id>``). This is where they are
 * kept, for the block under the message to draw.
 *
 * A message read back from the history has no entry here, and the
 * block then says what it can: the name from the path, and no size.
 */

export interface UploadFacts {
  /** The name the file was uploaded under. */
  name: string;
  /** Its size in bytes. */
  size: number;
}

/** The uploads of this window, by the path the upload answered with. */
export class UploadRegistry {
  private readonly facts = new Map<string, UploadFacts>();

  /** What is known about the file uploaded at `path`. */
  of(path: string): UploadFacts | undefined {
    return this.facts.get(path);
  }

  /** Keep what is known about the file uploaded at `path`. */
  remember(path: string, facts: UploadFacts): void {
    this.facts.set(path, facts);
  }
}

/** The registry this window's uploads are kept in. */
export const uploadRegistry = new UploadRegistry();
