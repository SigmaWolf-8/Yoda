import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react';

interface VideoPlayCtx {
  sidebarRef:  React.RefObject<HTMLVideoElement | null>;
  heroRef:     React.RefObject<HTMLVideoElement | null>;
  playSidebar: () => void;
  playHero:    () => void;
}

const Ctx = createContext<VideoPlayCtx | null>(null);

export function VideoPlayProvider({ children }: { children: ReactNode }) {
  const sidebarRef = useRef<HTMLVideoElement | null>(null);
  const heroRef    = useRef<HTMLVideoElement | null>(null);

  const playSidebar = useCallback(() => {
    const v = sidebarRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }, []);

  const playHero = useCallback(() => {
    const v = heroRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ sidebarRef, heroRef, playSidebar, playHero }}>
      {children}
    </Ctx.Provider>
  );
}

export function useVideoPlay() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVideoPlay must be used within VideoPlayProvider');
  return ctx;
}
