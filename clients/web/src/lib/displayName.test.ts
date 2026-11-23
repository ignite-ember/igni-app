import { describe, expect, it } from "vitest";

import { nameFromEmail } from "./displayName";

describe("nameFromEmail", () => {
  it("turns first.last into First Last", () => {
    expect(nameFromEmail("ada.lovelace@acme.com")).toBe("Ada Lovelace");
    expect(nameFromEmail("dmytro.zezyk@vectorbridge.ai")).toBe("Dmytro Zezyk");
  });

  it("handles the other separators people use", () => {
    expect(nameFromEmail("grace_hopper@navy.mil")).toBe("Grace Hopper");
    expect(nameFromEmail("jean-luc.picard@sf.example")).toBe("Jean Luc Picard");
  });

  it("capitalises a single-word local part", () => {
    expect(nameFromEmail("dev@acme.com")).toBe("Dev");
  });

  it("is empty when there is no address", () => {
    expect(nameFromEmail("")).toBe("");
    expect(nameFromEmail(null)).toBe("");
    expect(nameFromEmail(undefined)).toBe("");
  });
});
