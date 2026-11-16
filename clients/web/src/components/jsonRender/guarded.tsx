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
 */

import { Component, createElement, type ComponentType, type ReactNode } from "react";

interface BoundaryProps {
  type: string;
  props: unknown;
  children: ReactNode;
}

class ElementFailure extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.error && previous.props !== this.props.props) this.setState({ error: null });
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
    const Guarded = (renderProps: { props?: unknown }) => (
      <ElementFailure type={type} props={renderProps.props}>
        {createElement(Impl as ComponentType<typeof renderProps>, renderProps)}
      </ElementFailure>
    );
    Guarded.displayName = `Guarded(${type})`;
    out[type] = Guarded as ComponentType<never>;
  }
  return out as T;
}
