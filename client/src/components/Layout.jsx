import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  DoorOpen,
  Users,
  FileText,
  Inbox,
  Wallet,
  Wrench,
  MessageSquare,
  Bell,
  Megaphone,
  BarChart3,
  ReceiptText,
  Receipt,
  Settings,
  ScrollText,
  Store,
  UserCog,
  LogOut,
  Menu,
  X,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { Avatar } from './ui.jsx';

const NAV = {
  landlord: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/properties', label: 'Properties', icon: Building2 },
    { to: '/app/units', label: 'Units', icon: DoorOpen },
    { to: '/app/tenants', label: 'Tenants', icon: Users },
    { to: '/app/leases', label: 'Leases', icon: FileText },
    { to: '/app/applications', label: 'Applications', icon: Inbox },
    { to: '/app/payments', label: 'Payments', icon: Wallet },
    { to: '/app/maintenance', label: 'Maintenance', icon: Wrench },
    { to: '/app/expenses', label: 'Expenses', icon: ReceiptText },
    { to: '/app/bills', label: 'Utility Bills', icon: Receipt },
    { to: '/app/moveouts', label: 'Move-Outs', icon: ClipboardList },
    { to: '/app/messages', label: 'Messages', icon: MessageSquare },
    { to: '/app/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/app/reports', label: 'Reports', icon: BarChart3 },
  ],
  caretaker: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/properties', label: 'Properties', icon: Building2 },
    { to: '/app/units', label: 'Units', icon: DoorOpen },
    { to: '/app/tenants', label: 'Tenants', icon: Users },
    { to: '/app/leases', label: 'Leases', icon: FileText },
    { to: '/app/payments', label: 'Payments', icon: Wallet },
    { to: '/app/maintenance', label: 'Maintenance', icon: Wrench },
    { to: '/app/expenses', label: 'Expenses', icon: ReceiptText },
    { to: '/app/bills', label: 'Utility Bills', icon: Receipt },
    { to: '/app/moveouts', label: 'Move-Outs', icon: ClipboardList },
    { to: '/app/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/app/messages', label: 'Messages', icon: MessageSquare },
    { to: '/app/reports', label: 'Reports', icon: BarChart3 },
  ],
  tenant: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/lease', label: 'My Lease', icon: FileText },
    { to: '/app/payments', label: 'Rent & Payments', icon: Wallet },
    { to: '/app/my-bills', label: 'My Bills', icon: Receipt },
    { to: '/app/maintenance', label: 'Maintenance', icon: Wrench },
    { to: '/app/applications', label: 'Applications', icon: Inbox },
    { to: '/app/messages', label: 'Messages', icon: MessageSquare },
    { to: '/app/announcements', label: 'Announcements', icon: Megaphone },
  ],
  admin: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/admin/users', label: 'Users', icon: UserCog },
    { to: '/app/properties', label: 'Properties', icon: Building2 },
    { to: '/app/leases', label: 'Leases', icon: FileText },
    { to: '/app/payments', label: 'Payments', icon: Wallet },
    { to: '/app/bills', label: 'Utility Bills', icon: Receipt },
    { to: '/app/maintenance', label: 'Maintenance', icon: Wrench },
    { to: '/app/reports', label: 'Reports', icon: BarChart3 },
    { to: '/app/admin/audit', label: 'Audit Log', icon: ScrollText },
    { to: '/app/admin/settings', label: 'Settings', icon: Settings },
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const items = NAV[user?.role] || [];

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .get('/api/notifications?limit=1')
        .then((d) => active && setUnread(d.unread || 0))
        .catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">SR</span>
          <span className="brand-name">
            Smart <strong>Rentals</strong>
          </span>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/" className="nav-item subtle" target="_blank" rel="noreferrer">
            <Store size={18} />
            <span>Public marketplace</span>
          </NavLink>
        </div>
      </aside>

      {open ? <div className="sidebar-scrim" onClick={() => setOpen(false)} /> : null}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-spacer" />
          <NavLink to="/app/notifications" className="icon-btn notif-btn" aria-label="Notifications">
            <Bell size={20} />
            {unread > 0 ? <span className="notif-dot">{unread > 99 ? '99+' : unread}</span> : null}
          </NavLink>
          <div className="user-menu">
            <NavLink to="/app/profile" className="user-chip">
              <Avatar name={user?.full_name} src={user?.avatar_url} size={34} />
              <span className="user-meta">
                <strong>{user?.full_name}</strong>
                <em>{user?.role}</em>
              </span>
            </NavLink>
            <button className="icon-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
