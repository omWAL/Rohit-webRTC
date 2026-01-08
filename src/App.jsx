import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import CandidateJoin from './pages/CandidateJoin';
import Waiting from './pages/Waiting';
import Interview from './pages/Interview';
import Host from './pages/Host';
import HostInterview from './pages/HostInterview';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 10, borderBottom: '1px solid #ddd' }}>
        <Link to="/join" style={{ marginRight: 10 }}>Join</Link>
        <Link to="/host" style={{ marginRight: 10 }}>Host</Link>
      </nav>

      <Routes>
        <Route path="/" element={<CandidateJoin />} />
        <Route path="/join" element={<CandidateJoin />} />
        <Route path="/waiting" element={<Waiting />} />
        <Route path="/interview" element={<Interview />} />
        <Route path="/host" element={<Host />} />
        <Route path="/host-interview" element={<HostInterview />} />
      </Routes>
    </BrowserRouter>
  );
}
