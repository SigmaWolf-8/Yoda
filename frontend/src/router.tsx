import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { getStoredToken } from './api/client';

// ── Lazy-loaded page components ──
// Each page will be built in subsequent tasks.
// For now, we create placeholder components that render cleanly.

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
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

// ── Protected Route wrapper ──

function ProtectedRoute() {
  const token = getStoredToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

// ── Public Route wrapper (redirect to dashboard if already logged in) ──

function PublicRoute() {
  const token = getStoredToken();
  if (token) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export const router = createBrowserRouter([
  // ── Public routes ──
  {
    element: <PublicRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },

  // ── Public Forge page (no auth, no AppShell — has its own chrome) ──
  { path: '/forge', element: <ForgePage /> },

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
          { path: 'monitoring', element: <MonitoringPage /> },
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
