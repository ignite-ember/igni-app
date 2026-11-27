/**
 * The activity group in each of its states, from fixed data.
 *
 * Reachable at ``?demo=activity`` (see ``main.tsx``); the visual
 * baselines picture it (``e2e/app-screens.ts``). Every clock is fixed,
 * so a picture taken today is comparable tomorrow, and the running
 * command's output tail, which no fixture event can produce, is drawn.
 */

import { ActivityDisclosure } from "../chat/activityDisclosure";
import type { ActivityGroup } from "../chat/activityGroups";
import type { ChatItem, ToolItem, ToolStatus } from "../chat/chatItem";
import { ActivityGroupView } from "../components/chatItems/ActivityGroupView";

/** A disclosure whose step times are fixed, keyed by group then step. */
class FixedClocks extends ActivityDisclosure {
  constructor(private readonly times: Record<string, readonly (number | null)[]>) {
    super(null);
  }

  override stepClocks(): void {}

  override stepTime(key: string, index: number): { start: number; end: number | null } | null {
    const ms = this.times[key]?.[index];
    return ms == null ? null : { start: 0, end: ms };
  }
}

let nextId = 1;
const tool = (name: string, args: string, status: ToolStatus = "done", result = ""): ToolItem => ({
  kind: "tool",
  id: nextId++,
  runId: "demo",
  name,
  args,
  status,
  result,
  isError: status === "error",
  diffRows: null,
});
const thought = (text: string): ChatItem => ({ kind: "thinking", id: nextId++, text });
const group = (key: string, items: ChatItem[]): ActivityGroup => ({ key, items, start: 0, tail: true });

const PLAN = thought("The theme tokens live in theme.css; check how the buttons use them before touching anything.");
const BASE: ChatItem[] = [
  PLAN,
  tool("Grep", "--btn- src/", "done", "14 matches in 3 files"),
  tool("Read", "src/theme.css"),
  tool("Read", "src/components/Button.tsx"),
  thought("Two buttons hard-code colours. Replace them with the tokens, then run the tests."),
  tool("Edit", "src/components/Button.tsx"),
  tool("Edit", "src/theme.css"),
  tool("Bash", "npm run lint", "error", "Command exited with code 1:\nsrc/components/Button.tsx\n  3:10  error  'colors' is defined but never used"),
];
const BASE_TIMES = [1100, 400, 200, 300, 2100, 300, 300, 1600];

const THINKING = group("demo:thinking", [
  ...BASE,
  thought(
    "The lint error is an unused import in Button.tsx, left over from the colour constants I removed.\n" +
      "Removing it is safe: nothing else in the file reads it, and the tests do not import it either.\n" +
      "Before I touch it, check whether the secondary variant still reads the old --btn-bg token,\n" +
      "because if it does the hover state falls back to the default grey in dark mode",
  ),
]);

const COMMAND = group("demo:command", [
  ...BASE,
  tool("Edit", "src/components/Button.tsx"),
  tool("Bash", "npm test", "running", " ✓ src/theme.test.ts (14 tests) 38ms\n ✓ src/components/Button.test.tsx (9 tests) 112ms\n"),
]);

const FINISHED_ITEMS: ChatItem[] = [
  ...BASE,
  tool("Bash", "npx tsc -b --noEmit"),
  tool("Bash", "npm test", "done", "2246 passed"),
  thought("Lint still flags the unused import; leave it for the person to decide, and say so."),
];
const FINISHED = group("demo:finished", FINISHED_ITEMS);
const EXPANDED = group("demo:expanded", FINISHED_ITEMS.map((it) => ({ ...it, id: nextId++ })));

const LONG_ITEMS: ChatItem[] = [
  thought("Decode both attachments, then compare what each one holds."),
  ...Array.from({ length: 10 }, (_, i) => tool("Bash", `base64 -d part-${i + 1}.b64 > part-${i + 1}.bin`)),
  tool("Read", "part-1.bin"),
  tool("Grep", "PK\\x03\\x04 part-*.bin"),
  tool("mcp_files_inspect", "part-2.bin"),
  tool("Bash", "unzip -l part-2.bin", "error", "Command exited with code 9:\nEnd-of-central-directory signature not found."),
  thought("Not a zip after all: the header is gzip. Try that instead."),
  tool("Bash", "gunzip -c part-2.bin | head"),
  tool("WebFetch", "https://www.rfc-editor.org/rfc/rfc1952"),
  tool("Bash", "file part-1.bin part-2.bin"),
  tool("Read", "part-2.txt"),
  tool("Bash", "wc -l part-2.txt"),
  thought("Both decoded. One is the config export, the other the access log; summarise each."),
];
const LONG = group("demo:long", LONG_ITEMS);

const store = new FixedClocks({
  "demo:thinking": [...BASE_TIMES, 2400],
  "demo:command": [...BASE_TIMES, 300, 2100],
  "demo:finished": [...BASE_TIMES, 1200, 3100, 700],
  "demo:expanded": [...BASE_TIMES, 1200, 3100, 700],
  "demo:long": LONG_ITEMS.map((_, i) => 150 + ((i * 37) % 400)),
});
store.set("demo:expanded", true);

const SECTIONS: { title: string; group: ActivityGroup; running: boolean; ms: number }[] = [
  { title: "Running: the latest thought under the markers", group: THINKING, running: true, ms: 9_000 },
  { title: "Running: a command and its last output lines", group: COMMAND, running: true, ms: 11_000 },
  { title: "Finished, with one failure", group: FINISHED, running: false, ms: 13_000 },
  { title: "Opened: the timeline", group: EXPANDED, running: false, ms: 13_000 },
  { title: "Twenty-two steps", group: LONG, running: false, ms: 3_000 },
];

export function ActivityDemo() {
  return (
    <main className="activity-demo" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)", padding: "24px 16px" }}>
      <div style={{ maxWidth: "var(--col)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 style={{ fontSize: "var(--text-xl)", margin: 0 }}>Activity groups</h1>
        {SECTIONS.map(({ title, group: g, running, ms }) => (
          <section key={g.key} aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)", fontWeight: 500, margin: 0 }}>{title}</h2>
            <ActivityGroupView group={g} running={running} startedAt={0} endedAt={ms} store={store} />
          </section>
        ))}
      </div>
    </main>
  );
}
