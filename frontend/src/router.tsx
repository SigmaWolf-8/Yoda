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
import { MonitoringPage } from './pages/MonitoringPage';
import { AgentsPage } from './pages/AgentsPage';

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
          { path: 'monitoring', element: <MonitoringPage /> },
          { path: 'agents', element: <AgentsPage /> },
        ],
      },
    ],
  },

  // ── Catch-all ──
  { path: '*', element: <Navigate to="/" replace /> },
]);
