// studio/src/App.jsx
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login  from './pages/Login';
import Studio from './pages/Studio';
import ErrorBoundary from './components/ErrorBoundary';
import { api } from './api';

function isLoggedIn() {
  return !!localStorage.getItem('jwt');
}

// Wraps protected routes — checks session on mount and every 5 minutes
function Private({ children }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate('/login', { replace: true });
      return;
    }

    // Verify token is still valid against the backend
    const checkSession = () => {
      api.get('/api/studio/dashboard').catch(() => {
        // api.js already redirects on 401 — this catches network errors
        // or cases where the token is malformed but not yet expired
      });
    };

    checkSession();

    // Re-check every 5 minutes
    const interval = setInterval(checkSession, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [navigate]);

  return isLoggedIn() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Outside the routes, so a crash anywhere inside is caught rather than
          taking the whole screen with it. */}
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Private><Studio /></Private>} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}