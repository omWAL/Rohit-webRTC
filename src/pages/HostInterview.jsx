import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import DebugPanel from '../components/DebugPanel';

export default function HostInterview() {
  const localVideoRef = useRef();
  const candidateVideoRef = useRef();
  const screenVideoRef = useRef();
  const [pc, setPc] = useState(null);
  const pcRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const localStreamRef = useRef(null);
  const [hostSharing, setHostSharing] = useState(false);
  const hostScreenRef = useRef({ sender: null, stream: null });
  const navigate = useNavigate();

  function stopLocalAndCleanup() {
    try {
      if (hostScreenRef.current && hostScreenRef.current.stream) hostScreenRef.current.stream.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    try {
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    } catch (e) {}
    setHostSharing(false);
    setLocalStream(null);
    localStreamRef.current = null;
    setPc(null);
  }

  // debug logs for UI
  const [logs, setLogs] = React.useState([]);
  function pushLog(msg) {
    setLogs((s) => [...s, `${new Date().toLocaleTimeString()} - ${msg}`]);
    console.log(msg);
  }

  // toggle host screen sharing (adds/removes display track and forces negotiation)
  async function toggleHostScreen() {
    if (!pc) return pushLog('PC not ready');
    const candidate = sessionStorage.getItem('activeCandidate');
    try {
      if (!hostScreenRef.current.stream) {
        pushLog('Starting host screen share...');
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
        hostScreenRef.current.stream = s;
        const track = s.getVideoTracks()[0];
        const sender = pc.addTrack(track, s);
        hostScreenRef.current.sender = sender;
        setHostSharing(true);
        pushLog('Host added screen track, forcing offer to candidate ' + candidate);

        // ensure negotiation: create offer and send to candidate
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_offer', { to: candidate, sdp: offer });
          pushLog('Host sent offer for screen to candidate');
          // notify candidate explicitly that a screen share started (helps with classification)
          socket.emit('screen_share_started', { to: candidate });
        } catch (err) {
          pushLog('Host failed to create/send offer for screen: ' + err.message);
        }

        track.onended = async () => {
          pushLog('Host screen track ended');
          try { if (hostScreenRef.current.sender) pc.removeTrack(hostScreenRef.current.sender); } catch(e) {}
          hostScreenRef.current.sender = null;
          hostScreenRef.current.stream = null;
          setHostSharing(false);
          // notify candidate that screen stopped
          try { socket.emit('screen_share_stopped', { to: candidate }); } catch(e) {}
          // renegotiate to remove track
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('webrtc_offer', { to: candidate, sdp: offer });
            pushLog('Host sent offer after stopping screen');
          } catch (err) {
            pushLog('Host failed renegotiation after stopping screen: ' + err.message);
          }
        };
      } else {
        pushLog('Stopping host screen share...');
        hostScreenRef.current.stream.getTracks().forEach((t) => t.stop());
        if (hostScreenRef.current.sender) try { pc.removeTrack(hostScreenRef.current.sender); } catch (e) {}
        hostScreenRef.current.sender = null;
        hostScreenRef.current.stream = null;
        setHostSharing(false);

        // notify candidate that screen stopped
        try { socket.emit('screen_share_stopped', { to: candidate }); } catch(e) {}

        // create offer to renegotiate without screen
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_offer', { to: candidate, sdp: offer });
          pushLog('Host sent offer after stopping screen (manual)');
        } catch (err) {
          pushLog('Host failed to send offer after stopping screen: ' + err.message);
        }
      }
    } catch (err) {
      pushLog('Host screen share failed: ' + err.message);
    }
  }

  useEffect(() => {
    const session = sessionStorage.getItem('hostSession');
    const candidate = sessionStorage.getItem('activeCandidate');
    if (!session || !candidate) return navigate('/host');

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    setPc(peer);
    pcRef.current = peer;

    async function startLocal() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((t) => {
        console.log('Host adding local track', t.kind, t.label);
        peer.addTrack(t, stream);
      });
    }



    startLocal().then(() => {
      console.log('Host local started, notifying candidate', candidate);
      socket.emit('host_ready', { to: candidate });
    }).catch((err) => console.error('Host failed to start local stream', err));

    // Keep track of remote streams
    const remoteStreams = new Map();

    // Negotiation management (polite peer) to handle glare
    const makingOfferHost = { current: false };
    const politeHost = true; // host will be polite

    peer.onnegotiationneeded = async () => {
      try {
        pushLog('Host negotiationneeded - creating offer');
        makingOfferHost.current = true;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        pushLog('Host senders: ' + peer.getSenders().map((s) => s.track && s.track.id).join(','));
        socket.emit('webrtc_offer', { to: candidate, sdp: offer });
      } catch (err) {
        pushLog('Host negotiation failed: ' + err.message);
      } finally {
        makingOfferHost.current = false;
      }
    };

    // handle answers to host-initiated offers
    socket.on('webrtc_answer', async ({ from, sdp }) => {
      pushLog('Host received answer from ' + from);
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        pushLog('Host set remote description after answer');
      } catch (err) {
        pushLog('Host failed to set remote description: ' + err.message);
      }
    });

    // handle incoming offers with polite collision handling
    socket.on('webrtc_offer', async ({ from, sdp }) => {
      pushLog('Host received offer from ' + from);
      const offer = new RTCSessionDescription(sdp);
      const readyForOffer = !makingOfferHost.current && (peer.signalingState === 'stable');
      const offerCollision = !readyForOffer;
      if (offerCollision) pushLog('Host detected offer collision, polite=' + politeHost);
      if (offerCollision && !politeHost) {
        pushLog('Host ignoring offer due to collision');
        return;
      }
      try {
        await peer.setRemoteDescription(offer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: from, sdp: answer });
        pushLog('Host sent answer to ' + from);
      } catch (err) {
        pushLog('Host failed to handle offer: ' + err.message);
      }
    });

    // buffered ontrack handling for host to avoid misclassification
    const incomingStreamsHost = new Map();
    let resolveTimerHost = null;
    const expectScreenHostRef = { current: false };

    // listen for candidate screen signals
    socket.on('screen_share_started', ({ from }) => {
      pushLog('Host received screen_share_started signal from ' + from);
      expectScreenHostRef.current = true;
    });
    socket.on('screen_share_stopped', ({ from }) => {
      pushLog('Host received screen_share_stopped signal from ' + from);
      expectScreenHostRef.current = false;
    });

    function scheduleResolveIncomingHost() {
      if (resolveTimerHost) return;
      resolveTimerHost = setTimeout(() => {
        resolveTimerHost = null;
        for (const [key, s] of incomingStreamsHost.entries()) {
          const stream = s.stream;
          const videoTrack = stream.getVideoTracks()[0];
          const settings = videoTrack && videoTrack.getSettings ? videoTrack.getSettings() : {};

          // detect screen via explicit signal first, then displaySurface, label heuristics,
          // then resolution, and as a practical heuristic treat video-without-audio as screen
          const audioCount = stream.getAudioTracks().length;
          const videoCount = stream.getVideoTracks().length;
          pushLog('Host incoming stream tracks audio=' + audioCount + ' video=' + videoCount + ' settings=' + JSON.stringify({ width: settings.width, height: settings.height, displaySurface: settings.displaySurface }));

          let isScreen = false;
          if (expectScreenHostRef.current) {
            isScreen = true;
            expectScreenHostRef.current = false;
            pushLog('Host using signal to classify as screen');
          } else if (settings.displaySurface && settings.displaySurface !== 'none') {
            isScreen = true;
          } else if (videoCount > 0 && audioCount === 0) {
            // common case: screen tracks often arrive without an audio track
            isScreen = true;
            pushLog('Host classifying as screen because video present but no audio');
          } else {
            const label = (videoTrack && videoTrack.label) ? videoTrack.label.toLowerCase() : '';
            if (/screen|display|window|monitor|sharing/i.test(label)) isScreen = true;
            else if (settings.width && settings.height) {
              if (settings.width >= 1280 || settings.height >= 720) isScreen = true;
            }
          }

          const id = stream.id || (videoTrack && videoTrack.id) || key;
          pushLog('Host resolving incoming stream ' + id + ' isScreen=' + isScreen);

          // if it's screen, attach to screenVideoRef
          if (isScreen) {
            remoteStreams.set(id, { type: 'screen', stream });
            if (screenVideoRef.current) screenVideoRef.current.srcObject = stream;
            pushLog('Attached candidate screen stream ' + id);
            try { if (videoTrack) videoTrack.onended = () => setHostSharing(false); } catch (e) {}
          } else {
            remoteStreams.set(id, { type: 'camera', stream });
            if (candidateVideoRef.current) candidateVideoRef.current.srcObject = stream;
            pushLog('Attached candidate camera stream ' + id);
          }

          incomingStreamsHost.delete(key);
        }
      }, 200);
    }

    peer.ontrack = (ev) => {
      console.log('Host got ontrack (buffered)', ev);
      let stream = ev.streams && ev.streams[0];
      if (!stream) {
        stream = new MediaStream();
        if (ev.track) stream.addTrack(ev.track);
      }
      const key = Date.now() + Math.random();
      incomingStreamsHost.set(key, { stream });
      scheduleResolveIncomingHost();
    };

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('Host sending ICE to candidate', candidate, e.candidate);
        socket.emit('webrtc_ice', { to: candidate, candidate: e.candidate });
      }
    };

    // when an offer arrives
    socket.on('webrtc_offer', async ({ from, sdp }) => {
      console.log('Host received offer from', from);
      if (from !== candidate) return; // ignore other offers
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: from, sdp: answer });
        console.log('Host sent answer to', from);
      } catch (err) {
        console.error('Host failed to handle offer', err);
      }
    });

    socket.on('webrtc_ice', async ({ candidate: c, from }) => {
      console.log('Host received ICE from', from, c);
      try {
        await peer.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn('Failed to add ICE candidate', err);
      }
    });

    socket.on('interview_ended_host', () => {
      // cleanup
      stopLocalAndCleanup();
      sessionStorage.removeItem('activeCandidate');
      navigate('/host');
    });

    return () => {
      try { if (resolveTimerHost) clearTimeout(resolveTimerHost); } catch (e) {}
      socket.off('webrtc_offer');
      socket.off('webrtc_ice');
      socket.off('webrtc_answer');
      socket.off('interview_ended_host');
      socket.off('screen_share_started');
      socket.off('screen_share_stopped');
      try {
        if (hostScreenRef && hostScreenRef.current && hostScreenRef.current.stream) hostScreenRef.current.stream.getTracks().forEach((t) => t.stop());
      } catch (e) {}
      if (peer && peer.connectionState !== 'closed') peer.close();
    };
  }, []);

  function endInterview() {
    const code = sessionStorage.getItem('hostSession');
    console.log('Host clicked End Interview, code=', code);
    // perform immediate local cleanup to stop camera immediately
    stopLocalAndCleanup();

    if (code) {
      socket.emit('end_interview', { code }, (res) => {
        // no callback on server currently, but keep for future
        console.log('end_interview ack', res);
      });
    } else {
      // fallback
      socket.emit('end_interview_now');
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Host Interview</h2>
      <div style={{ display: 'flex', gap: 20 }}>
        <div>
          <h3>Your camera</h3>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: 320, height: 240, background: '#000' }} />
        </div>
        <div>
          <h3>Candidate camera</h3>
          <video ref={candidateVideoRef} autoPlay playsInline style={{ width: 320, height: 240, background: '#000' }} />
        </div>
        <div>
          <h3>Candidate screen</h3>
          <video ref={screenVideoRef} autoPlay playsInline style={{ width: 320, height: 240, background: '#000' }} />
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <button onClick={endInterview}>End Interview</button>
        <button
          style={{ marginLeft: 10, backgroundColor: hostSharing ? 'green' : undefined }}
          onClick={toggleHostScreen}
        >{hostSharing ? 'Stop Screen' : 'Share Screen'}</button>
        <button style={{ marginLeft: 10 }} onClick={() => {
          const code = sessionStorage.getItem('hostSession');
          if (code) socket.emit('start_next', { code });
        }}>Start Next</button>
      </div>

      <DebugPanel logs={logs} />
    </div>
  );
}
