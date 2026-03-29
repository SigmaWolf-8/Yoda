import { createContext, useContext, useRef, useCallback, useEffect, type ReactNode } from 'react';

interface VideoPlayCtx {
  sidebarRef:           React.RefObject<HTMLVideoElement | null>;
  heroRef:              React.RefObject<HTMLVideoElement | null>;
  playSidebar:          () => void;
  playSidebarAfterDelay: (ms: number) => void;
  playHero:             () => void;
}

const Ctx = createContext<VideoPlayCtx | null>(null);

export function VideoPlayProvider({ children }: { children: ReactNode }) {
  const sidebarRef  = useRef<HTMLVideoElement | null>(null);
  const heroRef     = useRef<HTMLVideoElement | null>(null);
  const sidebarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (sidebarTimer.current !== null) clearTimeout(sidebarTimer.current);
  }, []);

  const playSidebar = useCallback(() => {
    const v = sidebarRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }, []);

  const playSidebarAfterDelay = useCallback((ms: number) => {
    if (sidebarTimer.current !== null) clearTimeout(sidebarTimer.current);
    sidebarTimer.current = setTimeout(() => {
      sidebarTimer.current = null;
      const v = sidebarRef.current;
      if (!v) return;
      v.currentTime = 0;
      v.play().catch(() => {});
    }, ms);
  }, []);

  const playHero = useCallback(() => {
    const v = heroRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ sidebarRef, heroRef, playSidebar, playSidebarAfterDelay, playHero }}>
      {children}
    </Ctx.Provider>
  );
}

export function useVideoPlay() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVideoPlay must be used within VideoPlayProvider');
  return ctx;
}
