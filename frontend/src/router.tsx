import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';


// ── Lazy-loaded page components ──
// Each page will be built in subsequent tasks.
// For now, we create placeholder components that render cleanly.

import { TorusGatePage } from './pages/TorusGatePage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { CrystalAuthPage } from './pages/auth/CrystalAuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectListPage } from './pages/project/ProjectListPage';
import { ProjectWorkspacePage } from './pages/project/ProjectWorkspacePage';
import { TaskTreePage } from './pages/project/TaskTreePage';
import { TaskBiblePage } from './pages/project/TaskBiblePage';
import { KnowledgeBasePage } from './pages/project/KnowledgeBasePage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { EngineSettingsPage } from './pages/settings/EngineSettingsPage';
import { OrgSettingsPage } from './pages/settings/OrgSettingsPage';
import { ApiKeyPage } from './pages/settings/ApiKeyPage';
import { InstallPage } from './pages/settings/InstallPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { KyokushinPage } from './pages/KyokushinPage';
import { ForgePage } from './pages/ForgePage';
import { AgentsPage } from './pages/AgentsPage';
import { AboutPage } from './pages/AboutPage';
import { SovereignLedgerPage } from './pages/capomastro/SovereignLedgerPage';
import { StatementsPage } from './pages/capomastro/StatementsPage';
import { CodexPage } from './pages/capomastro/CodexPage';
import { SealPage } from './pages/capomastro/SealPage';

// ── Route wrappers ──
//
// The Torus Gate no longer stands between the operator and the app. Identity
// comes from the synchronous framework, so no route redirects to /login and no
// page is withheld pending a token. The gate pages remain reachable by URL for
// enrolment and testing; they simply no longer block anything.

function ProtectedRoute() {
  return <Outlet />;
}

function PublicRoute() {
  return <Outlet />;
}

export const router = createBrowserRouter([
  // ── Public routes ──
  {
    element: <PublicRoute />,
    children: [
      { path: '/login', element: <TorusGatePage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/crystal', element: <CrystalAuthPage /> },
    ],
  },

  // ── Public-with-shell routes (no auth, but rendered inside AppShell
  //    so the sidebar stays visible next to the page) ──
  {
    element: <AppShell />,
    children: [
      { path: 'forge',      element: <ForgePage /> },
      { path: 'monitoring', element: <MonitoringPage /> },
      // ── Capomastro sovereign record — a published record, so no auth gate ──
      { path: 'capomastro/ledger', element: <SovereignLedgerPage /> },
      { path: 'capomastro/statements', element: <StatementsPage /> },
      { path: 'capomastro/codex',  element: <CodexPage /> },
      { path: 'capomastro/seal',   element: <SealPage /> },
    ],
  },

  // ── Protected routes (wrapped in AppShell) ──
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'projects', element: <ProjectListPage /> },
          {
            path: 'projects/:id',
            element: <ProjectWorkspacePage />,
          },
          {
            path: 'projects/:id/tasks',
            element: <TaskTreePage />,
          },
          {
            path: 'projects/:id/threads/:threadId/dag',
            element: <TaskTreePage />,
          },
          {
            path: 'projects/:id/bible',
            element: <TaskBiblePage />,
          },
          {
            path: 'projects/:id/kb',
            element: <KnowledgeBasePage />,
          },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'settings/engines', element: <EngineSettingsPage /> },
          { path: 'settings/org', element: <OrgSettingsPage /> },
          { path: 'settings/api-keys', element: <ApiKeyPage /> },
          { path: 'settings/install', element: <InstallPage /> },
          { path: 'kyokushin', element: <KyokushinPage /> },
          { path: 'agents', element: <AgentsPage /> },
          { path: 'about', element: <AboutPage /> },
        ],
      },
    ],
  },

  // ── Catch-all ──
  { path: '*', element: <Navigate to="/" replace /> },
]);
