import { useEffect, useState } from 'react';

export function useIsPwaMode() {
  const [isPwaMode, setIsPwaMode] = useState(false);

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)');

    const update = () => {
      const iosStandalone =
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsPwaMode(standaloneQuery.matches || fullscreenQuery.matches || iosStandalone);
    };

    update();
    standaloneQuery.addEventListener('change', update);
    fullscreenQuery.addEventListener('change', update);
    return () => {
      standaloneQuery.removeEventListener('change', update);
      fullscreenQuery.removeEventListener('change', update);
    };
  }, []);

  return isPwaMode;
}
