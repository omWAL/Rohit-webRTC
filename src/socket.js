import { io } from 'socket.io-client';

// Connect to backend Socket.IO server
const socket = io('http://localhost:3000', {
  autoConnect: true,
});

export default socket;
