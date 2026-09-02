'use client';

import { Component, type ReactNode } from 'react';

/**
 * The viewer had no error boundary. A throw from useLoader inside <Suspense> had nothing to
 * catch it, so it propagated past the viewer and onReady never fired — leaving the
 * viewport's loading indicator up over a file that had already definitively failed.
 *
 * A class component because React has no hook equivalent of componentDidCatch.
 */
interface Props {
  /**
   * Must be called on the failure path. The page holds ONE loading indicator until a file
   * is on screen OR definitively cannot be; a branch that forgets this leaves the indicator
   * covering the very message explaining why there is nothing to see.
   */
  onReady?: () => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class ModelErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('3D model could not be displayed.', error);
    this.props.onReady?.();
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-gray-700">
            This 3D file could not be displayed.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            It may be too complex to prepare in the browser. Ask whoever uploaded it to share a GLB version.
          </p>
        </div>
      </div>
    );
  }
}
