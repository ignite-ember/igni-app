/** One hook's own page: the event it runs on, what it matches, how it
 *  runs, and the script itself — read from the project when it is a file. */

import type { IgniClient } from "../../../protocol/client";
import { host } from "../../../lib/host";
import { Button } from "../../page/Button";
import { DetailFacts } from "../../page/DetailFacts";
import { DetailSection } from "../../page/DetailSection";
import { EntityHero } from "../../page/EntityHero";
import { HeroChip } from "../../page/HeroChip";
import { useFileContents } from "../../pages/files/useFileContents";
import { CopyTextButton, MonoBlock } from "../MonoBlock";
import { EventIcon } from "./HookIcons";
import { EVENT_BLURB, formatTimeout, identOf, isWebhook, scriptPath, sourceOf, type HookEntry } from "./hooksView";

export function HookDetail({ hook, client }: { hook: HookEntry; client: IgniClient }) {
  const webhook = isWebhook(hook);
  const script = scriptPath(hook);
  const file = useFileContents(client, script ?? "");
  const ident = identOf(hook);
  const type = hook.type || (webhook ? "webhook" : "command");
  const headers = hook.header_names ?? [];
  // A script's path is on the VM on the desktop's cloud side: nothing here opens it.
  const canOpen = !!script && !host.onCloud;

  return (
    <div className="entity-detail hook-detail">
      <EntityHero
        name={hook.event}
        icon={
          <span className="entity-glyph" style={{ width: 52, height: 52 }}>
            <EventIcon size={22} />
          </span>
        }
        meta={<span className="entity-meta">{hook.matcher ? `matches ${hook.matcher}` : "every target"}</span>}
        description={EVENT_BLURB[hook.event]}
        chips={
          <>
            <HeroChip title="Where it comes from">{sourceOf(hook)}</HeroChip>
            <HeroChip title="Type">{type}</HeroChip>
            {hook.background && <HeroChip>background</HeroChip>}
          </>
        }
        actions={
          canOpen && (
            <Button onClick={() => void host.openFile(script)}>
              {host.canOpenNatively ? "Open in editor" : "Preview file"}
            </Button>
          )
        }
      />
      <DetailSection title="Hook">
        <DetailFacts
          facts={[
            { label: "Event", value: hook.event },
            { label: "Matcher", value: hook.matcher || "every target", mono: !!hook.matcher },
            { label: "Type", value: type },
            { label: "Timeout", value: formatTimeout(hook.timeout_ms) },
            { label: "Runs", value: hook.background ? "in the background" : "while the agent waits" },
            { label: "Source", value: sourceOf(hook) },
            !!script && { label: "Script", value: script, mono: true },
            !script && !webhook && { label: "Command", value: ident, mono: true },
            webhook && { label: "URL", value: ident, mono: true },
            headers.length > 0 && { label: "Headers", value: headers.join(", "), mono: true },
          ]}
        />
      </DetailSection>
      {script ? (
        <DetailSection
          title="Script"
          actions={file.file.contents ? <CopyTextButton text={file.file.contents} label="Copy the script" /> : undefined}
        >
          {file.loading && <p className="detail-note">Reading {script}…</p>}
          {!file.loading && file.file.contents !== "" && <MonoBlock text={file.file.contents} label={script} />}
          {!file.loading && !file.file.contents && (
            <>
              <p className="detail-note">
                {file.error ? `Could not read the file (${file.error.replace(/\.$/, "")}); the command it runs:` : "The command it runs:"}
              </p>
              <MonoBlock text={hook.command} label="Command" />
            </>
          )}
        </DetailSection>
      ) : (
        <DetailSection
          title={webhook ? "URL" : "Command"}
          actions={<CopyTextButton text={ident} label={webhook ? "Copy the URL" : "Copy the command"} />}
        >
          <MonoBlock text={ident} label={webhook ? "URL" : "Command"} />
        </DetailSection>
      )}
    </div>
  );
}
