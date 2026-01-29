<<<<<<< HEAD
🎥 Simple Interview System (React + Vite + WebRTC).

This project is a minimal online interview platform built using React, Vite, Socket.IO, and WebRTC.
It is designed as a demo / internship-level project focusing on peer-to-peer communication with no paid servers.

🚀 Tech Stack

Frontend: React + Vite

Backend: Node.js + Socket.IO

Real-time Communication: WebRTC (Peer-to-Peer)

Linting: ESLint

Dev Tools: HMR (Hot Module Replacement)

⚡ Vite + React Setup

This template provides a minimal setup to get React working in Vite with HMR and ESLint rules.

Official Plugins Used

@vitejs/plugin-react – Uses Babel (or oxc) for Fast Refresh

@vitejs/plugin-react-swc – Uses SWC for faster builds

ℹ️ React Compiler is not enabled due to its impact on dev and build performance.
See the official documentation if you want to enable it.

🎯 Project Features

Host creates a unique interview session

Candidate joins using the session ID

Peer-to-peer audio/video via WebRTC

Socket.IO server used only for:

Signaling

Session management

Waiting queue

No media server (SFU/TURN) → zero cost


🛠️ Quick Start
1️⃣ Install dependencies
npm install

2️⃣ npm run server


(new terminal)
3️⃣ npm run dev

🌐 Routes

/host → Create interview session

/join → Join as candidate using session ID

⚠️ Important Notes

Backend uses in-memory storage (no database)

Designed for learning & demo purposes only

For production:

Use TURN servers

Add authentication

Persist session data

Handle NAT / firewall issues

📌 Use Case

Perfect for:

Internship projects

WebRTC learning

Real-time system architecture demos

Low-cost interview platforms
=======
# Rohit-webRTC
>>>>>>> ff4524f4efbce16929c58533a399b876706e24a3
