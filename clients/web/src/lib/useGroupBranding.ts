/**
 * The signed-in group's branding: its palette on the document, its name
 * and mark for the header.
 *
 * Keyed on the serialised theme rather than the object: status arrives
 * every five seconds with a fresh object. ``applyTheme`` clears what it
 * owns before setting, so losing a theme restores igni's palette.
 */

import { useEffect, useMemo } from "react";

import type { GroupTheme } from "../protocol/messages";
import { applyTheme, brandMark, brandName } from "./theme";

export interface GroupBranding {
  groupName: string;
  groupMark: string | null;
}

export function useGroupBranding(theme: GroupTheme | null | undefined): GroupBranding {
  const themeKey = JSON.stringify(theme ?? null);
  const stableTheme = useMemo(() => JSON.parse(themeKey) as GroupTheme | null, [themeKey]);
  useEffect(() => {
    applyTheme(stableTheme, document.documentElement);
  }, [stableTheme]);
  return useMemo(
    () => ({ groupName: brandName(stableTheme), groupMark: brandMark(stableTheme) }),
    [stableTheme],
  );
}
