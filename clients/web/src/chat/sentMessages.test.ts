import { describe, expect, it } from "vitest";

import type { UserMessageReceived } from "../protocol/messages";
import { QUEUED_NOTE } from "./mirrorEventRouter";
import { SentMessages } from "./sentMessages";
import { ArrayTranscript } from "./transcriptView.test.util";

const echo = (text: string, queued: boolean): UserMessageReceived => ({
  type: "user_message_received",
  text,
  client_id: "me",
  queued,
});

function setup() {
  const t = new ArrayTranscript();
  const sent = new SentMessages(t.view);
  const send = (text: string) => {
    const bubble = t.chatItems.user(text);
    t.view.append(bubble);
    return { bubble, signal: sent.track(text, bubble.id) };
  };
  return { t, sent, send };
}

describe("SentMessages", () => {
  it("leaves a message the backend runs as it is", () => {
    const s = setup();
    const { signal } = s.send("hello");
    s.sent.echoed(echo("hello", false));
    expect(signal.aborted).toBe(false);
    expect(s.t.items).toMatchObject([{ kind: "user", text: "hello" }]);
    expect(s.t.items[0]).not.toHaveProperty("queued", true);
  });

  it("shows a message the backend queued as queued, and ends its stream", () => {
    const s = setup();
    s.t.items = [s.t.chatItems.assistant("working…")];
    const { bubble, signal } = s.send("and this");
    s.sent.echoed(echo("and this", true));
    expect(signal.aborted).toBe(true);
    expect(s.t.items).toMatchObject([
      { kind: "assistant" },
      { kind: "user", id: bubble.id, text: "and this", queued: true },
      { kind: "info", text: QUEUED_NOTE, queued: true },
    ]);
  });

  it("answers the oldest message with the echo's text", () => {
    const s = setup();
    const first = s.send("yes");
    const second = s.send("yes");
    s.sent.echoed(echo("yes", false));
    s.sent.echoed(echo("yes", true));
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(true);
  });

  it("answers each message once: a later echo of the same text is another message's", () => {
    const s = setup();
    const { signal } = s.send("yes");
    s.sent.echoed(echo("yes", false));
    // A queue_message's echo, typed later with the same text.
    s.sent.echoed(echo("yes", true));
    expect(signal.aborted).toBe(false);
    expect(s.t.items[0]).not.toHaveProperty("queued", true);
  });

  it("ignores an echo it sent nothing for", () => {
    const s = setup();
    const { signal } = s.send("hello");
    s.sent.echoed(echo("other", true));
    expect(signal.aborted).toBe(false);
    expect(s.t.kinds()).toEqual(["user"]);
  });

  it("forgets a message whose stream ended", () => {
    const s = setup();
    const { bubble, signal } = s.send("hello");
    const other = s.send("other");
    s.sent.forget(bubble.id);
    s.sent.echoed(echo("hello", true));
    expect(signal.aborted).toBe(false);
    s.sent.forget(-1);
    s.sent.echoed(echo("other", true));
    expect(other.signal.aborted).toBe(true);
  });
});
