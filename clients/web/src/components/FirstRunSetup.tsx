/**
 * What a fresh install sees before it has a model.
 *
 * Every capability the welcome screen advertises — agents, skills,
 * workflows, loops — comes back `No model configured. Run /login…`
 * until this is done. The screen used to offer all eight of them and
 * not this, so the only useful action on a first run was the one action
 * missing.
 *
 * There is deliberately **one** button. A "use my own model" button was
 * here and opened the composer's model menu, which reads its entries
 * from `models.registry` — empty on exactly the installs that see this
 * block, so it opened an empty dropdown every time. Bringing your own
 * model means editing a file, so the note says which file.
 *
 * Its own component so it can be tested without standing up ``App``,
 * which has no tests.
 */

import { Button } from "./page/Button";

export function FirstRunSetup({
  onLogin,
  signedInAs = "",
}: {
  onLogin: () => void;
  /** The account already signed in, if any. Someone signed in is not
   *  offered "Sign in" again: it only started a second sign-in, which
   *  changed nothing (R639). */
  signedInAs?: string;
}) {
  return (
    <div className="welcome-setup">
      <p className="welcome-setup-lead">One step first: igni needs a model to run.</p>
      {signedInAs ? (
        <p className="welcome-setup-note">
          You are signed in as <strong>{signedInAs}</strong>, and this session has no model from
          your organisation&apos;s igni server yet. Ask whoever runs it which models it routes to
          you.
        </p>
      ) : (
        <div className="welcome-setup-actions">
          <Button variant="primary" onClick={onLogin}>
            Sign in to your igni server
          </Button>
        </div>
      )}
      {/* `~/.igni`: the directory the backend reads (`core/paths.py`,
          CONFIG_DIR). This said `~/.ember`, which `dir_migration` moves
          away on first start, so it sent people to a file nothing reads.
          And "igni Cloud" is gone: Ignite Ember hosts nothing, and the
          models come from the organisation's own igni server. */}
      <p className="welcome-setup-note">
        {signedInAs ? "" : "Signing in finds the models your organisation's igni server routes to. "}
        To bring your own, add an entry to <code>models.registry</code> in{" "}
        <code>~/.igni/config.yaml</code>.
      </p>
    </div>
  );
}
