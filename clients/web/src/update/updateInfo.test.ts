import { describe, expect, it } from "vitest";

import { UpdateInfo } from "./updateInfo";

describe("UpdateInfo", () => {
  it("reads a check's answer", () => {
    const info = UpdateInfo.parse({
      available: true,
      current_version: "0.6.0",
      latest_version: "0.7.0",
      download_url: "https://example.com/d",
    });
    expect(info).toEqual(new UpdateInfo(true, "0.6.0", "0.7.0", "https://example.com/d"));
  });

  it("has nothing to say about a missing or non-object answer", () => {
    expect(UpdateInfo.parse(null)).toBeNull();
    expect(UpdateInfo.parse("0.7.0")).toBeNull();
    expect(UpdateInfo.parse([])).toBeNull();
  });

  it("reads lenient fields as their fallbacks", () => {
    expect(UpdateInfo.parse({ available: 1, latest_version: 7 })).toEqual(
      new UpdateInfo(true, "", "", undefined),
    );
  });

  it("round-trips through the dialog spec", () => {
    const info = new UpdateInfo(true, "1", "2");
    const spec = info.toDialogSpec();
    expect(spec).toEqual({ kind: "update", available: true, current_version: "1", latest_version: "2" });
    expect(UpdateInfo.fromDialogSpec(spec)).toEqual(info);
    expect(UpdateInfo.fromDialogSpec({ kind: "extension" })).toBeNull();
  });
});
