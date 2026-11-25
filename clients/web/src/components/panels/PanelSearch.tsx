/** An expanding search control for a panel header, the same one the
 *  Plugins catalog uses: an icon that opens an inline input and collapses
 *  back when empty and blurred. Shared so MCPs and Extensions read like
 *  Plugins. */

import { useEffect, useRef, useState } from "react";

import { SearchIcon, XIcon } from "../Icons";

export function PanelSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = expanded || value.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  if (!open) {
    return (
      <button className="kb-icon-btn" aria-label={label} title={label} onClick={() => setExpanded(true)}>
        <SearchIcon />
      </button>
    );
  }
  return (
    <div className="plugins-searchbox">
      <SearchIcon size={13} />
      <input
        ref={inputRef}
        className="plugins-searchbox-input"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            setExpanded(false);
          }
        }}
      />
      <button
        className="plugins-searchbox-clear"
        aria-label="Close search"
        onClick={() => {
          onChange("");
          setExpanded(false);
        }}
      >
        <XIcon size={10} />
      </button>
    </div>
  );
}
