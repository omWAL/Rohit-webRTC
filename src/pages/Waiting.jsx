import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';

export default function Waiting() {
  const [position, setPosition] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const sessionCode = sessionStorage.getItem('sessionCode');
    if (!sessionCode) return navigate('/join');

    // Listen for queue updates
    socket.on('queue_update', ({ queue, you }) => {
      if (you != null) setPosition(you);
    });

    socket.on('interview_start', ({ hostId }) => {
      // Save hostId for signaling
      sessionStorage.setItem('hostId', hostId);
      navigate('/interview');
    });

    socket.on('interview_ended', () => {
      // go back to join
      sessionStorage.removeItem('sessionCode');
      sessionStorage.removeItem('hostId');
      navigate('/join');
    });

    return () => {
      socket.off('queue_update');
      socket.off('interview_start');
      socket.off('interview_ended');
    };
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Waiting for interview</h2>
      <p>Session code: <strong>{sessionStorage.getItem('sessionCode')}</strong></p>
      <p>{position != null ? `Your position: ${position}` : 'Joining...'}</p>
      <p>Stay on this page until the interviewer starts your session.</p>
    </div>
  );
}
