import React from 'react'

// Error boundary for third-party MAB embed widgets. A throw inside an embed
// custom element would otherwise unmount the whole React tree and blank the
// page; this contains the failure to the single widget and keeps the rest of
// the app (and any sibling widget) alive. It only renders the fallback on an
// actual thrown error — working widgets render normally.
type Props = { children: React.ReactNode; fallback: React.ReactNode }
type State = { hasError: boolean }

export class WidgetBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    // Breadcrumb for diagnostics; does not re-throw.
    console.warn('[WidgetBoundary] embed widget failed to render:', error?.message, error)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
