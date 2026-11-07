import type { PageRoute } from "../chat/pageStack";
import { Drawer } from "../components/panels/Drawer";
import type { IgniClient } from "../protocol/client";
import { HostModelReply, ServiceTokenReply } from "../protocol/rpcResults";
import { ExtensionPage, type ExtensionPageProps, type ExtensionSummary } from "./ExtensionPage";

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
 */
export function ExtensionPageHost({
  extension,
  page,
  client,
  homeWindow,
  theme,
  signals,
  onClose,
}: {
  extension: ExtensionSummary;
  page: PageRoute;
  client: Pick<IgniClient, "asExtension">;
  /** The window it is framed in, for ``host_model``. */
  homeWindow: string;
  theme: string;
  signals: ExtensionPageProps["signals"];
  onClose: () => void;
}) {
  const caller = client.asExtension(extension.id);
  const onHost: NonNullable<ExtensionPageProps["onHost"]> = async (request) =>
    HostModelReply.parse(
      await caller.rpc<unknown>(
        "host_model",
        { ...request, home_window: homeWindow },
        request.path === "ui.show_dialog" ? DIALOG_WAIT_MS : undefined,
      ),
    );
  const onServiceToken = async () =>
    ServiceTokenReply.parse(await caller.rpc<unknown>("extension_service_token", {}));
  return (
    <Drawer title={page.label} titleInBody onClose={onClose}>
      <ExtensionPage
        extension={extension}
        kind={page.kind}
        // Launch params: a notification's target.params, when that opened it.
        params={page.params}
        theme={theme}
        signals={signals}
        onHost={onHost}
        onServiceToken={onServiceToken}
        onClose={onClose}
        onCall={(method, args) => caller.rpc(method, args)}
      />
    </Drawer>
  );
}
