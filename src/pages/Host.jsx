import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';

export default function Host() {
  const [sessionCode, setSessionCode] = useState(null);
  const [queue, setQueue] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    socket.on('session_created', ({ code }) => {
      setSessionCode(code);
      sessionStorage.setItem('hostSession', code);
    });

    socket.on('queue_update', ({ queue }) => {
      setQueue(queue);
    });

    socket.on('candidate_selected', ({ candidate }) => {
      // move to interview page
      sessionStorage.setItem('activeCandidate', candidate);
      navigate('/host-interview');
    });

    socket.on('interview_ended_host', () => {
      // go back to host dashboard
      sessionStorage.removeItem('activeCandidate');
      navigate('/host');
    });

    socket.on('session_deleted', () => {
      setSessionCode(null);
      setQueue([]);
      sessionStorage.removeItem('hostSession');
    });

    return () => {
      socket.off('session_created');
      socket.off('queue_update');
      socket.off('candidate_selected');
      socket.off('interview_ended_host');
      socket.off('session_deleted');
    };
  }, []);

  function createSession() {
    socket.emit('create_session', null, (res) => {
      if (res && res.code) setSessionCode(res.code);
    });
  }

  function startNext() {
    const code = sessionCode || sessionStorage.getItem('hostSession');
    if (!code) return;
    socket.emit('start_next', { code });
  }

  function endInterview() {
    const code = sessionCode || sessionStorage.getItem('hostSession');
    if (!code) return;
    socket.emit('end_interview', { code });
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Host Dashboard</h2>
      <div>
        <button onClick={createSession}>Create Session</button>
        {sessionCode && <div style={{ marginTop: 10 }}>Session code: <strong>{sessionCode}</strong></div>}
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Queue</h3>
        <p>Count: {queue.length}</p>
        <ul>
          {queue.map((s, i) => (
            <li key={s}>{i + 1}. {s}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={startNext}>Start Next Interview</button>
        <button onClick={endInterview} style={{ marginLeft: 10 }}>End Interview</button>
      </div>
    </div>
  );
}
