import React from 'react';

export default function DebugPanel({ logs }) {
  return (
    <div style={{ marginTop: 10, padding: 8, border: '1px solid #ddd', background: '#fafafa', maxHeight: 200, overflow: 'auto' }}>
      <h4 style={{ margin: 0, color: '#000' }}>Debug Logs</h4>
      <ul style={{ fontSize: 12, marginTop: 6 }}>
        {logs.slice().reverse().map((l, i) => (
          <li key={i} style={{ marginBottom: 4, color: '#000' }}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
