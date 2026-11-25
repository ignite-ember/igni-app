import { useCatShown } from "./catSetting";

/** The account menu's switch for the sidebar's cat. */
export function CatSwitch() {
  const [shown, setShown] = useCatShown();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label="Show the cat in the header"
      className="cat-switch"
      onClick={() => setShown(!shown)}
    >
      <span className="cat-switch-track">
        <span className="cat-switch-thumb" />
      </span>
    </button>
  );
}
