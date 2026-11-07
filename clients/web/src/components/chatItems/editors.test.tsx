// @vitest-environment jsdom
/**
 * The two inline editors of the transcript: retrying a failed sub-agent
 * with a tweaked task, and editing a sent message around its pasted
 * snippets.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrchestrateItem, UserItem } from "../../chat/chatItem";
import type { OrchestrateAgent } from "../../chat/orchestrateAgentTree";
import { ChatItemView } from "./ChatItemView";

afterEach(() => cleanup());

function failedTeam(task: string): OrchestrateItem {
  const agent: OrchestrateAgent = {
    path: "root/researcher",
    name: "researcher",
    parent: null,
    status: "error",
    runId: "",
    task,
    previewLines: [],
    tools: [],
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  return {
    kind: "orchestrate",
    id: 1,
    cardId: "c1",
    agents: { [agent.path]: agent },
    order: [agent.path],
    streaming: false,
  };
}

const textarea = () => document.querySelector("textarea") as HTMLTextAreaElement;

describe("Retry editor", () => {
  it("starts from the agent's task, follows a task that arrives late, and sends the edit", () => {
    const retryAgent = vi.fn();
    const handlers = { team: { retryAgent } };
    const { rerender } = render(<ChatItemView item={failedTeam("")} handlers={handlers} />);
    fireEvent.click(screen.getByTitle(/Retry researcher/));
    expect(textarea().value).toBe("");

    rerender(<ChatItemView item={failedTeam("find the bug")} handlers={handlers} />);
    expect(textarea().value).toBe("find the bug");

    fireEvent.change(textarea(), { target: { value: "  find the other bug  " } });
    fireEvent.keyDown(textarea(), { key: "Enter", metaKey: true });
    expect(retryAgent).toHaveBeenCalledWith("researcher", "find the other bug");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("can be emptied, and Escape brings the task back", () => {
    // The draft used to re-seed itself from the task during render,
    // so the field could never be cleared.
    const handlers = { team: { retryAgent: vi.fn() } };
    render(<ChatItemView item={failedTeam("find the bug")} handlers={handlers} />);
    fireEvent.click(screen.getByTitle(/Retry researcher/));
    fireEvent.change(textarea(), { target: { value: "" } });
    expect(textarea().value).toBe("");
    const send = document.querySelector(".orch-retry-bar .btn-primary") as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(document.querySelector("textarea")).toBeNull();
    fireEvent.click(screen.getByTitle(/Retry researcher/));
    expect(textarea().value).toBe("find the bug");
  });
});

describe("Message editor", () => {
  const text =
    "look at\n[code-paste src/foo.py:9 lines=9-10]\ndef a():\n    pass\n[/code-paste]\nplease";
  const item: UserItem = { kind: "user", id: 3, text, runId: "run-1" };

  it("shows snippets as placeholders and puts them back on save", () => {
    const edit = vi.fn();
    render(<ChatItemView item={item} handlers={{ user: { edit } }} />);
    fireEvent.click(screen.getByLabelText("Edit message"));
    expect(textarea().value).toBe("look at\n«code:foo.py 9-10#1»\nplease");

    fireEvent.change(textarea(), { target: { value: "look hard at\n«code:foo.py 9-10#1»\nplease" } });
    fireEvent.click(screen.getByText("Save & resend"));
    expect(edit).toHaveBeenCalledWith(item, text.replace("look at", "look hard at"));
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("does not resend an unchanged message", () => {
    const edit = vi.fn();
    render(<ChatItemView item={item} handlers={{ user: { edit } }} />);
    fireEvent.click(screen.getByLabelText("Edit message"));
    fireEvent.keyDown(textarea(), { key: "Enter", ctrlKey: true });
    expect(edit).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("renders the snippet as a pill when not editing", () => {
    render(<ChatItemView item={item} />);
    expect(screen.getByText("foo.py 9-10")).toBeTruthy();
    expect(document.querySelector(".msg-user.mode-chat")).toBeTruthy();
  });
});
