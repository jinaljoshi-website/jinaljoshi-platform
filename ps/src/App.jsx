// ps/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Homepage from './pages/Homepage';
import Auth     from './pages/Auth';
import Landing  from './pages/Landing';
import Platform from './pages/Platform';
import Terms    from './pages/Terms';
import Privacy  from './pages/Privacy';
import Refund   from './pages/Refund';
import Shipping from './pages/Shipping';
import Contact  from './pages/Contact';
import Sitemap  from './pages/Sitemap';
import OutfitsInfo from './pages/OutfitsInfo';
import { C, F } from './tokens';

function isLoggedIn() {
  return !!localStorage.getItem('jwt');
}

function Private({ children }) {
  const location = useLocation();
  if (isLoggedIn()) return children;

  // Kept in sessionStorage rather than the URL: it survives the round trip
  // through email verification, which leaves and returns on a different link.
  try { sessionStorage.setItem('afterAuth', location.pathname + location.search); } catch {}
  return <Navigate to="/auth?mode=login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: F.sans }}>
        <Routes>
          <Route path="/"        element={<Homepage />} />
          <Route path="/auth"    element={<Auth />} />
          <Route path="/terms"   element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/refund"   element={<Refund />} />
          <Route path="/shipping" element={<Shipping />} />
          <Route path="/contact"  element={<Contact />} />
          <Route path="/sitemap" element={<Sitemap />} />
          <Route path="/outfits" element={<OutfitsInfo />} />

          {/* Landing is its own top-level route — no sidebar/topbar chrome */}
          <Route
            path="/platform/landing"
            element={
              <Private>
                <Landing />
              </Private>
            }
          />

          <Route
            path="/platform/*"
            element={
              <Private>
                <Platform />
              </Private>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}