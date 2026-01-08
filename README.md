# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

---

## Simple Interview System (added)

This repository has been extended with a minimal online interview system using Socket.IO and WebRTC.

Quick start:

1. Install dependencies:

   npm install

2. Start the backend server:

   npm run server

3. Start the frontend (in a different terminal):

   npm run dev

Open `/host` to create a session and `/join` to join as a candidate.

Notes:
- The backend is an in-memory Socket.IO server located at `index.js`.
- The frontend pages are in `src/pages/` and the Socket client is `src/socket.js`.
- This is a demo: use real TURN servers and persistence for production.
