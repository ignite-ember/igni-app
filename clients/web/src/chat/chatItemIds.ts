/**
 * Allocates chat item ids: unique and increasing within one instance.
 *
 * Every item that can share a list must come from the same instance,
 * because the ids double as React keys. App owns one; each test and
 * demo makes its own.
 */
export class ChatItemIds {
  private issued = 0;

  next(): number {
    this.issued += 1;
    return this.issued;
  }

  /** The highest id handed out so far: a point in time that lets a
   *  caller tell later items from earlier ones without minting an id. */
  last(): number {
    return this.issued;
  }
}
