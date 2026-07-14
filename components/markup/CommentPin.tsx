'use client';

interface CommentPinProps {
  index: number;
  x: number;
  y: number;
  isActive: boolean;
  onClick: () => void;
  // Not-yet-posted tag being placed — rendered as a distinct pulsing marker with no number
  isPending?: boolean;
}

export default function CommentPin({ index, x, y, isActive, onClick, isPending = false }: CommentPinProps) {
  return (
    <div
      className="absolute flex items-center justify-center cursor-pointer select-none"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: isPending ? 30 : isActive ? 20 : 10,
        pointerEvents: 'auto',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {isPending ? (
        <span className="relative flex h-5 w-5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-5 w-5 rounded-full bg-blue-600 border-2 border-white shadow-md" />
        </span>
      ) : (
        <div
          className={`
            w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold
            shadow-md transition-colors
            ${isActive ? 'bg-blue-600 ring-2 ring-blue-300 animate-pulse' : 'bg-gray-500 hover:bg-gray-600'}
          `}
        >
          {index}
        </div>
      )}
    </div>
  );
}
