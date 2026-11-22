/**
 * The open approvals (the HITL dialog's requirements), written from the
 * run stream, from other views' broadcasts and from the dialog itself —
 * through these methods, never by setting the list directly.
 *
 * The class keeps the list it last wrote, so a caller can read what is
 * left right after a write (``open``), before React renders it.
 */

import type { Dispatch, SetStateAction } from "react";

import type { HITLRequest, RequirementDetails } from "../protocol/messages";
import { withDetails } from "./hitlDetails";

export type OpenApprovals = HITLRequest[] | null;

export class HitlRequests {
  private current: OpenApprovals = null;

  constructor(private readonly set: Dispatch<SetStateAction<OpenApprovals>>) {}

  /** The approvals open as of the last write. */
  get open(): OpenApprovals {
    return this.current;
  }

  /** A run paused on these. */
  show(requirements: HITLRequest[]): void {
    this.write(requirements);
  }

  /** The safety check's reason for one, arriving after its dialog. */
  addDetails(update: Pick<RequirementDetails, "requirement_id" | "details">): void {
    this.write(withDetails(this.current, update));
  }

  /** Another view answered one: drop it here. */
  resolved(requirementId: string): void {
    if (!this.current) return;
    const left = this.current.filter((r) => r.requirement_id !== requirementId);
    this.write(left.length ? left : null);
  }

  clear(): void {
    this.write(null);
  }

  private write(next: OpenApprovals): void {
    this.current = next;
    this.set(next);
  }
}
