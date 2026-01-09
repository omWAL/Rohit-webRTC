import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import DebugPanel from '../components/DebugPanel';

export default function Interview() {
  const localVideoRef = useRef();
  const hostVideoRef = useRef();
  const screenVideoRef = useRef();
  const [pc, setPc] = useState(null);
  const pcRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const localStreamRef = useRef(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [hostSharing, setHostSharing] = useState(false);
  const navigate = useNavigate();

  function stopLocalAndCleanup() {
    try { if (screenStream) screenStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (pcRef.current) { pcRef.current.close(); pcRef.current = null; } } catch (e) {}
    setScreenSharing(false);
    setHostSharing(false);
    setLocalStream(null);
    localStreamRef.current = null;
    setPc(null);
  }

  useEffect(() => {
    const hostId = sessionStorage.getItem('hostId');
    if (!hostId) return navigate('/join');

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    setPc(peer);
    pcRef.current = peer;

    // send local tracks
    async function startLocal() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      stream.getTracks().forEach((t) => {
        console.log('Adding local track', t.kind, t.label);
        peer.addTrack(t, stream);
      });
    }

    // remote stream handling: if host sends one or multiple streams, attach appropriately
    const remoteStreams = new Map();

    // buffered ontrack handling to avoid misclassification when tracks arrive before settings are available
    const incomingStreams = new Map();
    let resolveTimer = null;
    function scheduleResolveIncoming() {
      if (resolveTimer) return;
      resolveTimer = setTimeout(() => {
        resolveTimer = null;
        // classify and attach
        for (const [key, s] of incomingStreams.entries()) {
          const stream = s.stream;
          const videoTrack = stream.getVideoTracks()[0];
          const settings = videoTrack && videoTrack.getSettings ? videoTrack.getSettings() : {};

          // detect screen via explicit signal first (helps when label/settings aren't available),
          // then fall back to displaySurface, label heuristics, then resolution
          let isScreen = false;
          if (expectScreenRef.current) {
            isScreen = true;
            expectScreenRef.current = false;
            pushLog('Using signal to classify as screen');
          } else if (settings.displaySurface && settings.displaySurface !== 'none') {
            isScreen = true;
          } else {
            const label = (videoTrack && videoTrack.label) ? videoTrack.label.toLowerCase() : '';
            if (/screen|display|window|monitor|sharing/i.test(label)) isScreen = true;
            else if (settings.width && settings.height) {
              if (settings.width >= 1280 || settings.height >= 720) isScreen = true;
            }
          }

          const id = stream.id || (videoTrack && videoTrack.id) || key;
          pushLog('Resolving incoming stream ' + id + ' isScreen=' + isScreen);

          if (isScreen) {
            screenVideoRef.current.srcObject = stream;
            pushLog('Attached host screen stream to screenVideoRef ' + id);
            remoteStreams.set(id, stream);
            setHostSharing(true);
            try { if (videoTrack) videoTrack.onended = () => setHostSharing(false); } catch (e) {}
          } else {
            // camera
            if (!hostVideoRef.current.srcObject) {
              hostVideoRef.current.srcObject = stream;
              pushLog('Attached host camera stream ' + id);
            } else {
              // prefer keeping existing camera; if none, set
              hostVideoRef.current.srcObject = stream;
              pushLog('Replaced host camera stream ' + id);
            }
            remoteStreams.set(id, stream);
            try { if (videoTrack) videoTrack.onended = () => { hostVideoRef.current.srcObject = null; pushLog('Host camera track ended'); }; } catch (e) {}
          }

          incomingStreams.delete(key);
        }
      }, 200);
    }

    peer.ontrack = (ev) => {
      console.log('Candidate got ontrack (buffered)', ev);
      let stream = ev.streams && ev.streams[0];
      if (!stream) {
        stream = new MediaStream();
        if (ev.track) stream.addTrack(ev.track);
      }
      const key = Date.now() + Math.random();
      incomingStreams.set(key, { stream });
      scheduleResolveIncoming();
    };

    peer.oniceconnectionstatechange = () => {
      console.log('Candidate pc state', peer.connectionState, peer.iceConnectionState);
    };

    startLocal();

    // ICE candidate handling
    peer.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('Candidate sending ICE to host', hostId, e.candidate);
        socket.emit('webrtc_ice', { to: hostId, candidate: e.candidate });
      }
    };

    // receive answer
    socket.on('webrtc_answer', async ({ from, sdp }) => {
      pushLog('Candidate received answer from ' + from);
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        pushLog('Candidate set remote description after answer');
      } catch (err) {
        pushLog('Failed to set remote description on candidate: ' + err.message);
      }
    });

    // receive offer (host may initiate renegotiation for screen or other tracks)
    socket.on('webrtc_offer', async ({ from, sdp }) => {
      console.log('Candidate received offer from', from);
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: from, sdp: answer });
        console.log('Candidate sent answer to', from);
      } catch (err) {
        console.error('Candidate failed to handle offer', err);
      }
    });

    // receive ICE from host
    socket.on('webrtc_ice', async ({ candidate }) => {
      console.log('Candidate received ICE', candidate);
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Failed to add ICE candidate', err);
      }
    });

    // Negotiation management (polite peer) to handle glare
    const makingOffer = { current: false };
    const ignoreOffer = { current: false };
    const polite = false; // candidate is impolite in this simple scheme

    peer.onnegotiationneeded = async () => {
      try {
        pushLog('Candidate negotiationneeded - creating offer');
        makingOffer.current = true;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        // log senders
        pushLog('Candidate senders: ' + peer.getSenders().map((s) => s.track && s.track.id).join(','));
        socket.emit('webrtc_offer', { to: hostId, sdp: offer });
      } catch (err) {
        console.error('Candidate negotiation failed', err);
      } finally {
        makingOffer.current = false;
      }
    };

    // create offer to host (initial)
    async function createOffer() {
      try {
        pushLog('Candidate creating offer to host ' + hostId);
        makingOffer.current = true;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        pushLog('Candidate senders (createOffer): ' + peer.getSenders().map((s) => s.track && s.track.id).join(','));
        socket.emit('webrtc_offer', { to: hostId, sdp: offer });
      } catch (err) {
        pushLog('Candidate createOffer failed: ' + err.message);
      } finally {
        makingOffer.current = false;
      }
    }

    // handle incoming offers with polite check
    socket.on('webrtc_offer', async ({ from, sdp }) => {
      pushLog('Candidate received offer from ' + from);
      const offer = new RTCSessionDescription(sdp);
      const readyForOffer = !makingOffer.current && (peer.signalingState === 'stable');
      const offerCollision = !readyForOffer;
      if (offerCollision) {
        pushLog('Candidate detected offer collision, polite=' + polite);
      }
      if (offerCollision && !polite) {
        pushLog('Candidate ignoring offer due to collision');
        return;
      }
      try {
        await peer.setRemoteDescription(offer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: from, sdp: answer });
        pushLog('Candidate sent answer to ' + from);
      } catch (err) {
        pushLog('Candidate failed to handle offer: ' + err.message);
      }
    });

    // Wait for host to be ready before creating offer. Host will emit 'host_ready'.
    socket.on('host_ready', ({ from }) => {
      console.log('Candidate received host_ready from', from);
      createOffer();
    });

    // Listen for explicit screen-share signals from host to help classification
    const expectScreenRef = { current: false };
    socket.on('screen_share_started', ({ from }) => {
      pushLog('Candidate received screen_share_started signal from ' + from);
      expectScreenRef.current = true;
      setHostSharing(true);
    });
    socket.on('screen_share_stopped', ({ from }) => {
      pushLog('Candidate received screen_share_stopped signal from ' + from);
      expectScreenRef.current = false;
      setHostSharing(false);
    });

    // Fallback in case 'host_ready' is missed
    const fallbackOffer = setTimeout(() => {
      console.warn('Fallback: creating offer after timeout');
      createOffer();
    }, 3000);

    socket.on('interview_ended', () => {
      // cleanup and go back
      stopLocalAndCleanup();
      navigate('/join');
    });

    return () => {
      clearTimeout(fallbackOffer);
      try { if (resolveTimer) clearTimeout(resolveTimer); } catch (e) {}
      socket.off('webrtc_answer');
      socket.off('webrtc_offer');
      socket.off('webrtc_ice');
      socket.off('interview_ended');
      socket.off('host_ready');
      socket.off('screen_share_started');
      socket.off('screen_share_stopped');
      try { if (pcRef.current) { pcRef.current.close(); pcRef.current = null; } } catch (e) {}
    };
  }, []);

  // keep reference to the sender used for screen sharing so we can remove it later
  const screenSenderRef = useRef(null);
  const [logs, setLogs] = useState([]);
  function pushLog(msg) {
    setLogs((s) => [...s, `${new Date().toLocaleTimeString()} - ${msg}`]);
    console.log(msg);
  }

  async function toggleScreen() {
    if (!pc) return pushLog('PC not ready for screen share');
    if (!screenSharing) {
      try {
        pushLog('Candidate starting screen share...');
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(s);
        // add screen track as a separate sender so host can show camera + screen
        const screenTrack = s.getVideoTracks()[0];
        const sender = pc.addTrack(screenTrack, s);
        screenSenderRef.current = sender;
        pushLog('Candidate added screen sender, forcing negotiation to host');

        // inform host explicitly that candidate started sharing (helps host classify)
        const hostId = sessionStorage.getItem('hostId');
        socket.emit('screen_share_started', { to: hostId });

        // ensure renegotiation: create offer and send to host
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_offer', { to: hostId, sdp: offer });
          pushLog('Candidate sent offer after adding screen');
        } catch (err) {
          pushLog('Candidate failed to send offer after adding screen: ' + (err.message || err));
        }

        screenTrack.onended = () => {
          pushLog('Candidate screen track ended');
          stopScreenSharing();
        };

        setScreenSharing(true);
      } catch (err) {
        pushLog('Could not start screen share: ' + (err.message || err));
      }
    } else {
      pushLog('Candidate stopping screen share');
      stopScreenSharing();
      // renegotiate to remove screen
      try {
        const hostId = sessionStorage.getItem('hostId');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', { to: hostId, sdp: offer });
        pushLog('Candidate sent offer after stopping screen');
      } catch (err) {
        pushLog('Candidate failed to send offer after stopping screen: ' + (err.message || err));
      }
    }
  }
  function stopScreenSharing() {
    if (!pc) return;
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    // remove the screen sender if present
    try {
      const sender = screenSenderRef.current;
      if (sender) {
        pc.removeTrack(sender);
        try { sender.track.stop(); } catch (e) {}
        screenSenderRef.current = null;
      }
    } catch (err) {
      console.warn('Failed to remove screen sender', err);
    }

    // inform host explicitly that candidate stopped sharing
    try {
      const hostId = sessionStorage.getItem('hostId');
      socket.emit('screen_share_stopped', { to: hostId });
    } catch (e) {}

    // no need to revert camera since camera sender still exists
    setScreenStreamingFalse();
  }

  function setScreenStreamingFalse() {
    setScreenSharing(false);
    setScreenStream(null);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Interview (Candidate)</h2>
      <div style={{ display: 'flex', gap: 20 }}>
        <div>
          <h3>Your camera</h3>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: 320, height: 240, background: '#000' }} />
        </div>
        <div>
          <h3>Host camera</h3>
          <video ref={hostVideoRef} autoPlay playsInline style={{ width: 320, height: 240, background: '#000' }} />
        </div>
        <div>
          <h3>Host screen</h3>
          <video ref={screenVideoRef} autoPlay playsInline style={{ width: 320, height: 240, background: '#000' }} />
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <button onClick={toggleScreen} style={{ backgroundColor: screenSharing ? 'green' : undefined }}>{screenSharing ? 'Stop Screen Share' : 'Share Screen'}</button>
      </div>

      <DebugPanel logs={logs} />
    </div>
  );
}
