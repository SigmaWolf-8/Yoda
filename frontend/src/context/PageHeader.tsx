import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import type { ComponentType } from 'react';

export interface PageHeaderConfig {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  /** Optional right-side action rendered in the top bar (must be a stable memoized node) */
  action?: ReactNode;
}

interface PageHeaderCtx {
  header: PageHeaderConfig | null;
  setHeader: (h: PageHeaderConfig | null) => void;
}

const PageHeaderContext = createContext<PageHeaderCtx>({
  header: null,
  setHeader: () => {},
});

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<PageHeaderConfig | null>(null);
  return (
    <PageHeaderContext.Provider value={{ header, setHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

/**
 * Call inside a page component to push its title/subtitle/icon into the top bar.
 * Pass a `useMemo`-ed ReactNode for `action` if you need a button in the top bar.
 * Effect re-runs only when title or subtitle change; icon and action are read from
 * a ref so they're always current without causing extra re-renders.
 */
export function usePageHeader(config: PageHeaderConfig) {
  const { setHeader } = useContext(PageHeaderContext);
  const ref = useRef(config);
  ref.current = config;

  // Push on mount, clear on unmount
  useEffect(() => {
    setHeader(ref.current);
    return () => setHeader(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-push whenever title or subtitle changes
  const { title, subtitle } = config;
  useEffect(() => {
    setHeader({ ...ref.current });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle]);
}

export function usePageHeaderCtx() {
  return useContext(PageHeaderContext);
}
