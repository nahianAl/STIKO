'use client';

interface VideoViewerProps {
  url: string;
}

export default function VideoViewer({ url }: VideoViewerProps) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <video
        src={url}
        controls
        className="max-h-full max-w-full"
        style={{ maxHeight: '80vh' }}
      >
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
