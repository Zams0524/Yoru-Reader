import { useEffect, useState } from 'react';
import {
  applyDeviceClasses,
  getDeviceClass,
  isCompactShell,
  watchDeviceClass,
  type DeviceClass,
} from '../utils/platform';

export interface DeviceInfo {
  /** 'phone' | 'tablet' | 'desktop' — how much room there is. */
  deviceClass: DeviceClass;
  /** The compact chrome: top app bar, bottom tab bar, drawer. True on every Android screen. */
  compact: boolean;
}

/**
 * Current shell and size, re-rendering the component when either changes
 * (rotation, split screen, window resize). Keeps the <html> classes in sync
 * too, so the React shell and the stylesheet can never disagree about the
 * screen — the mismatch that broke the library on Android tablets.
 */
export function useDeviceClass(): DeviceInfo {
  const read = (): DeviceInfo => ({ deviceClass: getDeviceClass(), compact: isCompactShell() });
  const [info, setInfo] = useState<DeviceInfo>(read);

  useEffect(() => {
    applyDeviceClasses();
    setInfo(read());
    return watchDeviceClass(() => {
      applyDeviceClasses();
      setInfo(read());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return info;
}

export default useDeviceClass;
