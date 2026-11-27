// @vitest-environment jsdom
/**
 * Find in the conversation lives in the header: the search icon's pill
 * grows into the field, keeps every control and shortcut of the old
 * floating bar, and shrinks back into the icon on close.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useChatSearch } from "../chat/useChatSearch";
import { useWindowField, WindowModel } from "../clientState";
import { ChatSearchMatch, GlobalChatSearchMatch } from "../protocol/backendCallResults";
import { AppHeader, type AppHeaderProps } from "./AppHeader";
import { ChatSearchBar } from "./ChatSearchBar";

afterEach(cleanup);

const HITS = [
  { history_index: 0, role: "user", run_id: "r-1", snippet: "auth one", match_start: 0, match_end: 4, created_at: 0 },
  { history_index: 1, role: "assistant", run_id: "r-1", snippet: "auth two", match_start: 0, match_end: 4, created_at: 0 },
  { history_index: 2, role: "user", run_id: "r-2", snippet: "auth three", match_start: 0, match_end: 4, created_at: 0 },
];

const GLOBAL_HITS = [
  { session_id: "s-a", session_name: "Chat A", role: "user", snippet: "auth a", match_start: 0, match_end: 4, created_at: 0 },
  { session_id: "s-b", session_name: "Chat B", role: "user", snippet: "auth b", match_start: 0, match_end: 4, created_at: 0 },
];

function fakeClient() {
  const searchChat = vi.fn(async () => ChatSearchMatch.parseList(HITS));
  const searchAllChats = vi.fn(async () => GlobalChatSearchMatch.parseList(GLOBAL_HITS));
  const client = {
    connect: () => {},
    asExtension: () => ({}) as never,
    calls: { searchChat, searchAllChats },
  };
  return { client, searchChat, searchAllChats };
}

const ITEMS = [{ id: 1 }, { id: 2 }, { id: 3 }] as never[];

/** The header and the search wired the way ``App`` wires them. */
function Harness(props: {
  client: ReturnType<typeof fakeClient>["client"];
  model: WindowModel;
  onJumpTo?: (i: number) => void;
  onOpenSession?: (id: string) => void;
}) {
  const panel = useWindowField(props.model, "panel");
  const search = useChatSearch(props.model, ITEMS as never, { current: null }, panel);
  const base: AppHeaderProps = {
    conn: "connected",
    groupName: "igni",
    groupMark: null,
    onToggleSidebar: () => {},
    sidebarOpen: true,
    canSearch: true,
    searchOpen: search.searchOpen,
    onToggleSearch: search.toggleSearch,
    searchBar: search.searchOpen ? (
      <ChatSearchBar
        client={props.client as never}
        sessionId="s-1"
        historyIndexToItemIndex={[0, 1, 2]}
        liveItemCount={3}
        onJumpTo={props.onJumpTo ?? (() => {})}
        onOpenSession={props.onOpenSession ?? (() => {})}
        onClose={() => props.model.closePanel()}
      />
    ) : null,
    filesOpen: false,
    onToggleFiles: () => {},
    terminalOpen: false,
    onToggleTerminal: () => {},
    status: null,
    waiting: 0,
    onToggleNotifications: () => {},
    extensions: [],
    notificationCounts: { unread: 0, by_source: {} } as never,
    onOpenPage: () => {},
    client: props.client as never,
  };
  return <AppHeader {...base} />;
}

function mount(opts: { onJumpTo?: (i: number) => void; onOpenSession?: (id: string) => void } = {}) {
  const fake = fakeClient();
  const model = new WindowModel(
    { rpc: vi.fn(async () => ({ rev: 1 })), onEvent: () => () => {} } as never,
    "w-1",
  );
  render(<Harness client={fake.client} model={model} {...opts} />);
  return { ...fake, model };
}

const icon = () => screen.getByRole("button", { name: "Find in conversation" });
const field = () => screen.getByRole("textbox") as HTMLInputElement;
const pill = () => document.querySelector(".header-search") as HTMLElement;

async function typeQuery(q: string) {
  fireEvent.change(field(), { target: { value: q } });
  await waitFor(() => expect(screen.getByText(/^1 \/ \d$/)).toBeTruthy());
}

