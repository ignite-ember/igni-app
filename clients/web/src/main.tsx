import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ActivityDemo } from "./dev/ActivityDemo";
import { ChatScrollDemo } from "./dev/ChatScrollDemo";
import { CloudSwitchDemo } from "./dev/CloudSwitchDemo";
import { HitlDemo } from "./dev/HitlDemo";
import { InterruptedBannerDemo } from "./dev/InterruptedBannerDemo";
import { OrchestrateDemo } from "./dev/OrchestrateDemo";
import { PanelsDemo } from "./dev/PanelsDemo";
import { PlanModeDemo } from "./dev/PlanModeDemo";
import { FadeDemo } from "./dev/FadeDemo";
import { PluginsCatalogDemo } from "./dev/PluginsCatalogDemo";
import { VisualizerStreamDemo } from "./dev/VisualizerStreamDemo";
import { WorkflowDemo } from "./dev/WorkflowDemo";
import { host } from "./lib/host";
import "./theme.css";
import "./workflow.css";

// Stamp ``data-host`` on <html> so host-conditional CSS (the
// Tauri layout tweaks) has something to key off. Tauri also stamps
// this itself from its INIT_SCRIPT — running twice is harmless,
// the values agree — and a plain browser tab gets ``web``.
document.documentElement.dataset.host = host.kind;

// Demo URLs:
//   ?demo=team           — orchestrate / team-progress UI sandbox
//   ?demo=plan           — plan-mode (row 50) UI sandbox
//   ?demo=hitl           — HITL permission dialog variants
//   ?demo=chat-scroll    — headless Virtuoso scroll sandbox the
//                          chat-scroll e2e tests drive
//   ?demo=workflow       — workflow live-progress card sandbox
//                          (replays a canned event tape through
//                          ChatTranscript.applyWorkflowEvent + <WorkflowRun/>)
//   ?demo=interrupted    — interrupted-assistant banner states
//                          (cancelled / errored / abandoned /
//                          control) with click + keyboard event
//                          logging — see
//                          ``dev/InterruptedBannerDemo.tsx``.
//   ?demo=cloud          — the desktop's cloud switch: the control,
//                          the backend chip and every banner, plus a
//                          live panel the shell's pushes drive — see
//                          ``dev/CloudSwitchDemo.tsx``.
//   ?demo=activity       — the activity group in each of its
//                          states, clocks fixed — see
//                          ``dev/ActivityDemo.tsx``.
//   ?demo=fade           — a playground for the top fade: blur
//                          strength, layers and reach, and where the
//                          opacity starts and ends — see ``dev/FadeDemo.tsx``.
//   ?demo=app            — force-load the real app (otherwise
//                          the dev Tauri shell, which has no
//                          address bar to type a query into,
//                          defaults to the interrupted-banner
//                          demo for the ongoing UI review).
const params = new URLSearchParams(window.location.search);
const demo = params.get("demo");

function pickRoot() {
  if (demo === "team") return <OrchestrateDemo />;
  if (demo === "plan") return <PlanModeDemo />;
  if (demo === "hitl") return <HitlDemo />;
  if (demo === "chat-scroll") return <ChatScrollDemo />;
  if (demo === "viz-stream") return <VisualizerStreamDemo />;
  if (demo === "workflow") return <WorkflowDemo />;
  if (demo === "interrupted") return <InterruptedBannerDemo />;
  if (demo === "cloud") return <CloudSwitchDemo />;
  if (demo === "panels") return <PanelsDemo />;
  if (demo === "plugins") return <PluginsCatalogDemo />;
  if (demo === "activity") return <ActivityDemo />;
  if (demo === "fade") return <FadeDemo />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{pickRoot()}</StrictMode>,
);
