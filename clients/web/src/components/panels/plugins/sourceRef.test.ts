import { describe, expect, it } from "vitest";

import { SourceRef } from "./sourceRef";

describe("SourceRef", () => {
  it("splits a subdirectory install back out", () => {
    const ref = SourceRef.parse("https://github.com/acme/plugins.git [lint]");
    expect(ref.url).toBe("https://github.com/acme/plugins.git");
    expect(ref.subdir).toBe("lint");
    expect(ref.displayUrl).toBe("https://github.com/acme/plugins");
    expect(ref.isHttp).toBe(true);
  });

  it("takes a plain source whole", () => {
    const ref = SourceRef.parse("  git@host:x.git ");
    expect(ref.url).toBe("git@host:x.git");
    expect(ref.subdir).toBe("");
    expect(ref.displayUrl).toBe("git@host:x");
    expect(ref.isHttp).toBe(false);
  });
});
