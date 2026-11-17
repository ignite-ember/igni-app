import type { Ref } from "react";
import { Monogram } from "@ignite-ember/ui-react";

import type { StatusUpdate } from "../protocol/messages";
import { ChevronIcon } from "./Icons";

/** The header's account chip, or "Log in" when nobody is signed in.
 *
 *  Who is signed in is `cloud_email`, the address on disk, which is
 *  what the sign-in wall goes by too. `cloud_connected` says whether the
 *  igni server answered the last request: an air-gapped, on-prem
 *  install can be signed in and still have no server to talk to, so it
 *  never decides between the chip and "Log in". It is said on the
 *  chip's title instead — and said plainly, because "not connected"
 *  reads like "you are not signed in", which is a different thing.
 *  Nothing is shown until the first status arrives, rather than "Log
 *  in" flashing at somebody signed in. */
export function AccountChip({
  status,
  name,
  onOpenAccount,
  onLogIn,
  buttonRef,
}: {
  status: Pick<StatusUpdate, "cloud_email" | "cloud_connected"> | null;
  name: string;
  onOpenAccount: () => void;
  onLogIn: () => void;
  /** The account button, for the menu to hand focus back to. */
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  if (status === null) return null;
  if (status.cloud_email) {
    // Signed in, and the igni server answered the last request.
    const serverAnswers = status.cloud_connected;
    return (
      <button
        ref={buttonRef}
        className="chip"
        title={
          serverAnswers
            ? "Account"
            : "Account: signed in, but the igni server is not answering"
        }
        onClick={onOpenAccount}
      >
        {/* A monogram, not an avatar: nothing in the product stores an
            uploaded picture, and inventing a silhouette for everybody
            says less than two letters of their own name. The portal
            draws the same thing from the same source. */}
        <Monogram name={name} /> <span className="chip-label">{name}</span>{" "}
        {/* The person is signed in; the server is the one that is away.
            The marker is there so the chip says so without a hover, and
            the title says it in words for the hover and the screen
            reader. */}
        {!serverAnswers && (
          <span
            className="dot not-answering"
            role="img"
            aria-label="The igni server is not answering"
          />
        )}
        <ChevronIcon size={9} down />
      </button>
    );
  }
  return (
    <button
      className="chip"
      style={{ background: "var(--igni-gradient)", color: "#fff", border: "none" }}
      onClick={onLogIn}
    >
      Log in
    </button>
  );
}
