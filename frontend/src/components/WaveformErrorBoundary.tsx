import React from 'react'

interface State { hasError: boolean; error: string }

export class WaveformErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: '' }
  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, error: err instanceof Error ? err.message : String(err) }
  }
  componentDidCatch(err: unknown) { console.error('[WaveformErrorBoundary]', err) }
  render() {
    if (this.state.hasError) {
      return <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Waveform error: {this.state.error} <button onClick={() => this.setState({ hasError: false, error: '' })} className="ml-2 underline">Retry</button></div>
    }
    return this.props.children
  }
}
