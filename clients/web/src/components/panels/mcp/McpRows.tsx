/** The rows inside an opened MCP server: its tools, resources and prompts. */

import { useLayoutEffect, useRef, useState } from "react";
import { McpToolName, type McpPrompt, type McpResource } from "./mcpServer";

/** Small wrench glyph — same outline weight as other panel icons. */
function ToolGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10.5 2a3.5 3.5 0 0 0-3.4 4.3L2.4 11l1 1 1.6-1.6 1 1L4.5 13l1 1L10.2 9.3a3.5 3.5 0 0 0 4.3-4.4l-2 2-1.7-.4-.4-1.7 2-2z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 1.5h5L12.5 5v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M8.5 1.5V5h4" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l2 2M9.8 9.8l2 2M4.2 11.8l2-2M9.8 6.2l2-2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Two-line clamp for tool descriptions with a Show more / less toggle.
 *  Falls back to flat text when the content fits — we only render the
 *  toggle if the content was actually truncated. */
function ClampedText({ children }: { children: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure against the clamped state — if the natural height
    // exceeds the visible height we need the toggle.
    setOverflowing(el.scrollHeight - el.clientHeight > 1);
  }, [children]);

  return (
    <div className="mcp-tool-desc-wrap">
      <div
        ref={ref}
        className={`mcp-tool-desc ${expanded ? "expanded" : "clamped"}`}
      >
        {children}
      </div>
      {(overflowing || expanded) && (
        <button
          type="button"
          className="mcp-tool-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more…"}
        </button>
      )}
    </div>
  );
}

export function ToolRow({
  name,
  description,
  disabled,
  onToggle,
}: {
  name: string;
  description?: string;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { short, prefix } = McpToolName.of(name);
  return (
    <div className={`mcp-tool-row ${disabled ? "is-disabled" : ""}`}>
      <span className="mcp-tool-icon">
        <ToolGlyph />
      </span>
      <div className="mcp-tool-body">
        <div className="mcp-tool-name">
          <code>{short}</code>
          {prefix && <span className="mcp-tool-prefix">{prefix}</span>}
          {disabled && <span className="mcp-tool-tag">off</span>}
        </div>
        {description && <ClampedText>{description}</ClampedText>}
      </div>
      <button
        type="button"
        className={`mcp-tool-switch ${disabled ? "is-off" : "is-on"}`}
        title={disabled ? "Enable for agent" : "Hide from agent"}
        aria-pressed={!disabled}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(disabled);
        }}
      >
        <span className="mcp-tool-switch-track">
          <span className="mcp-tool-switch-thumb" />
        </span>
      </button>
    </div>
  );
}

export function ResourceRow({ resource }: { resource: McpResource }) {
  return (
    <div className="mcp-tool-row">
      <span className="mcp-tool-icon">
        <FileGlyph />
      </span>
      <div className="mcp-tool-body">
        <div className="mcp-tool-name">
          <code>{resource.label}</code>
        </div>
        {resource.description && (
          <ClampedText>{resource.description}</ClampedText>
        )}
        {resource.meta && <div className="mcp-tool-meta">{resource.meta}</div>}
      </div>
    </div>
  );
}

export function PromptRow({ prompt }: { prompt: McpPrompt }) {
  return (
    <div className="mcp-tool-row">
      <span className="mcp-tool-icon">
        <SparkGlyph />
      </span>
      <div className="mcp-tool-body">
        <div className="mcp-tool-name">
          <code>{prompt.name}</code>
          {prompt.args.length > 0 && (
            <span className="mcp-tool-args">({prompt.args.join(", ")})</span>
          )}
        </div>
        {prompt.description && <ClampedText>{prompt.description}</ClampedText>}
      </div>
    </div>
  );
}
