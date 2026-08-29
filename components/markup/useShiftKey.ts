'use client';

import { useEffect, useState } from 'react';

/**
 * Whether Shift is currently held, for the two gestures that modify their behaviour while it
 * is: rotation snapping on the markup Transformer and on the 3D gizmo.
 *
 * Drawing does NOT use this — a draw gesture reads shiftKey off the pointer event it is
 * already handling, which is both simpler and immune to the missed-keyup problem below.
 */
export default function useShiftKey(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(false); };
    // A tab switch or a drag that ends over browser chrome never delivers the keyup, which
    // would otherwise leave snapping stuck on for the rest of the session.
    const clear = () => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return held;
}
