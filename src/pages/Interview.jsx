import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import DebugPanel from '../components/DebugPanel';
import {
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  startTimer,
  stopTimer,
  downloadRecording,
  uploadRecordingToServer
} from '../utils/recordingUtils';

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

  // Media control state
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const navigate = useNavigate();

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState('00:00');
  const recordingCanvasRef = useRef(null);

  function stopLocalAndCleanup() {
    try { if (screenStream) screenStream.getTracks().forEach((t) => t.stop()); } catch (e) { }
    try { if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) { }
    try { if (pcRef.current) { pcRef.current.close(); pcRef.current = null; } } catch (e) { }
    setScreenSharing(false);
    setHostSharing(false);
    setLocalStream(null);
    localStreamRef.current = null;
    setPc(null);
  }

  useEffect(() => {
    const hostId = sessionStorage.getItem('hostId');
    if (!hostId) return navigate('/join');

    // Reset video refs when new interview starts
    if (hostVideoRef.current) hostVideoRef.current.srcObject = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    setHostSharing(false);

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
        peer.addTrack(t, stream);
      });
    }

    // Simple ontrack handler - attach immediately
    peer.ontrack = (ev) => {
      pushLog('=== ONTRACK EVENT RECEIVED ===');
      console.log('ontrack event:', ev);

      let stream = ev.streams && ev.streams[0];
      if (!stream) {
        pushLog('ontrack: No stream in event, creating new MediaStream');
        stream = new MediaStream();
        if (ev.track) stream.addTrack(ev.track);
      }

      const audioCount = stream.getAudioTracks().length;
      const videoCount = stream.getVideoTracks().length;
      pushLog('Candidate ontrack: audio=' + audioCount + ' video=' + videoCount + ' trackKind=' + ev.track.kind + ' trackId=' + ev.track.id + ' streamId=' + stream.id);

      // Simple heuristic: if no audio tracks, treat as screen share
      const isScreen = audioCount === 0 && videoCount > 0;
      pushLog('Candidate ontrack classification: isScreen=' + isScreen);
      pushLog('Current screenSharing state: ' + screenSharing);

      if (isScreen) {
        pushLog('Candidate: attaching to host screen element (no audio detected)');
        if (screenVideoRef.current) {
          pushLog('Candidate: screenVideoRef exists, setting srcObject');
          console.log('Setting screenVideoRef.current.srcObject to:', stream);
          screenVideoRef.current.srcObject = stream;
          screenVideoRef.current.play().catch(e => pushLog('Candidate screen play error: ' + e.message));
          screenVideoRef.current.style.display = 'block';
          pushLog('Candidate: screen element updated and playing');
        } else {
          pushLog('Candidate: ERROR - screenVideoRef is null!');
        }
      } else {
        pushLog('Candidate: attaching to host camera element (has audio or default)');
        if (hostVideoRef.current) {
          pushLog('Candidate: hostVideoRef exists, setting srcObject');
          console.log('Setting hostVideoRef.current.srcObject to:', stream);
          hostVideoRef.current.srcObject = stream;
          hostVideoRef.current.play().catch(e => pushLog('Host play error: ' + e.message));
          hostVideoRef.current.style.display = 'block';
          pushLog('Candidate: host camera element updated and playing');
        } else {
          pushLog('Candidate: ERROR - hostVideoRef is null!');
        }
      }

      remoteStreams.set(stream.id || ev.track.id, { type: isScreen ? 'screen' : 'camera', stream });
    };

    peer.oniceconnectionstatechange = () => {
      // Connection state changed
    };

    startLocal();

    // ICE candidate handling
    peer.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc_ice', { to: hostId, candidate: e.candidate });
      }
    };

    // receive answer
    socket.on('webrtc_answer', async ({ from, sdp }) => {
      pushLog('Candidate received answer from ' + from);
      try {
        await peer.setRemoteDescription(sdp);
        pushLog('Candidate set remote description after answer');
      } catch (err) {
        pushLog('Failed to set remote description on candidate: ' + err.message);
      }
    });

    // receive ICE from host
    socket.on('webrtc_ice', async ({ candidate }) => {
      try {
        await peer.addIceCandidate(candidate);
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
      pushLog('Offer SDP type: ' + sdp.type);
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
        pushLog('Candidate setting remote description (offer)');
        await peer.setRemoteDescription(sdp);
        pushLog('Candidate creating answer');
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        pushLog('Candidate senders after answer: ' + peer.getSenders().map((s) => s.track && s.track.kind + ':' + (s.track && s.track.id)).join(','));
        socket.emit('webrtc_answer', { to: from, sdp: answer });
        pushLog('Candidate sent answer to ' + from);
      } catch (err) {
        pushLog('Candidate failed to handle offer: ' + err.message);
      }
    });

    // Wait for host to be ready before creating offer. Host will emit 'host_ready'.
    socket.on('host_ready', ({ from }) => {
      createOffer();
    });

    // Fallback in case 'host_ready' is missed
    const fallbackOffer = setTimeout(() => {
      createOffer();
    }, 3000);

    socket.on('interview_ended', () => {
      // cleanup and go back
      stopLocalAndCleanup();
      navigate('/join');
    });

    return () => {
      clearTimeout(fallbackOffer);
      socket.off('webrtc_answer');
      socket.off('webrtc_offer');
      socket.off('webrtc_ice');
      socket.off('interview_ended');
      socket.off('host_ready');
      try { if (pcRef.current) { pcRef.current.close(); pcRef.current = null; } } catch (e) { }
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
    pushLog('toggleScreen called, screenSharing=' + screenSharing);
    console.log('toggleScreen: screenSharing state =', screenSharing);
    console.log('toggleScreen: hostVideoRef.current.srcObject =', hostVideoRef.current?.srcObject);
    console.log('toggleScreen: localVideoRef.current.srcObject =', localVideoRef.current?.srcObject);

    if (!pc) return pushLog('PC not ready for screen share');
    if (!screenSharing) {
      try {
        pushLog('Candidate starting screen share...');
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        pushLog('Display media obtained, setting state');
        setScreenStream(s);

        // Show screen locally immediately
        pushLog('Setting screenVideoRef.current.srcObject to display stream');
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = s;
          pushLog('screenVideoRef srcObject set, attempting to play');
          screenVideoRef.current.play().catch(e => pushLog('Local screen play error: ' + e.message));
          pushLog('Candidate displaying screen locally');
        } else {
          pushLog('ERROR: screenVideoRef.current is null!');
        }

        // Set screenSharing state immediately so layout changes
        pushLog('About to set screenSharing to true');
        setScreenSharing(true);
        pushLog('screenSharing state set to true, layout should change now');

        // Check if other refs still have streams after state change
        console.log('After setScreenSharing(true):');
        console.log('- hostVideoRef.current.srcObject =', hostVideoRef.current?.srcObject);
        console.log('- localVideoRef.current.srcObject =', localVideoRef.current?.srcObject);

        // add screen track as a separate sender so host can show camera + screen
        const screenTrack = s.getVideoTracks()[0];
        pushLog('Screen track obtained, adding to peer connection');
        const sender = pc.addTrack(screenTrack, s);
        screenSenderRef.current = sender;
        pushLog('Candidate added screen sender, creating negotiation offer');

        // Notify host that candidate started screen sharing (host must stop theirs)
        const hostId = sessionStorage.getItem('hostId');
        socket.emit('candidate_started_screen', { to: hostId });
        pushLog('Notified host that candidate started screen sharing');

        // Explicitly create and send offer for screen share (onnegotiationneeded may not fire reliably)
        try {
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure track is added
          pushLog('Candidate creating explicit offer after adding screen track');
          makingOffer.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_offer', { to: hostId, sdp: offer });
          pushLog('Candidate sent explicit offer for screen share');
          makingOffer.current = false;
        } catch (err) {
          pushLog('Candidate failed to send screen offer: ' + err.message);
          makingOffer.current = false;
        }

        screenTrack.onended = () => {
          pushLog('Candidate screen track ended');
          stopScreenSharing();
        };
      } catch (err) {
        pushLog('Could not start screen share: ' + (err.message || err));
      }
    } else {
      pushLog('Candidate stopping screen share');
      stopScreenSharing();
    }
  }
  function stopScreenSharing() {
    pushLog('stopScreenSharing called');
    if (!pc) return pushLog('PC not available for screen stop');
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
      pushLog('Cleared screenVideoRef srcObject');
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => {
        t.stop();
        pushLog('Stopped screen track');
      });
    }
    // remove the screen sender if present
    try {
      const sender = screenSenderRef.current;
      if (sender) {
        pc.removeTrack(sender);
        pushLog('Removed screen sender from peer connection');
        try { sender.track.stop(); } catch (e) { }
        screenSenderRef.current = null;
      }
    } catch (err) {
      pushLog('Failed to remove screen sender: ' + err.message);
    }

    // inform host explicitly that candidate stopped sharing
    try {
      const hostId = sessionStorage.getItem('hostId');
      socket.emit('candidate_stopped_screen', { to: hostId });
      pushLog('Candidate notified host that screen sharing stopped');
    } catch (e) {
      pushLog('Failed to notify host of screen stop: ' + (e.message || e));
    }

    // no need to revert camera since camera sender still exists
    setScreenStreamingFalse();
  }

  function setScreenStreamingFalse() {
    setScreenSharing(false);
    setScreenStream(null);
  }

  async function handleToggleRecording() {
    if (!isRecording) {
      try {
        setIsRecording(true);
        setIsRecordingPaused(false);
        pushLog('Starting video recording...');
        await startRecording(recordingCanvasRef.current, [localStreamRef.current?.getAudioTracks()[0]].filter(Boolean));
        startTimer(setRecordingTime);
      } catch (err) {
        pushLog('Failed to start recording: ' + err.message);
        setIsRecording(false);
      }
    } else {
      try {
        pushLog('Stopping video recording...');
        stopTimer();
        const { ok, blob } = await stopRecording();
        if (ok) {
          downloadRecording(blob, `candidate-interview-${Date.now()}.webm`);
          pushLog('Recording downloaded successfully');
        }
        setIsRecording(false);
        setIsRecordingPaused(false);
        setRecordingTime('00:00');
      } catch (err) {
        pushLog('Failed to stop recording: ' + err.message);
      }
    }
  }

  function handleTogglePauseRecording() {
    if (isRecordingPaused) {
      const { ok } = resumeRecording();
      if (ok) {
        setIsRecordingPaused(false);
        startTimer(setRecordingTime);
        pushLog('Recording resumed');
      }
    } else {
      const { ok } = pauseRecording();
      if (ok) {
        setIsRecordingPaused(true);
        stopTimer();
        pushLog('Recording paused');
      }
    }
  }

  async function handleUploadRecording() {
    try {
      if (isRecording) {
        pushLog('Please stop recording before uploading');
        return;
      }
      pushLog('Uploading recording to server...');
    } catch (err) {
      pushLog('Upload failed: ' + err.message);
    }
  }

  function toggleAudio() {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
        pushLog('Audio toggled: ' + audioTrack.enabled);
      }
    }
  }

  function toggleVideo() {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
        pushLog('Video toggled: ' + videoTrack.enabled);
      }
    }
  }

  useEffect(() => {
    if (recordingCanvasRef.current) {
      const canvas = recordingCanvasRef.current;
      // Larger canvas to match actual visual layout
      // Layout: 3 videos (320x240 each) side by side with 20px gap = 960 + 40 = 1000px wide, 240px high
      canvas.width = 1000;
      canvas.height = 280;
      const ctx = canvas.getContext('2d');

      const drawFrame = () => {
        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw local video at (0, 0)
        if (localVideoRef.current && localVideoRef.current.readyState === localVideoRef.current.HAVE_ENOUGH_DATA) {
          ctx.drawImage(localVideoRef.current, 0, 0, 320, 240);
        }

        // Draw host camera at (340, 0) [320 + 20 gap]
        if (hostVideoRef.current && hostVideoRef.current.readyState === hostVideoRef.current.HAVE_ENOUGH_DATA) {
          ctx.drawImage(hostVideoRef.current, 340, 0, 320, 240);
        }

        // Draw host screen at (680, 0) [320 + 20 + 320 + 20]
        if (screenVideoRef.current && screenVideoRef.current.readyState === screenVideoRef.current.HAVE_ENOUGH_DATA) {
          ctx.drawImage(screenVideoRef.current, 680, 0, 320, 240);
        }
      };

      const interval = setInterval(drawFrame, 33);
      return () => clearInterval(interval);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (isRecording) {
        stopTimer();
      }
    };
  }, [isRecording]);

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1a1a1a', margin: 0, padding: 0, boxSizing: 'border-box', overflowX: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 15px', borderBottom: '1px solid #333', flexShrink: 0, boxSizing: 'border-box', width: '100%' }}>
        <h2 style={{ color: '#fff', margin: 0, fontSize: '18px' }}>Interview</h2>
      </div>

      {/* Main Video Area - Takes most of the space */}
      <div style={{ flex: 1, display: 'flex', gap: 10, padding: 10, position: 'relative', overflow: 'hidden', minHeight: 0, boxSizing: 'border-box', width: '100%' }}>
        {/* All video elements always in DOM - layout changes via CSS */}

        {/* Screen Share Container - shows when screenSharing is true */}
        <div style={{
          flex: screenSharing ? 1 : 'none',
          display: screenSharing ? 'flex' : 'none',
          background: '#000',
          borderRadius: '8px',
          overflow: 'hidden',
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0
        }}>
          <video ref={screenVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <span style={{ position: 'absolute', bottom: 10, left: 10, color: '#fff', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '5px 10px', borderRadius: '4px' }}>Your Screen</span>
        </div>

        {/* Main Video Container - changes layout based on screenSharing state */}
        <div style={{
          display: 'flex',
          flexDirection: screenSharing ? 'column' : 'column',
          gap: 15,
          flex: screenSharing ? '0 0 200px' : 1,
          minWidth: 0,
          minHeight: 0
        }}>
          {/* Host Camera */}
          <div style={{
            flex: screenSharing ? '0 0 150px' : 1,
            background: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 0
          }}>
            <video ref={hostVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <span style={{ position: 'absolute', bottom: 10, left: 10, color: '#fff', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '5px 10px', borderRadius: '4px' }}>Host Camera</span>
          </div>

          {/* Your Camera */}
          <div style={{
            flex: '0 0 100px',
            width: '100%',
            background: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <span style={{ position: 'absolute', bottom: 5, left: 5, color: '#fff', fontSize: '10px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '3px 8px', borderRadius: '3px' }}>You</span>
          </div>
        </div>
      </div>

      {/* Bottom Control Bar */}
      <div style={{ padding: '10px 15px', borderTop: '1px solid #333', backgroundColor: '#0d0d0d', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0, boxSizing: 'border-box', width: '100%' }}>
        <button style={{ backgroundColor: '#f44336', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={() => { stopLocalAndCleanup(); socket.emit('end_interview_now'); navigate('/join'); }}>End Interview</button>
        <button style={{ backgroundColor: audioEnabled ? '#4CAF50' : '#f44336', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={toggleAudio}>{audioEnabled ? 'Mic On' : 'Mic Off'}</button>
        <button style={{ backgroundColor: videoEnabled ? '#4CAF50' : '#f44336', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={toggleVideo}>{videoEnabled ? 'Cam On' : 'Cam Off'}</button>
        <button style={{ backgroundColor: screenSharing ? 'green' : '#666', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={toggleScreen}>{screenSharing ? 'Stop Screen' : 'Share Screen'}</button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={{ backgroundColor: isRecording ? 'red' : '#ccc', color: isRecording ? 'white' : 'black', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={handleToggleRecording}>{isRecording ? `Rec (${recordingTime})` : 'Record'}</button>
          {isRecording && <button style={{ backgroundColor: isRecordingPaused ? 'orange' : 'blue', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={handleTogglePauseRecording}>{isRecordingPaused ? 'Resume' : 'Pause'}</button>}
          <button style={{ backgroundColor: '#4CAF50', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={handleUploadRecording}>Upload</button>
        </div>
      </div>

      <canvas ref={recordingCanvasRef} style={{ display: 'none', width: 1000, height: 280 }} />
    </div>
  );
}
