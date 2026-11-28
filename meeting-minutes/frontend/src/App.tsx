import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, ApiError } from './api';
import { ROLE } from './labels';
import type { Me, Role } from './types';
import Login from './pages/Login';
import Meetings from './pages/Meetings';
import Meeting from './pages/Meeting';
import Settings from './pages/Settings';

interface Session { me: Me | null; setMe: (m: Me | null) => void; can: (role: Role) => boolean }
const SessionContext = createContext<Session>({ me: null, setMe: () => {}, can: () => false });
export const useSession = () => useContext(SessionContext);
const ORDER: Role[] = ['viewer', 'editor', 'approver', 'admin'];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<Me>('/api/auth/me').then(setMe).catch((e) => { if (!(e instanceof ApiError)) console.error(e); }).finally(() => setLoading(false));
  }, []);
  const can = useCallback((role: Role) => !!me && ORDER.indexOf(me.role) >= ORDER.indexOf(role), [me]);
  const logout = async () => { await api.post('/api/auth/logout').catch(() => {}); setMe(null); };

  if (loading) return <div className="empty">جارٍ التحميل…</div>;
  if (!me) return <SessionContext.Provider value={{ me, setMe, can }}><Login /></SessionContext.Provider>;
  return (
    <SessionContext.Provider value={{ me, setMe, can }}>
      <header className="topbar">
        <Link to="/" className="brand"><strong>مَحضَر</strong><span>محاضر الاجتماعات المستندة إلى الأدلة</span></Link>
        <nav aria-label="القائمة الرئيسية">
          <NavLink to="/" end>الاجتماعات</NavLink>
          <NavLink to="/settings">الإعدادات والمسرد</NavLink>
        </nav>
        <div className="who">
          <span>{me.name} — {ROLE[me.role]} — {me.org_name}</span>
          <button className="btn small" onClick={logout}>خروج</button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Meetings />} />
          <Route path="/meetings/:id" element={<Meeting />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </SessionContext.Provider>
  );
}
