import { useEffect, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { PageEmpty } from "../page/PageEmpty";
import { PageLoading } from "../page/PageLoading";

interface SkillRow {
  name?: string;
  description?: string;
}

/** Skill workflows — runnable straight from the panel. */
export function SkillsPanel({
  client,
  onRun,
  onClose,
}: {
  client: IgniClient;
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);

  useEffect(() => {
    client
      .rpc<SkillRow[]>("get_skill_details")
      .then((s) => setSkills(s || []))
      .catch(() => setSkills([]));
  }, [client]);

  return (
    <Drawer title="Skills" onClose={onClose}>
      {skills === null && <PageLoading />}
      {skills?.length === 0 && (
        <PageEmpty
          title="No skills installed"
          hint={
            <>
              Add some through Plugins, or put them in <code>.igni/skills/</code>.
            </>
          }
        />
      )}
      {skills?.map((s) => (
        <div className="row" key={s.name}>
          <div>
            <div className="name">/{s.name}</div>
            <div className="meta">{s.description}</div>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => {
              onClose();
              onRun(`/${s.name}`);
            }}
          >
            Run
          </button>
        </div>
      ))}
    </Drawer>
  );
}
