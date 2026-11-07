/** How many bytes go through `String.fromCharCode` at once: big enough to
 *  be quick, small enough not to overflow the call stack on a large blob. */
const CHUNK_BYTES = 0x8000;

/** Base64 of raw bytes. `btoa` takes a binary string, so the bytes are
 *  turned into one chunk by chunk first. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK_BYTES));
  }
  return btoa(bin);
}
