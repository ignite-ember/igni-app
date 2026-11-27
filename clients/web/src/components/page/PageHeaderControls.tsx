/** A page header's right-hand controls, as bare round icons: a search
 *  that expands from its icon, Filter and Sort menus, refresh, and a
 *  gear — each only when asked for, always in that order — then the
 *  page's one primary "+ Add" button. Pass it as the frame's
 *  `headerExtras`, or as {@link PageTabs}' `controls`. */

import { useState, type ReactNode } from "react";

import { FilterIcon, GearIcon, NamedIcon, RefreshIcon, SortIcon } from "../Icons";
import { ControlMenu } from "../panels/ControlMenu";
import { PanelSearch } from "../panels/PanelSearch";
import { Button } from "./Button";

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
  add,
  children,
}: {
  search?: HeaderSearch;
  filter?: HeaderMenu<F>;
  sort?: HeaderMenu<S>;
  refresh?: HeaderButton;
  /** The gear, last. */
  settings?: HeaderButton;
  /** The primary "+ {text}" button, last: only where the page can add. */
  add?: HeaderButton & { text: string };
  /** More icon buttons ({@link Button} `variant="icon"`), after refresh
   *  and before the gear. */
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
        <Button
          variant="icon"
          busy={refresh.busy}
          onClick={refresh.onClick}
          label={refresh.label}
          title={refresh.title ?? refresh.label}
        >
          <RefreshIcon />
        </Button>
      )}
      {children}
      {settings && (
        <Button
          variant="icon"
          onClick={settings.onClick}
          label={settings.label}
          title={settings.title ?? settings.label}
        >
          <GearIcon />
        </Button>
      )}
      {add && (
        <Button
          variant="primary"
          size="sm"
          className="page-controls-add"
          icon={<NamedIcon name="plus" size={14} />}
          busy={add.busy}
          onClick={add.onClick}
          aria-label={add.label}
          title={add.title ?? add.label}
        >
          {add.text}
        </Button>
      )}
    </div>
  );
}
