import { describe, expect, it } from "vitest";

import { SessionStartup } from "./sessionStartup";
import type { TokenRecount } from "./statusSource";

function startup(recount: TokenRecount) {
  const steps: string[] = [];
  const later = (name: string) => async () => {
    steps.push(`${name}:start`);
    await Promise.resolve();
    steps.push(`${name}:end`);
  };
  const run = new SessionStartup({
    source: {
      recountTokens: async () => {
        steps.push("recount:start");
        await Promise.resolve();
        steps.push("recount:end");
        return recount;
      },
    },
    refreshStatus: later("status"),
    refreshSessions: later("sessions"),
    loadCatalog: later("catalog"),
    checkUpdate: async (silent) => {
      steps.push(`update:${silent ? "silent" : "loud"}`);
    },
  }).run;
  return { run, steps };
}

describe("SessionStartup", () => {
  it("recounts first, then refreshes, then waits for the catalog, then checks quietly", async () => {
    const { run, steps } = startup({ ok: true });
    await run();
    expect(steps.slice(0, 4)).toEqual([
      "recount:start",
      "recount:end",
      "status:start",
      "sessions:start",
    ]);
    expect(steps.indexOf("catalog:start")).toBeGreaterThan(steps.indexOf("sessions:start"));
    expect(steps.indexOf("update:silent")).toBeGreaterThan(steps.indexOf("catalog:end"));
  });

  it("goes on when the recount fails", async () => {
    const { run, steps } = startup({ ok: false, reason: "tokenizer not ready" });
    await run();
    expect(steps).toContain("status:start");
    expect(steps).toContain("sessions:start");
    expect(steps).toContain("catalog:end");
    expect(steps).toContain("update:silent");
  });
});