describe("the header's search pill", () => {
  it("is the icon alone while closed", () => {
    mount();
    expect(icon().getAttribute("aria-expanded")).toBe("false");
    expect(pill().hasAttribute("data-open")).toBe(false);
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("grows the field out of the icon, in the same element, and focuses it", () => {
    mount();
    fireEvent.click(icon());
    expect(pill().hasAttribute("data-open")).toBe(true);
    expect(icon().getAttribute("aria-expanded")).toBe("true");
    const bar = screen.getByRole("search");
    // One element: the field is inside the icon's own pill.
    expect(pill().querySelector(".header-search-pill")!.contains(bar)).toBe(true);
    expect(pill().querySelector(".header-search-pill")!.contains(icon())).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(field().placeholder).toBe("Find in conversation");
    expect(screen.getByText("Type to search this conversation")).toBeTruthy();
  });

  it("keeps the toggle, the arrows and the close", () => {
    mount();
    fireEvent.click(icon());
    expect(screen.getByRole("tab", { name: "This chat" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "All chats" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous match" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next match" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close search" })).toBeTruthy();
  });

  it("shrinks back into the icon on close, with focus back on the icon", () => {
    mount();
    fireEvent.click(icon());
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(pill().hasAttribute("data-open")).toBe(false);
    expect(screen.queryByRole("search")).toBeNull();
    expect(document.activeElement).toBe(icon());
  });

  it("closes from the icon too", () => {
    mount();
    fireEvent.click(icon());
    fireEvent.click(icon());
    expect(screen.queryByRole("search")).toBeNull();
    expect(document.activeElement).toBe(icon());
  });

  it("leaves focus alone when it closes while focus is elsewhere", () => {
    const { model } = mount();
    fireEvent.click(icon());
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    act(() => model.closePanel());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("the search pill's shortcuts", () => {
  it("⌘F opens it and ⌘F again closes it", () => {
    mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    });
    expect(document.activeElement).toBe(field());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(icon());
  });

  it("Esc in the field closes it", () => {
    mount();
    fireEvent.click(icon());
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(document.activeElement).toBe(icon());
  });

  it("Esc closes it from the toggle too", () => {
    mount();
    fireEvent.click(icon());
    fireEvent.keyDown(screen.getByRole("tab", { name: "All chats" }), { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("Enter goes to the next match and Shift+Enter to the previous", async () => {
    const onJumpTo = vi.fn();
    mount({ onJumpTo });
    fireEvent.click(icon());
    await typeQuery("auth");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onJumpTo).toHaveBeenLastCalledWith(1, expect.anything());
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(onJumpTo).toHaveBeenLastCalledWith(0, expect.anything());
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(onJumpTo).toHaveBeenLastCalledWith(2, expect.anything());
    expect(screen.getByText("3 / 3")).toBeTruthy();
  });

  it("the arrows step through the matches", async () => {
    const onJumpTo = vi.fn();
    mount({ onJumpTo });
    fireEvent.click(icon());
    await typeQuery("auth");
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(onJumpTo).toHaveBeenLastCalledWith(1, expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(onJumpTo).toHaveBeenLastCalledWith(0, expect.anything());
  });
});

describe("the search pill's scope", () => {
  it("All chats searches every chat and lists the hits under the pill", async () => {
    const onOpenSession = vi.fn();
    const { searchAllChats, searchChat } = mount({ onOpenSession });
    fireEvent.click(icon());
    // A click focuses the tab in a browser; jsdom's click does not.
    const all = screen.getByRole("tab", { name: "All chats" });
    all.focus();
    fireEvent.click(all);
    // Typing carries on in the field after the switch.
    expect(document.activeElement).toBe(field());
    expect(field().placeholder).toBe("Find in all chats");
    await typeQuery("auth");
    expect(searchAllChats).toHaveBeenCalledWith("auth", 50);
    expect(searchChat).not.toHaveBeenCalled();
    const results = pill().querySelector(".chat-search-results")!;
    expect(results.textContent).toContain("Chat A");
    // The arrows move the highlight in All chats too.
    const prev = screen.getByRole("button", { name: "Previous match" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next match" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onOpenSession).toHaveBeenCalledWith("s-b");
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("This chat searches the open conversation", async () => {
    const { searchChat } = mount();
    fireEvent.click(icon());
    await typeQuery("auth");
    expect(searchChat).toHaveBeenCalledWith("s-1", "auth", 50);
  });
});
