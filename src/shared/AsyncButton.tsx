// ══════════════════════════════════════════════════════════════════════════════
// AsyncButton — Button with built-in async loading + error handling.
// Replaces the repeated useState(false) + try/finally pattern on every button.
//
// Usage:
//   <AsyncButton onClickAsync={async () => { await saveData(); }}>
//     Save Changes
//   </AsyncButton>
// ══════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ComponentProps } from 'react';

interface AsyncButtonProps extends Omit<ComponentProps<typeof Button>, 'onClick'> {
  /** Async function to run on click. Errors are caught and re-thrown (caller can wrap in toast). */
  onClickAsync: () => Promise<void>;
  /** Text shown while loading. Defaults to the button children. */
  loadingText?: string;
}

export default function AsyncButton({
  onClickAsync,
  loadingText,
  children,
  disabled,
  ...props
}: AsyncButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onClickAsync();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button {...props} disabled={disabled || loading} onClick={handleClick}>
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
