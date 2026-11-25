/**
 * The sidebar's cat: an Open Bot Avatar (MIT, github.com/DominikScholz/
 * open-bot-avatar) that shows what igni is doing.
 */

import { useEffect, useRef } from "react";
import type { AvatarDefinition } from "open-bot-avatar";
import { mountAvatar, type MountedAvatar } from "open-bot-avatar/dom";

import type { AvatarLook } from "../chat/botAvatarLook";

/** The gallery's cat, as published in open-bot-avatar's ``gallery/cat.json``. */
const CAT: AvatarDefinition = {
  version: 1,
  id: "cat",
  name: "Cat",
  body: {
    path: "M50 23C68 23 82 30 82 45C82 58 68 65 50 65C32 65 18 58 18 45C18 30 32 23 50 23ZM24 42C21 32 20 22 22 15C23 11 26 10 29 12C34 16 39 21 44 28L36 42ZM64 42L56 28C61 21 66 16 71 12C74 10 77 11 78 15C80 22 79 32 76 42ZM38 56L62 56C70 56 74 66 74 76C74 83 70 86 63 86L37 86C30 86 26 83 26 76C26 66 30 56 38 56ZM70 72C77 74 81 70 80 64C79 60 81 57 84 58C87 59 88.5 63 88 68C87 77 80 83 70 81Z",
  },
  eyes: { x: 50, y: 43, spacing: 17, scale: 1.1 },
};

/** The cat's gallery colour. */
const CAT_COLOR = "#f8a01c";

/** What a screen reader hears for each state. */
const LABELS: Record<AvatarLook["state"], string> = {
  idle: "igni is idle",
  thinking: "igni is thinking",
  working: "igni is working",
  waiting: "igni is waiting for you",
  blocked: "igni hit an error",
  done: "igni finished",
};

export function BotAvatar({ look, size = 30 }: { look: AvatarLook; size?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);

  useEffect(() => {
    if (!host.current) return;
    try {
      avatar.current = mountAvatar(host.current, {
        definition: CAT,
        color: CAT_COLOR,
        material: "fluffy",
        followPointer: true,
        ...look,
        label: LABELS[look.state],
      });
    } catch {
      // No canvas here (a test DOM): the sidebar works without the cat.
    }
    return () => {
      avatar.current?.destroy();
      avatar.current = null;
    };
    // Mounted once; later looks go through ``update``.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    avatar.current?.update({ ...look, label: LABELS[look.state] });
  }, [look.state, look.mood]);

  return (
    <div
      ref={host}
      className="sidebar-bot-avatar"
      data-state={look.state}
      style={{ width: size, height: size }}
    />
  );
}
