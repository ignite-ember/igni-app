/**
 * The shell's switch state, for the parts of the window deep under the
 * app that need it: an extension page frames its UI on the cloud only
 * once the cloud igni is ready (design §15.5).
 */

import { createContext } from "react";

import type { BackendSnapshot } from "./backendState";

export const BackendStateContext = createContext<BackendSnapshot | null>(null);
