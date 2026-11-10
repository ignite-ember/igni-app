import { describe, expect, it } from "vitest";
import { LOG_LINE_CAP, ProcessTable, formatElapsed } from "./processTable";
import { ListedProcess, ProcessTail } from "./processWire";

const started = (pid: number) => ({ channel: "process_started" as const, pid, cmd: `cmd ${pid}`, startedAt: pid });
const line = (pid: number, text: string) => ({ channel: "process_line" as const, pid, line: text });

describe("ProcessTable", () => {
  it("adds a started process once", () => {
    const t = ProcessTable.EMPTY.apply(started(1)).apply(started(1));
    expect(t.rows.size).toBe(1);
    expect(t.runningCount).toBe(1);
  });

  it("buffers lines, keeps the last one on the row, and halves the buffer at the cap", () => {
    let t = ProcessTable.EMPTY.apply(started(1));
    for (let i = 0; i < LOG_LINE_CAP; i++) t = t.apply(line(1, `l${i}`));
    expect(t.logsOf(1)).toHaveLength(LOG_LINE_CAP);
    t = t.apply(line(1, "last"));
    expect(t.logsOf(1)).toHaveLength(LOG_LINE_CAP / 2 + 1);
    expect(t.rows.get(1)?.lastLine).toBe("last");
  });

  it("marks an exited process stopped with its code", () => {
    const t = ProcessTable.EMPTY.apply(started(1)).apply({ channel: "process_exited", pid: 1, exitCode: 3 });
    expect(t.rows.get(1)?.statusLabel(0)).toBe("exit 3");
  });

  it("takes the list's state, keeps the pushed last line, and stops known rows it no longer has", () => {
    const t = ProcessTable.EMPTY.apply(started(1)).apply(line(1, "out")).apply(started(2));
    const seeded = t.seeded([new ListedProcess(1, "cmd 1", 5, false, 0)], new Set([1, 2]), 100);
    expect(seeded.rows.get(1)).toMatchObject({ isRunning: false, exitCode: 0, lastLine: "out", startedAt: 95 });
    expect(seeded.rows.get(2)).toMatchObject({ isRunning: false, exitCode: null });
  });

  it("puts a fetched tail before lines pushed while it was in flight", () => {
    const t = ProcessTable.EMPTY.apply(started(1)).apply(line(1, "new"));
    const tailed = t.withTail(1, new ProcessTail(["old"], true, null));
    expect(tailed.logsOf(1)).toEqual(["old", "new"]);
  });

  it("counts running and stopped rows for the title", () => {
    expect(ProcessTable.EMPTY.countLabel).toBe("(no processes)");
    const t = ProcessTable.EMPTY.apply(started(1)).apply(started(2));
    expect(t.countLabel).toBe("(2 running)");
    const one = t.apply({ channel: "process_exited", pid: 1, exitCode: 0 });
    expect(one.countLabel).toBe("(1 running, 1 stopped)");
    expect(one.apply({ channel: "process_exited", pid: 2, exitCode: 0 }).countLabel).toBe("(2 stopped)");
  });

  it("sorts running first, then the most recently started", () => {
    const t = ProcessTable.EMPTY.apply(started(1))
      .apply(started(2))
      .apply(started(3))
      .apply({ channel: "process_exited", pid: 3, exitCode: 0 });
    expect(t.sorted.map((r) => r.pid)).toEqual([2, 1, 3]);
  });
});

describe("formatElapsed", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatElapsed(5)).toBe("5s");
    expect(formatElapsed(65)).toBe("1m05s");
    expect(formatElapsed(3720)).toBe("1h02m");
    expect(formatElapsed(-1)).toBe("—");
  });
});
