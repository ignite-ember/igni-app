import type { PageRoute } from "../chat/pageStack";
import { useConnectionGeneration } from "../cloud/useConnectionGeneration";
import { Drawer } from "../components/panels/Drawer";
import type { IgniClient } from "../protocol/client";
import { HostModelReply, ServiceTokenReply } from "../protocol/rpcResults";
import { ExtensionPage, type ExtensionPageProps, type ExtensionSummary } from "./ExtensionPage";
import { OpenOnWeb } from "./OpenOnWeb";

/** A dialog an extension opens waits on the person, for as long as they take. */
export const DIALOG_WAIT_MS = 24 * 3_600_000;

/**
 * An extension's page, in the page chrome every other page gets from
 * its ``Drawer``: over the conversation, with the trail back to the
 * chat. The extension draws its own heading.
 *
 * Every call it makes goes as that extension (``client.asExtension``),
 * which is what lets the backend enforce its manifest's permissions
 * rather than trusting this process to have done so.
 *
 * The frame is keyed by the client's connection generation: a new
 * connection (a backend restart, or the cloud's resync after a node
 * move) remounts it with a new nonce, so it says `hello` again and
 * re-subscribes in the igni process that now answers (design §15.5).
 */
export function ExtensionPageHost({
  extension,
  page,
  client,
  homeWindow,
  theme,
  signals,
  onClose,
  onNavigate,
  onLocation,
}: {
  extension: ExtensionSummary;
  page: PageRoute;
  client: Pick<IgniClient, "asExtension"> & Partial<Pick<IgniClient, "onStateChange" | "generation">>;
  /** The window it is framed in, for ``host_model``. */
  homeWindow: string;
  theme: string;
  signals: ExtensionPageProps["signals"];
  onClose: () => void;
  /** The page's `bridge.navigate(to)`; the app decides whether to go. */
  onNavigate?: (to: string) => void;
  /** The page's `bridge.setLocation(state)`, for the app to fold into
   *  the window's route so the next `hello` replays it. */
  onLocation?: (state: Record<string, string>) => void;
}) {
  const generation = useConnectionGeneration(client);
  const caller = client.asExtension(extension.id);
  const onHost: NonNullable<ExtensionPageProps["onHost"]> = async (request) =>
    HostModelReply.parse(
      await caller.rpc<unknown>(
        "host_model",
        { ...request, home_window: homeWindow },
        request.path === "ui.show_dialog" ? DIALOG_WAIT_MS : undefined,
      ),
    );
  const onServiceToken = async ({ refresh }: { refresh: boolean }) =>
    ServiceTokenReply.parse(
      await caller.rpc<unknown>("extension_service_token", refresh ? { refresh: true } : {}),
    );
  return (
    // The frame scrolls itself, so the page cannot watch its offset:
    // ``selfScrolling`` keeps the fade on and tells the frame the inset
    // to leave. "Open on the web" is a header-row action like any
    // page's, so it sits in the fixed row the frame scrolls under.
    <Drawer
      title={page.label}
      titleInBody
      selfScrolling
      headerExtras={
        extension.web_url ? <OpenOnWeb url={extension.web_url} name={extension.name} /> : undefined
      }
      onClose={onClose}
    >
      <ExtensionPage
        key={generation}
        extension={extension}
        kind={page.kind}
        // Launch params: a notification's target.params, when that opened it.
        params={page.params}
        theme={theme}
        signals={signals}
        onHost={onHost}
        onServiceToken={onServiceToken}
        onClose={onClose}
        onNavigate={onNavigate}
        onLocation={onLocation}
        onCall={(method, args) => caller.rpc(method, args)}
        showWebLink={false}
      />
    </Drawer>
  );
}
