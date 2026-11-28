import { describe, expect, it } from "vitest";

import { InjectedUserNote } from "./injectedUserNote";

/** A tool result as igni-core's ``InjectedNote.render_onto`` writes it. */
const carrying = (result: string, ...texts: string[]): string =>
  `${result}\n\n[USER MESSAGE WHILE YOU WERE WORKING]\n${texts.map((t) => `- ${t}`).join("\n")}\n[END USER MESSAGE]`;

describe("InjectedUserNote", () => {
  it("is absent from a result that carries no message", () => {
    expect(InjectedUserNote.in("12 files")).toBeNull();
    expect(InjectedUserNote.in("")).toBeNull();
  });

  it("is absent when the block is not the result's end", () => {
    expect(InjectedUserNote.in(`${carrying("x", "a")}\nmore`)).toBeNull();
  });

  it("is absent without its header", () => {
    expect(InjectedUserNote.in("x\n- a\n[END USER MESSAGE]")).toBeNull();
  });

  it("counts the queued messages it carries, oldest first", () => {
    const note = InjectedUserNote.in(carrying("12 files", "first", "second"))!;
    expect(note.takenFrom(["first", "second"])).toBe(2);
    expect(note.takenFrom(["first", "second", "third"])).toBe(2);
  });

  it("carries none when the oldest queued message is not in it", () => {
    const note = InjectedUserNote.in(carrying("x", "second"))!;
    expect(note.takenFrom(["first", "second"])).toBe(0);
  });

  it("takes the oldest only when the next differs", () => {
    const note = InjectedUserNote.in(carrying("x", "first", "other"))!;
    expect(note.takenFrom(["first", "second"])).toBe(1);
  });

  it("does not take a message whose text only starts the line", () => {
    const note = InjectedUserNote.in(carrying("x", "first one"))!;
    expect(note.takenFrom(["first"])).toBe(0);
  });

  it("reads a message of several lines, and a result that was empty", () => {
    const note = InjectedUserNote.in(carrying("", "line one\nline two", "b").trimStart())!;
    expect(note.takenFrom(["line one\nline two", "b"])).toBe(2);
  });

  it("reads the last block when the tool's own output holds an earlier one", () => {
    const note = InjectedUserNote.in(carrying(carrying("x", "old"), "new"))!;
    expect(note.takenFrom(["new"])).toBe(1);
  });
});
