'use client';

import { useRef, useEffect } from 'react';

interface VideoViewerProps {
  url: string;
  frozen?: boolean;
  /**
   * Fired once the first frame is decodable — or the load failed. The
   * viewport's loading indicator waits on this.
   */
  onReady?: () => void;
}

export default function VideoViewer({ url, frozen = false, onReady }: VideoViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (frozen && videoRef.current) {
      videoRef.current.pause();
    }
    // Intentionally no play() when frozen=false — user resumes manually
  }, [frozen]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <video
        ref={videoRef}
        src={url}
        controls
        crossOrigin="anonymous"
        onLoadedData={onReady}
        onError={onReady}
        className="max-h-full max-w-full"
        style={{ maxHeight: '80vh' }}
      >
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
