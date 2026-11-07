/** Catalog form fields. Each emits ``change:`` / ``toggle:`` /
 *  ``select:`` with the entered value, which the spec binds to an
 *  action; the field itself is uncontrolled. */

import { useState } from "react";
import type { CatalogComponents } from "./catalogComponents";

export const inputComponents: Pick<
  CatalogComponents,
  | "Input"
  | "Textarea"
  | "Select"
  | "Checkbox"
  | "Radio"
  | "Toggle"
  | "ToggleGroup"
  | "Slider"
  | "DatePicker"
> = {
  Input: ({ props, emit }) => {
    const { value, placeholder, type = "text", label } = props;
    return (
      <label className="jr-field">
        {label && <span className="jr-field-label">{label}</span>}
        <input
          className="jr-input"
          type={type}
          defaultValue={value ?? ""}
          placeholder={placeholder ?? ""}
          onBlur={(e) => emit(`change:${e.currentTarget.value}`)}
        />
      </label>
    );
  },

  Textarea: ({ props, emit }) => {
    const { value, placeholder, rows = 3, label } = props;
    return (
      <label className="jr-field">
        {label && <span className="jr-field-label">{label}</span>}
        <textarea
          className="jr-textarea"
          defaultValue={value ?? ""}
          placeholder={placeholder ?? ""}
          rows={rows}
          onBlur={(e) => emit(`change:${e.currentTarget.value}`)}
        />
      </label>
    );
  },

  Select: ({ props, emit }) => {
    const { value, label, options } = props;
    return (
      <label className="jr-field">
        {label && <span className="jr-field-label">{label}</span>}
        <select
          className="jr-select"
          defaultValue={value ?? ""}
          onChange={(e) => emit(`change:${e.currentTarget.value}`)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  },

  Checkbox: ({ props, emit }) => (
    <label className="jr-checkbox">
      <input
        type="checkbox"
        defaultChecked={props.checked ?? false}
        onChange={(e) => emit(`toggle:${e.currentTarget.checked}`)}
      />
      <span>{props.label ?? ""}</span>
    </label>
  ),

  Radio: ({ props, emit }) => (
    <div className="jr-radio-group" role="radiogroup">
      {props.options.map((o) => (
        <label key={o.value} className="jr-radio">
          <input
            type="radio"
            name={props.name ?? "radio"}
            value={o.value}
            defaultChecked={props.value === o.value}
            onChange={() => emit(`select:${o.value}`)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  ),

  Toggle: ({ props, emit }) => {
    const [checked, setChecked] = useState(props.checked ?? false);
    return (
      <button
        type="button"
        className={`jr-toggle ${checked ? "jr-toggle-on" : ""}`}
        role="switch"
        aria-checked={checked}
        onClick={() => {
          const next = !checked;
          setChecked(next);
          emit(`toggle:${next}`);
        }}
      >
        <span className="jr-toggle-thumb" />
        {props.label && <span className="jr-toggle-label">{props.label}</span>}
      </button>
    );
  },

  ToggleGroup: ({ props, emit }) => {
    const [val, setVal] = useState(props.value ?? "");
    return (
      <div className="jr-togglegroup" role="tablist">
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={val === o.value}
            className={`jr-togglegroup-item ${val === o.value ? "jr-on" : ""}`}
            onClick={() => {
              setVal(o.value);
              emit(`select:${o.value}`);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  },

  Slider: ({ props, emit }) => {
    const { value, min = 0, max = 100, step = 1, label } = props;
    return (
      <label className="jr-field">
        {label && (
          <span className="jr-field-label">
            {label} ({value ?? min})
          </span>
        )}
        <input
          className="jr-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          defaultValue={value ?? min}
          onChange={(e) => emit(`change:${e.currentTarget.value}`)}
        />
      </label>
    );
  },

  DatePicker: ({ props, emit }) => (
    <label className="jr-field">
      {props.label && <span className="jr-field-label">{props.label}</span>}
      <input
        className="jr-input"
        type="date"
        defaultValue={props.value ?? ""}
        onChange={(e) => emit(`change:${e.currentTarget.value}`)}
      />
    </label>
  ),
};
