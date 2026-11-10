/**
 * The open approvals (the HITL dialog's requirements), written from the
 * run stream, from other views' broadcasts and from the dialog itself —
 * through these methods, never by setting the list directly.
 */

import type { Dispatch, SetStateAction } from "react";

import type { HITLRequest, RequirementDetails } from "../protocol/messages";
import { withDetails } from "./hitlDetails";

export type OpenApprovals = HITLRequest[] | null;

export class HitlRequests {
  constructor(private readonly set: Dispatch<SetStateAction<OpenApprovals>>) {}

  /** A run paused on these. */
  show(requirements: HITLRequest[]): void {
    this.set(requirements);
  }

  /** The safety check's reason for one, arriving after its dialog. */
  addDetails(update: Pick<RequirementDetails, "requirement_id" | "details">): void {
    this.set((prev) => withDetails(prev, update));
  }

  /** Another view answered one: drop it here. */
  resolved(requirementId: string): void {
    this.set((prev) => {
      if (!prev) return prev;
      const left = prev.filter((r) => r.requirement_id !== requirementId);
      return left.length ? left : null;
    });
  }

  clear(): void {
    this.set(null);
  }
}
