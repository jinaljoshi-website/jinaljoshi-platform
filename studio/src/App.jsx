// studio/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login      from './pages/Login';
import Studio     from './pages/Studio';

function isLoggedIn() {
  return !!sessionStorage.getItem('jwt');
}

function Private({ children }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<Private><Studio /></Private>} />
      </Routes>
    </BrowserRouter>
  );
}