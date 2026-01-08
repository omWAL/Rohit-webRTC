import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';

export default function CandidateJoin() {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();
    if (!code.trim()) return setError('Enter session code');
    socket.emit('join_session', { code: code.trim().toUpperCase() }, (res) => {
      if (res && res.ok) {
        // store session code locally for later pages
        sessionStorage.setItem('sessionCode', code.trim().toUpperCase());
        navigate('/waiting');
      } else {
        setError(res && res.error ? res.error : 'Invalid code');
      }
    });
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Join Interview</h2>
      <form onSubmit={handleSubmit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter session code (e.g. 19UDGK)"
        />
        <button type="submit">Join</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
