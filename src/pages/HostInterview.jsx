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

export default function HostInterview() {
  const localVideoRef = useRef();
  const candidateVideoRef = useRef();
  const screenVideoRef = useRef();
  const [pc, setPc] = useState(null);
  const pcRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const localStreamRef = useRef(null);
  const navigate = useNavigate();

  // Media control state
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  // Track current candidate ID to trigger effect re-runs on switch
  const [candidateId, setCandidateId] = useState(sessionStorage.getItem('activeCandidate'));

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState('00:00');
  const recordingCanvasRef = useRef(null);

  // Screen sharing state
  const [candidateScreenActive, setCandidateScreenActive] = useState(false);

  function stopLocalAndCleanup() {
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
    } catch (e) { }
    try {
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    } catch (e) { }
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
          downloadRecording(blob, `host-interview-${Date.now()}.webm`);
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

        // Draw candidate camera at (340, 0) [320 + 20 gap]
        if (candidateVideoRef.current && candidateVideoRef.current.readyState === candidateVideoRef.current.HAVE_ENOUGH_DATA) {
          ctx.drawImage(candidateVideoRef.current, 340, 0, 320, 240);
        }

        // Draw candidate screen at (680, 0) [320 + 20 + 320 + 20]
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

  useEffect(() => {
    const session = sessionStorage.getItem('hostSession');
    // use state instead of reading storage again to ensure consistency with effect dependency
    if (!session || !candidateId) return navigate('/host');

    // Reset video refs when candidate changes
    if (candidateVideoRef.current) candidateVideoRef.current.srcObject = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;

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
        peer.addTrack(t, stream);
      });
    }



    startLocal().then(() => {
      socket.emit('host_ready', { to: candidateId });
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
        socket.emit('webrtc_offer', { to: candidateId, sdp: offer });
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
        await peer.setRemoteDescription(sdp);
        pushLog('Host set remote description after answer');
      } catch (err) {
        pushLog('Host failed to set remote description: ' + err.message);
      }
    });

    // handle incoming offers with polite collision handling
    socket.on('webrtc_offer', async ({ from, sdp }) => {
      pushLog('Host received offer from ' + from);
      pushLog('Offer SDP type: ' + sdp.type);
      const readyForOffer = !makingOfferHost.current && (peer.signalingState === 'stable');
      const offerCollision = !readyForOffer;
      if (offerCollision) pushLog('Host detected offer collision, polite=' + politeHost);
      if (offerCollision && !politeHost) {
        pushLog('Host ignoring offer due to collision');
        return;
      }
      try {
        pushLog('Host setting remote description (offer)');
        await peer.setRemoteDescription(sdp);
        pushLog('Host creating answer');
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        pushLog('Host senders after answer: ' + peer.getSenders().map((s) => s.track && s.track.kind + ':' + (s.track && s.track.id)).join(','));
        socket.emit('webrtc_answer', { to: from, sdp: answer });
        pushLog('Host sent answer to ' + from);
      } catch (err) {
        pushLog('Host failed to handle offer: ' + err.message);
      }
    });

    // Simple ontrack handler - attach immediately
    peer.ontrack = (ev) => {
      let stream = ev.streams && ev.streams[0];
      if (!stream) {
        stream = new MediaStream();
        if (ev.track) stream.addTrack(ev.track);
      }

      const audioCount = stream.getAudioTracks().length;
      const videoCount = stream.getVideoTracks().length;
      pushLog('Host ontrack: audio=' + audioCount + ' video=' + videoCount + ' trackKind=' + ev.track.kind + ' trackId=' + ev.track.id + ' streamId=' + stream.id);

      // Simple heuristic: if no audio tracks, treat as screen share
      const isScreen = audioCount === 0 && videoCount > 0;
      pushLog('Host ontrack classification: isScreen=' + isScreen);

      if (isScreen) {
        pushLog('Host: attaching to screen share element (no audio detected)');
        if (screenVideoRef.current) {
          pushLog('Host: screenVideoRef exists, setting srcObject');
          screenVideoRef.current.srcObject = stream;
          screenVideoRef.current.play().catch(e => pushLog('Host screen play error: ' + e.message));
          screenVideoRef.current.style.display = 'block';
          pushLog('Host: screen element updated and playing');
          setCandidateScreenActive(true);
          pushLog('Host: candidateScreenActive set to true, triggering re-render');

          // Handle when screen track ends
          ev.track.onended = () => {
            pushLog('Host: screen track ended');
            if (screenVideoRef.current) {
              screenVideoRef.current.srcObject = null;
            }
            setCandidateScreenActive(false);
            pushLog('Host: screen sharing stopped (track ended)');
          };
        } else {
          pushLog('Host: ERROR - screenVideoRef is null!');
        }
      } else {
        pushLog('Host: attaching to candidate camera element (has audio or default)');
        if (candidateVideoRef.current) {
          candidateVideoRef.current.srcObject = stream;
          candidateVideoRef.current.play().catch(e => pushLog('Candidate play error: ' + e.message));
          candidateVideoRef.current.style.display = 'block';
        }
      }

      remoteStreams.set(stream.id || ev.track.id, { type: isScreen ? 'screen' : 'camera', stream });
    };

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc_ice', { to: candidateId, candidate: e.candidate });
      }
    };

    socket.on('webrtc_ice', async ({ candidate: c, from }) => {
      try {
        if (c) {
          await peer.addIceCandidate(c);
        }
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

    socket.on('candidate_stopped_screen', () => {
      pushLog('Host received: candidate stopped screen sharing');
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
      setCandidateScreenActive(false);
      pushLog('Host: candidateScreenActive set to false');
    });

    // Handle switching to next candidate
    socket.on('candidate_selected', ({ candidate: newCandidateId }) => {
      pushLog('Host received new candidate: ' + newCandidateId);
      sessionStorage.setItem('activeCandidate', newCandidateId);
      setCandidateId(newCandidateId); // This will trigger re-run of this effect
    });

    return () => {
      socket.off('webrtc_offer');
      socket.off('webrtc_ice');
      socket.off('webrtc_answer');
      socket.off('interview_ended_host');
      socket.off('candidate_stopped_screen');
      socket.off('candidate_selected');
      if (peer && peer.connectionState !== 'closed') peer.close();
    };
  }, [candidateId]);

  function endInterview() {
    const code = sessionStorage.getItem('hostSession');
    // perform immediate local cleanup to stop camera immediately
    stopLocalAndCleanup();

    if (code) {
      socket.emit('end_interview', { code }, (res) => {
        // no callback on server currently, but keep for future
      });
    } else {
      // fallback
      socket.emit('end_interview_now');
    }
  }

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1a1a1a', margin: 0, padding: 0, boxSizing: 'border-box', overflowX: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 15px', borderBottom: '1px solid #333', flexShrink: 0, boxSizing: 'border-box', width: '100%' }}>
        <h2 style={{ color: '#fff', margin: 0, fontSize: '18px' }}>Host Interview</h2>
      </div>

      {/* Main Video Area - Takes most of the space */}
      <div style={{ flex: 1, display: 'flex', gap: 10, padding: 10, position: 'relative', overflow: 'hidden', minHeight: 0, boxSizing: 'border-box', width: '100%' }}>
        {/* All video elements always in DOM - layout changes via CSS */}

        {/* Candidate Screen Share Container - shows when candidate shares screen */}
        <div style={{
          flex: candidateScreenActive ? 1 : 'none',
          display: candidateScreenActive ? 'flex' : 'none',
          background: '#000',
          borderRadius: '8px',
          overflow: 'hidden',
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0
        }}>
          <video ref={screenVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <span style={{ position: 'absolute', bottom: 10, left: 10, color: '#fff', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '5px 10px', borderRadius: '4px' }}>Candidate Screen</span>
        </div>

        {/* Main Video Container - changes layout based on screen share state */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 15,
          flex: candidateScreenActive ? '0 0 200px' : 1,
          minWidth: 0,
          minHeight: 0
        }}>
          {/* Candidate Camera */}
          <div style={{
            flex: candidateScreenActive ? '0 0 150px' : 1,
            background: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 0
          }}>
            <video ref={candidateVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <span style={{ position: 'absolute', bottom: 10, left: 10, color: '#fff', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '5px 10px', borderRadius: '4px' }}>Candidate Camera</span>
          </div>

          {/* Your Video - Always small */}
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
        <button onClick={endInterview} style={{ backgroundColor: '#f44336', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>End Interview</button>
        <button style={{ backgroundColor: audioEnabled ? '#4CAF50' : '#f44336', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={toggleAudio}>{audioEnabled ? 'Mic On' : 'Mic Off'}</button>
        <button style={{ backgroundColor: videoEnabled ? '#4CAF50' : '#f44336', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} onClick={toggleVideo}>{videoEnabled ? 'Cam On' : 'Cam Off'}</button>
        <button style={{ padding: '8px 12px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', backgroundColor: '#2196F3', color: 'white' }} onClick={() => { const code = sessionStorage.getItem('hostSession'); if (code) socket.emit('start_next', { code }); }}>Start Next</button>

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
