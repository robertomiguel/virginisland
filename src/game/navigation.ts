'use client';
import { useSyncExternalStore } from 'react';

export type NavigationMode = 'orbit' | 'walk';

export interface NavigationState {
  mode: NavigationMode;
}

const listeners = new Set<() => void>();

/** ?modo=caminar arranca en primera persona (para revisar un rincón sin tener que ir andando). */
const initialMode: NavigationMode =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('modo') === 'caminar' ? 'walk' : 'orbit';

export const navigationState: NavigationState = {
  mode: initialMode,
};

export function getNavigationMode(): NavigationMode {
  return navigationState.mode;
}

export function setNavigationMode(mode: NavigationMode) {
  if (navigationState.mode === mode) return;
  navigationState.mode = mode;
  listeners.forEach((fn) => fn());
}

export function toggleNavigationMode() {
  setNavigationMode(navigationState.mode === 'orbit' ? 'walk' : 'orbit');
}

export function subscribeNavigation(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useNavigationMode(): NavigationMode {
  return useSyncExternalStore(
    subscribeNavigation,
    () => navigationState.mode,
    () => 'orbit'
  );
}
