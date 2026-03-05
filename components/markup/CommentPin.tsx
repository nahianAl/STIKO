'use client';

interface CommentPinProps {
  index: number;
  x: number;
  y: number;
  isActive: boolean;
  onClick: () => void;
}

export default function CommentPin({ index, x, y, isActive, onClick }: CommentPinProps) {
  return (
    <div
      className="absolute flex items-center justify-center cursor-pointer select-none"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: isActive ? 20 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div
        className={`
          w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold
          shadow-md transition-colors
          ${isActive ? 'bg-blue-600 ring-2 ring-blue-300 animate-pulse' : 'bg-gray-500 hover:bg-gray-600'}
        `}
      >
        {index}
      </div>
    </div>
  );
}
