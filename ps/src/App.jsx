// App.jsx
// Personal Space — ps.jinaljoshi.in
// Main app router

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Homepage from './pages/Homepage';
import Auth from './pages/Auth';
import Platform from './pages/Platform';
import { C, F } from './tokens';

function isLoggedIn() {
  return !!sessionStorage.getItem('jwt');
}

function Private({ children }) {
  return isLoggedIn() ? children : <Navigate to="/auth?mode=login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <div
        style={{
          background: C.bg,
          minHeight: '100vh',
          color: C.text,
          fontFamily: F.sans,
        }}
      >
        <Routes>
          <Route path="/" element={<Homepage />} />
          <Route path="/auth" element={<Auth />} />
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