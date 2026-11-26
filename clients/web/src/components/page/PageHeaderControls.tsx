/** A page header's right-hand controls, as bare round icons: a search
 *  that expands from its icon, Filter and Sort menus, refresh, and a
 *  gear — each only when asked for, always in that order. Pass it as the
 *  frame's `headerExtras`, or as {@link PageTabs}' `controls`. */

import { useState, type ReactNode } from "react";

import { FilterIcon, GearIcon, RefreshIcon, SortIcon } from "../Icons";
import { ControlMenu } from "../panels/ControlMenu";
import { PanelSearch } from "../panels/PanelSearch";

export interface HeaderSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The icon's and the input's accessible name: "Search plugins". */
  label: string;
}

export interface HeaderMenu<K extends string = string> {
  options: readonly { key: K; label: string; icon?: ReactNode }[];
  current: K;
  onPick: (key: K) => void;
  /** Lit while it narrows anything. Defaults to "not the first option". */
  active?: boolean;
  /** Defaults to "Filter" / "Sort". */
  label?: string;
  icon?: ReactNode;
}

export interface HeaderButton {
  onClick: () => void;
  label: string;
  /** The tooltip, when it says more than the label. */
  title?: string;
  /** Spins and disables the button while true. */
  busy?: boolean;
}

export function PageHeaderControls<F extends string, S extends string>({
  search,
  filter,
  sort,
  refresh,
  settings,
  children,
}: {
  search?: HeaderSearch;
  filter?: HeaderMenu<F>;
  sort?: HeaderMenu<S>;
  refresh?: HeaderButton;
  /** The gear, last. */
  settings?: HeaderButton;
  /** More icon buttons (`.kb-icon-btn`), after refresh and before the gear. */
  children?: ReactNode;
}) {
  // Only one menu open at a time.
  const [openMenu, setOpenMenu] = useState<"sort" | "filter" | null>(null);

  const menu = <K extends string>(
    which: "filter" | "sort",
    spec: HeaderMenu<K>,
    label: string,
    icon: ReactNode,
  ) => (
    <ControlMenu
      label={spec.label ?? label}
      icon={spec.icon ?? icon}
      active={spec.active ?? spec.current !== spec.options[0]?.key}
      open={openMenu === which}
      onToggle={() => setOpenMenu(openMenu === which ? null : which)}
      onClose={() => setOpenMenu(null)}
      options={spec.options}
      current={spec.current}
      onPick={(key) => spec.onPick(key)}
    />
  );

  return (
    <div className="page-controls">
      {search && (
        <PanelSearch
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
          label={search.label}
        />
      )}
      {filter && menu("filter", filter, "Filter", <FilterIcon />)}
      {sort && menu("sort", sort, "Sort", <SortIcon />)}
      {refresh && (
        <button
          className="kb-icon-btn"
          disabled={refresh.busy}
          onClick={refresh.onClick}
          aria-label={refresh.label}
          title={refresh.title ?? refresh.label}
        >
          {refresh.busy ? <span className="icon-spinner" aria-hidden="true" /> : <RefreshIcon />}
        </button>
      )}
      {children}
      {settings && (
        <button
          className="kb-icon-btn"
          onClick={settings.onClick}
          aria-label={settings.label}
          title={settings.title ?? settings.label}
        >
          <GearIcon />
        </button>
      )}
    </div>
  );
}
