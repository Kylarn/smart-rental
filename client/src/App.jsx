import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const Home = lazy(() => import('./pages/Home.jsx'));
const MarketProperty = lazy(() => import('./pages/MarketProperty.jsx'));

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Properties = lazy(() => import('./pages/Properties.jsx'));
const PropertyDetail = lazy(() => import('./pages/PropertyDetail.jsx'));
const Units = lazy(() => import('./pages/Units.jsx'));
const Tenants = lazy(() => import('./pages/Tenants.jsx'));
const TenantDetail = lazy(() => import('./pages/TenantDetail.jsx'));
const Leases = lazy(() => import('./pages/Leases.jsx'));
const Applications = lazy(() => import('./pages/Applications.jsx'));
const Payments = lazy(() => import('./pages/Payments.jsx'));
const Maintenance = lazy(() => import('./pages/Maintenance.jsx'));
const Expenses = lazy(() => import('./pages/Expenses.jsx'));
const MoveOuts = lazy(() => import('./pages/MoveOuts.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Announcements = lazy(() => import('./pages/Announcements.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const MyLease = lazy(() => import('./pages/MyLease.jsx'));
const AdminUsers = lazy(() => import('./pages/AdminUsers.jsx'));
const AdminAudit = lazy(() => import('./pages/AdminAudit.jsx'));
const AdminSettings = lazy(() => import('./pages/AdminSettings.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="full-load"><Spinner label="Loading…" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

function LegacyRedirect({ prefix }) {
  const location = useLocation();
  const rest = location.pathname === prefix ? '' : location.pathname.slice(prefix.length).replace(/^\/+/, '');
  const target = rest ? `/app/${rest}` : '/app';
  return <Navigate to={`${target}${location.search}`} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="full-load"><Spinner label="Loading…" /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/property/:id" element={<MarketProperty />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="properties" element={<Properties />} />
          <Route path="properties/:id" element={<PropertyDetail />} />
          <Route path="units" element={<Units />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:id" element={<TenantDetail />} />
          <Route path="leases" element={<Leases />} />
          <Route path="lease" element={<MyLease />} />
          <Route path="applications" element={<Applications />} />
          <Route path="payments" element={<Payments />} />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="moveouts" element={<MoveOuts />} />
          <Route path="messages" element={<Messages />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="reports" element={<Reports />} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin/users" element={<AdminUsers />} />
          <Route path="admin/audit" element={<AdminAudit />} />
          <Route path="admin/settings" element={<AdminSettings />} />
        </Route>

        <Route path="/tenant/*" element={<LegacyRedirect prefix="/tenant" />} />
        <Route path="/landlord/*" element={<LegacyRedirect prefix="/landlord" />} />
        <Route path="/caretaker/*" element={<LegacyRedirect prefix="/caretaker" />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}