/** The log of the selected process: a line filter and a tail that
 *  follows new output until the reader scrolls up, then offers to
 *  resume. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon } from "../../Icons";

/** How close to the bottom, in px, still counts as following. */
const FOLLOW_SLACK_PX = 40;

export function WatcherTail({
  lines,
  filter,
  onFilter,
}: {
  lines: readonly string[];
  filter: string;
  onFilter: (filter: string) => void;
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);

  const shown = useMemo(() => {
    const f = filter.trim() ? filter.toLowerCase() : "";
    return f ? lines.filter((l) => l.toLowerCase().includes(f)) : lines;
  }, [lines, filter]);

  const scrollToEnd = () => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    if (autoScroll) scrollToEnd();
  }, [shown, autoScroll]);

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (el) setAutoScroll(el.scrollHeight - el.clientHeight - el.scrollTop < FOLLOW_SLACK_PX);
  }, []);

  return (
    <div className="watcher-tail">
      <div className="watcher-tail-toolbar">
        <input
          type="text"
          className="watcher-filter"
          placeholder="Filter lines…"
          aria-label="Filter lines"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
        {!autoScroll && (
          <button
            type="button"
            className="btn btn-sm watcher-resume"
            onClick={() => {
              setAutoScroll(true);
              scrollToEnd();
            }}
            title="Resume auto-scroll"
          >
            <ChevronIcon size={10} down /> Resume
          </button>
        )}
      </div>
      <pre ref={logRef} className="watcher-log" onScroll={onScroll}>
        {shown.length === 0 ? (
          <span className="watcher-log-empty">{filter ? "No lines match the filter." : "No output yet."}</span>
        ) : (
          shown.join("\n")
        )}
      </pre>
    </div>
  );
}
