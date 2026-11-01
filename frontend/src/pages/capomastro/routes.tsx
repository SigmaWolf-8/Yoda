import type { RouteObject } from 'react-router-dom';
import { Globe2, Scale, ScrollText } from 'lucide-react';
import { ConservationLayout } from './ConservationLayout';
import { ConservationPage } from './ConservationPage';
import { SovereignLedgerPage } from './SovereignLedgerPage';
import { StatementsPage } from './StatementsPage';
import { CollectionsPage } from './CollectionsPage';
import { CodexPage } from './CodexPage';
import { SealPage } from './SealPage';
import { CompendiumPage } from './CompendiumPage';
import { EarthEnginePage } from './EarthEnginePage';

/** Shared audit context covers every Capomastro page without altering sealed documents. */
export const capomastroRoutes: RouteObject = {
  path: 'capomastro',
  element: <ConservationLayout />,
  children: [
    { path: 'ledger', element: <SovereignLedgerPage /> },
    { path: 'statements', element: <StatementsPage /> },
    { path: 'collections', element: <CollectionsPage /> },
    { path: 'codex', element: <CodexPage /> },
    { path: 'earth-engine', element: <EarthEnginePage /> },
    { path: 'seal', element: <SealPage /> },
    { path: 'conservation', element: <ConservationPage /> },
    { path: 'compendium', element: <CompendiumPage /> },
  ],
};
export const conservationNavigation = { to: '/capomastro/conservation', icon: Scale, label: 'Conservation' };
export const compendiumNavigation = { to: '/capomastro/compendium', icon: ScrollText, label: 'Compendium' };
export const earthEngineNavigation = { to: '/capomastro/earth-engine', icon: Globe2, label: 'Earth & Isopsephy' };
