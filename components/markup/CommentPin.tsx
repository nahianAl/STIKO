'use client';

interface CommentPinProps {
  index: number;
  x: number;
  y: number;
  isActive: boolean;
  onClick: () => void;
  // Not-yet-posted tag being placed — rendered as a distinct pulsing marker with no number
  isPending?: boolean;
  fill?: string;      // pastel swatch color
  textColor?: string; // dark number color
}

export default function CommentPin({ index, x, y, isActive, onClick, isPending = false, fill = '#FFE2E2', textColor = '#B23A52' }: CommentPinProps) {
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
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#8094F5] opacity-75 animate-ping" />
          <span className="relative inline-flex h-5 w-5 rounded-full bg-[#5B60FF] border-2 border-white shadow-md" />
        </span>
      ) : (
        <div
          className={`w-7 h-7 flex items-center justify-center text-[12px] font-extrabold transition-transform ${isActive ? 'scale-110' : 'hover:scale-105'}`}
          style={{
            background: fill,
            color: textColor,
            borderRadius: '50% 50% 50% 2px',
            boxShadow: isActive
              ? '0 4px 10px -2px rgba(0,0,0,0.25), 0 0 0 2px #fff, 0 0 0 4px #5B60FF'
              : '0 4px 10px -2px rgba(0,0,0,0.2)',
          }}
        >
          {index}
        </div>
      )}
    </div>
  );
}
