/**
 * The files a message names, told apart by where they are.
 *
 * The rule under test: an upload is under the project's attachments
 * folder (``<projectDir>/.igni/attachments/<sessionId>/<name>``) or the
 * cloud's own reference; everything else is a reference inside the
 * sentence. The name of a file never decides it — a project file and an
 * upload can share one.
 */

import { describe, expect, it } from "vitest";

import { MessageAttachments, UploadLocations } from "./messageAttachments";
import { UploadRegistry } from "./uploadRegistry";

const PROJECT = "/work/proj";
const UPLOAD = "/work/proj/.igni/attachments/s1/report.pdf";

function classify(text: string, projectDir = PROJECT, registry = new UploadRegistry()) {
  return new MessageAttachments(text, { projectDir }, registry);
}

describe("an upload under the attachments folder", () => {
  it("is an upload, not a reference", () => {
    const files = classify(`here it is @${UPLOAD}`);
    expect(files.uploads.map((f) => f.path)).toEqual([UPLOAD]);
    expect(files.references).toEqual([]);
  });

  it("is an upload when the path is relative to the project", () => {
    const files = classify("here it is @.igni/attachments/s1/report.pdf");
    expect(files.uploads.map((f) => f.path)).toEqual([".igni/attachments/s1/report.pdf"]);
  });

  it("is an upload when the path is written the Windows way", () => {
    const files = classify("here it is @C:\\work\\proj\\.igni\\attachments\\s1\\report.pdf", "C:\\work\\proj");
    expect(files.uploads.map((f) => f.path)).toEqual([
      "C:\\work\\proj\\.igni\\attachments\\s1\\report.pdf",
    ]);
  });

  it("is an upload when the project is not known yet", () => {
    const files = classify("here it is @/work/proj/.igni/attachments/s1/report.pdf", "");
    expect(files.uploads.map((f) => f.path)).toEqual([
      "/work/proj/.igni/attachments/s1/report.pdf",
    ]);
  });

  it("is an upload when the cloud keeps it, and answers with a reference", () => {
    const ref = "attachment:0123456789abcdef0123456789abcdef";
    const files = classify(`here it is @${ref}`);
    expect(files.uploads.map((f) => f.path)).toEqual([ref]);
  });
});

describe("a file the message only mentions", () => {
  it("is a reference, not an upload", () => {
    const files = classify("look at @src/main.py");
    expect(files.references.map((f) => f.path)).toEqual(["src/main.py"]);
    expect(files.uploads).toEqual([]);
  });

  it("is a reference when it is named by its full path", () => {
    const files = classify("look at @/work/proj/src/main.py");
    expect(files.references.map((f) => f.path)).toEqual(["/work/proj/src/main.py"]);
    expect(files.uploads).toEqual([]);
  });

  it("is a reference when it sits in another project's attachments folder", () => {
    const files = classify("look at @/work/other/.igni/attachments/s1/report.pdf");
    expect(files.uploads).toEqual([]);
    expect(files.references).toHaveLength(1);
  });

  it("is a reference when the path climbs out of the attachments folder", () => {
    const files = classify("look at @/work/proj/.igni/attachments/../secrets.txt");
    expect(files.uploads).toEqual([]);
    expect(files.references).toHaveLength(1);
  });

  it("is a reference when it is the attachments folder itself", () => {
    const files = classify("look at @/work/proj/.igni/attachments");
    expect(files.uploads).toEqual([]);
    expect(files.references).toHaveLength(1);
  });
});

describe("the files a message names", () => {
  it("names each file once, however often it is mentioned", () => {
    const files = classify(`@${UPLOAD} and again @${UPLOAD}`);
    expect(files.uploads).toHaveLength(1);
  });

  it("tells the bubble which of its paths are uploads", () => {
    const files = classify(`see @src/main.py and @${UPLOAD}`);
    expect(files.isUpload(UPLOAD)).toBe(true);
    expect(files.isUpload("src/main.py")).toBe(false);
  });

  it("keeps the tokens of the message, so the text around them is drawn", () => {
    const files = classify(`before @src/main.py after`);
    expect(files.tokens.map((t) => t.kind)).toEqual(["text", "file", "text"]);
  });
});

describe("what the block under the message says about a file", () => {
  it("names the file, labels it by its extension and measures it", () => {
    const registry = new UploadRegistry();
    registry.remember(UPLOAD, { name: "Q3 report.pdf", size: 2048 });
    const files = classify(`@${UPLOAD}`, PROJECT, registry);
    const file = files.uploads[0];
    expect(file.name).toBe("Q3 report.pdf");
    expect(file.label).toBe("PDF");
    expect(file.size).toBe(2048);
    expect(file.sizeLabel).toBe("2 KB");
  });

  it("says no size when the window does not know one", () => {
    const file = classify(`@${UPLOAD}`).uploads[0];
    expect(file.size).toBeUndefined();
    expect(file.sizeLabel).toBe("");
  });

  it("names a cloud upload by the name it was uploaded under", () => {
    const ref = "attachment:0123456789abcdef0123456789abcdef";
    const registry = new UploadRegistry();
    registry.remember(ref, { name: "shot.png", size: 900 });
    const file = classify(`@${ref}`, PROJECT, registry).uploads[0];
    expect(file.name).toBe("shot.png");
    expect(file.image).toBe(true);
  });

  it("calls a file without an extension a FILE", () => {
    const file = classify("@/work/proj/.igni/attachments/s1/Makefile").uploads[0];
    expect(file.label).toBe("FILE");
    expect(file.image).toBe(false);
  });
});

describe("where the uploads live", () => {
  it("puts them under the project's attachments directory", () => {
    const locations = new UploadLocations({ projectDir: PROJECT });
    expect(locations.directory).toEqual(["work", "proj", ".igni", "attachments"]);
  });
});
