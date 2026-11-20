/**
 * Every catalog component, drawn inside a boundary that says what failed.
 *
 * @json-render/react wraps each element in its own boundary, which logs
 * the error to the console and renders nothing. A spec the model garbled
 * (a chart's ``data`` missing, a Table's ``columns`` not a list) therefore
 * drew a card with headings and a blank where the chart should be, and
 * the person had no way to tell it had failed (R666). Ours catches first
 * and draws the failure in the element's place; new props try again, as
 * a stream delta that completes the element should.
 *
 * The catch is also told to the card that drew it, through
 * {@link ElementFailureContext}: the card reports what it drew to the
 * backend, and the agent is told what is on the screen.
 */

import {
  Component,
  createContext,
  createElement,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

/** One element of a card the client could not draw. */
export interface ElementDrawFailure {
  /** The element's type, e.g. ``BarGraph``. */
  type: string;
  /** Why it could not be drawn, in the client's words. */
  message: string;
}

/**
 * Where a failed element's word goes: the card that drew it.
 *
 * The card tells the backend what it drew, and the backend tells the
 * agent — so the agent says what is on the screen rather than what it
 * hoped for (R666). A card with no listener simply drops the word.
 */
export const ElementFailureContext = createContext<(failure: ElementDrawFailure) => void>(
  () => {},
);

interface BoundaryProps {
  type: string;
  props: unknown;
  children: ReactNode;
  onFailure?: (failure: ElementDrawFailure) => void;
}

class ElementFailure extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  /** The element failed: say so to whoever is drawing the card. The
   *  card cannot see this on its own — the boundary caught it. */
  componentDidCatch(error: Error) {
    this.tell(error);
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (!this.state.error) return;
    if (previous.props !== this.props.props) {
      this.setState({ error: null });
      return;
    }
    // Still failed, and a new draw of the card is listening. The
    // renderer does not draw an unchanged element again, so nothing
    // throws for the new draw: without this word it would say it drew
    // everything over the failure still on the card (R666).
    if (previous.onFailure !== this.props.onFailure) this.tell(this.state.error);
  }

  private tell(error: Error) {
    this.props.onFailure?.({
      type: this.props.type,
      message: String(error?.message ?? "").slice(0, 200),
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="jr-unknown jr-element-error" role="note">
        Could not draw <code>{this.props.type}</code>: {String(this.state.error.message).slice(0, 200)}
      </div>
    );
  }
}

/** ``components`` with each entry drawn inside {@link ElementFailure}. */
export function guarded<T extends Record<string, ComponentType<never>>>(components: T): T {
  const out: Record<string, ComponentType<never>> = {};
  for (const [type, Impl] of Object.entries(components)) {
    const Guarded = (renderProps: { props?: unknown }) => {
      const onFailure = useContext(ElementFailureContext);
      return (
        <ElementFailure type={type} props={renderProps.props} onFailure={onFailure}>
          {createElement(Impl as ComponentType<typeof renderProps>, renderProps)}
        </ElementFailure>
      );
    };
    Guarded.displayName = `Guarded(${type})`;
    out[type] = Guarded as ComponentType<never>;
  }
  return out as T;
}
