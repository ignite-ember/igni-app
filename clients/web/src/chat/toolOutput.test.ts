import { describe, expect, it } from "vitest";

import { toolOutputForDisplay } from "./toolOutput";

describe("toolOutputForDisplay", () => {
  it("removes the model-facing wrapper round a tool's output", () => {
    const wrapped =
      "<untrusted_tool_output nonce=6ad364b6>\nREADME.md\ncalc.py\n</untrusted_tool_output nonce=6ad364b6>";
    expect(toolOutputForDisplay(wrapped)).toBe("README.md\ncalc.py");
  });

  it("keeps what igni appended after the block", () => {
    const wrapped =
      "<untrusted_tool_output nonce=ab12>\nout\n</untrusted_tool_output nonce=ab12>\n\n[hook] note";
    expect(toolOutputForDisplay(wrapped)).toBe("out\n\n[hook] note");
  });

  it("leaves unwrapped text, and a block whose nonces differ, as they are", () => {
    expect(toolOutputForDisplay("plain")).toBe("plain");
    const forged = "<untrusted_tool_output nonce=aa>\nx\n</untrusted_tool_output nonce=bb>";
    expect(toolOutputForDisplay(forged)).toBe(forged);
  });
});
