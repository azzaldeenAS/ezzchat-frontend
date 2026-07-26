import React, { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveMessageOffline } from './utils/db';
import { encryptMsg, decryptMsg, generateKeys } from './utils/crypto';
import { supabase } from './utils/supabase';
import { LiveKitRoom, useRoomContext, useTracks, VideoTrack, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import './index.css';

const VAPID_PUBLIC_KEY = 'BMExOl1zX2sQ6rSlSkkjSH-4kdoo4X35Byuz5h6apADaO1fquMGwFaqZJpl5ifw8T0_p8zQCxrPAih2BJGM1XY0';
const DEFAULT_CHAT_UUID = '00000000-0000-0000-0000-000000000000'; // To match UUID in DB

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Native HTML5 Canvas Image Compression
const compressImage = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 300; // Small size for avatars
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Compression failed'));
        }, 'image/jpeg', 0.8);
      };
    };
  });
};

const CallView = ({ onEndCall }: { onEndCall: () => void }) => {
  const room = useRoomContext();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const micTracks = useTracks([Track.Source.Microphone]);

  const setCamera = async (facingMode: 'user' | 'environment') => {
    try {
      await room.localParticipant.setCameraEnabled(true, { facingMode });
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      console.error(e);
      alert('Camera access error');
    }
  };

  const endCall = async () => {
    await room.localParticipant.setCameraEnabled(false);
    await room.localParticipant.setMicrophoneEnabled(false);
    onEndCall();
  };

  return (
    <div className="call-view">
      <div className="video-grid">
        {cameraTracks.map((trackRef) => (
          <VideoTrack key={trackRef.participant.identity + trackRef.source} trackRef={trackRef} />
        ))}
        {micTracks.map((trackRef) => (
          <AudioTrack key={trackRef.participant.identity + trackRef.source} trackRef={trackRef} />
        ))}
      </div>
      <div className="call-controls">
        <button className="control-btn" onClick={() => setCamera('user')}>
          الكاميرا الأمامية
        </button>
        <button className="control-btn" onClick={() => setCamera('environment')}>
          الكاميرا الخلفية
        </button>
        <button className="control-btn end-call-btn" onClick={endCall}>
          إنهاء المكالمة
        </button>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  
  // Auth Flow (Email OTP)
  const [emailInput, setEmailInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Profile Setup Flow
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const [activeConversation, setActiveConversation] = useState<string>(DEFAULT_CHAT_UUID);
  const [sidebarChats, setSidebarChats] = useState<any[]>([
    { id: DEFAULT_CHAT_UUID, name: 'Zero-Cost Room', avatar: '#', subtitle: 'Tap to join discussion' }
  ]);
  
  // LiveKit States
  const [liveKitToken, setLiveKitToken] = useState('');
  const [liveKitUrl, setLiveKitUrl] = useState('');
  
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Audio recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const isRecordingRef = useRef(false);
  
  const [channelRef, setChannelRef] = useState<any>(null);
  const [isInCall, setIsInCall] = useState(false);

  // Offline-First: Load instantly from IndexedDB (preserves previous zero-cost features)
  const localMessages = useLiveQuery(
    () => db.messages.where('conversationId').equals(activeConversation).sortBy('timestamp'),
    [activeConversation]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  useEffect(() => {
    if (!localStorage.getItem('ezzchat_private_key')) {
      generateKeys().then(keys => {
        localStorage.setItem('ezzchat_private_key', keys.privateKey);
        localStorage.setItem('ezzchat_public_key', keys.publicKey);
      });
    }

    // Initialize Supabase Auth
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if(session) setCurrentUser(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if(session) setCurrentUser(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !currentUser) return;

    // Phase 4: Realtime Engine via Supabase
    const channel = supabase.channel(`room:${activeConversation}`, {
      config: { presence: { key: currentUser } }
    });
    
    setChannelRef(channel);

    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload.userId !== currentUser) setIsTyping(payload.payload.isTyping);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const isOthersOnline = Object.keys(state).filter(k => k !== currentUser).length > 0;
        setIsOnline(isOthersOnline);
        if(!isOthersOnline) setLastSeen(Date.now());
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        if (payload.new.sender_id === currentUser) return; // Ignore own echoes
        
        const privateKeyBase64 = localStorage.getItem('ezzchat_private_key') || '';
        let plainText = '🔒 Encrypted Message';
        try {
          plainText = await decryptMsg(payload.new.content, privateKeyBase64).catch(() => payload.new.content);
        } catch (e) {}

        // Save to Dexie offline DB
        await saveMessageOffline({
          conversationId: activeConversation,
          senderId: payload.new.sender_id,
          text: plainText,
          status: 'delivered',
          timestamp: new Date(payload.new.created_at).getTime()
        });
        
        // Update Read Receipts
        await supabase.from('messages').update({ status: 'read' }).eq('id', payload.new.id);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    // Service Worker registration for Push Notifications
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').then(async (registration) => {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }
      }).catch(console.error);
    }

    return () => { supabase.removeChannel(channel); };
  }, [session, activeConversation, currentUser]);

  const sendEmailOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(emailInput)) return alert("Please enter a valid email address.");
    const { error } = await supabase.auth.signInWithOtp({ email: emailInput });
    if (error) alert(error.message);
    else setIsOtpSent(true);
  };

  const verifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: authData, error } = await supabase.auth.verifyOtp({ email: emailInput, token: otpInput, type: 'email' });
    if (error) {
      alert(error.message);
      return;
    }
    
    // Check if user has a profile
    if (authData.session) {
      const { data: userProfile } = await supabase.from('users').select('*').eq('id', authData.session.user.id).single();
      if (!userProfile || !userProfile.username) {
        setShowProfileSetup(true);
      }
    }
  };

  const handleProfileSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || !usernameInput) return alert("Display name and username are required.");
    
    let avatarUrl = '';
    if (avatarFile) {
      const compressedBlob = await compressImage(avatarFile);
      const fileName = `${currentUser}-${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage.from('avatars').upload(fileName, compressedBlob);
      if (!uploadError) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
        avatarUrl = data.publicUrl;
      }
    }

    const { error: dbError } = await supabase.from('users').upsert({
      id: currentUser,
      email: session.user.email,
      username: usernameInput,
      display_name: displayName,
      avatar_url: avatarUrl
    });

    if (dbError) {
      alert("Error saving profile: " + dbError.message);
    } else {
      setShowProfileSetup(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !channelRef) return;

    const pubKey = localStorage.getItem('ezzchat_public_key') || '';
    const encryptedText = await encryptMsg(inputText, pubKey);

    const newMsg = {
      conversationId: activeConversation,
      senderId: currentUser || 'unknown',
      text: inputText, 
      status: 'sent' as const,
      timestamp: Date.now()
    };

    await saveMessageOffline(newMsg);
    
    // Insert into Supabase DB
    await supabase.from('messages').insert({
      chat_id: activeConversation,
      sender_id: currentUser,
      content: encryptedText,
      status: 'sent'
    });

    channelRef.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUser, isTyping: false } });
    setInputText('');
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!channelRef) return;

    channelRef.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUser, isTyping: true } });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      channelRef.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUser, isTyping: false } });
    }, 2000);
  };

  const handleMicPointerDown = async (e: React.PointerEvent) => {
    if (inputText.trim()) return; 
    e.preventDefault();
    setIsRecording(true);
    isRecordingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      if (!isRecordingRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = []; 

        if (audioBlob.size < 500) return;
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          
          const pubKey = localStorage.getItem('ezzchat_public_key') || '';
          const encryptedText = await encryptMsg(base64Audio, pubKey);

          const newMsg = {
            conversationId: activeConversation,
            senderId: currentUser || 'unknown',
            text: base64Audio, 
            status: 'sent' as const,
            timestamp: Date.now()
          };

          await saveMessageOffline(newMsg);
          
          // Insert audio to Supabase
          await supabase.from('messages').insert({
            chat_id: activeConversation,
            sender_id: currentUser,
            content: encryptedText,
            status: 'sent'
          });
        };
      };

      mediaRecorder.start();
    } catch (err) {
      console.error(err);
      alert("Microphone access denied.");
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  };

  const handleMicPointerUp = (e: React.PointerEvent) => {
    if (inputText.trim()) return;
    e.preventDefault();
    setIsRecording(false);
    isRecordingRef.current = false;
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const startCall = async (video: boolean) => {
    try {
      // Fetch token from the correct live backend
      const backendUrl = import.meta.env.VITE_BACKEND_API_URL || 'https://ezzchat-backend.onrender.com';
      const res = await fetch(`${backendUrl}/api/call/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: currentUser, roomName: activeConversation })
      });
      const data = await res.json();
      
      if (data.token) {
        setLiveKitToken(data.token);
        setLiveKitUrl(data.url || import.meta.env.VITE_LIVEKIT_URL || 'wss://ezzchat-u6d2le0b.livekit.cloud');
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
        stream.getTracks().forEach(track => track.stop());
        setIsInCall(true);
      }
    } catch (err) {
      console.error(err);
      alert('❌ Permission denied or failed to connect! Allow microphone/camera to make calls.');
    }
  };

  const searchUser = async () => {
    if (!searchQuery) return;
    const { data, error } = await supabase.from('users')
      .select('*')
      .or(`email.eq.${searchQuery},username.eq.${searchQuery}`)
      .single();
    
    if (data) {
      if (!sidebarChats.find(c => c.id === data.id)) {
        setSidebarChats([...sidebarChats, { id: data.id, name: data.display_name, avatar: data.avatar_url, subtitle: `@${data.username}` }]);
      }
      setActiveConversation(data.id);
      setSearchQuery('');
    } else {
      alert('User not found.');
    }
  };

  if (!session) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: '20px' }}>Ezzchat Security</h2>
        {!isOtpSent ? (
          <form onSubmit={sendEmailOTP} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '300px' }}>
            <input 
              value={emailInput} 
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="Enter Email Address" 
              type="email"
              style={{ padding: '12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
            />
            <button type="submit" className="send-btn" style={{ width: '100%', borderRadius: '8px' }}>Send Magic Link / OTP</button>
          </form>
        ) : (
          <form onSubmit={verifyOTP} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '300px' }}>
            <input 
              value={otpInput} 
              onChange={(e) => setOtpInput(e.target.value)}
              placeholder="Enter 6-digit OTP" 
              style={{ padding: '12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', letterSpacing: '5px', textAlign: 'center' }}
            />
            <button type="submit" className="send-btn" style={{ width: '100%', borderRadius: '8px' }}>Verify</button>
          </form>
        )}
      </div>
    );
  }

  if (showProfileSetup) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: '20px' }}>Complete Your Profile</h2>
        <form onSubmit={handleProfileSetup} style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '300px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '100px', height: '100px', borderRadius: '50%', background: '#444', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {avatarFile ? (
                <img src={URL.createObjectURL(avatarFile)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : '📷'}
            </div>
            <label style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '0.9rem' }}>
              Upload Avatar
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files && setAvatarFile(e.target.files[0])} />
            </label>
          </div>

          <input 
            value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display Name (e.g. John Doe)" 
            style={{ padding: '12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
          />
          <input 
            value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)}
            placeholder="Username (e.g. john123)" 
            style={{ padding: '12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
          />
          
          <button type="submit" className="send-btn" style={{ width: '100%', borderRadius: '8px' }}>Save Profile</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Hidden or Fullscreen LiveKit Connection */}
      {liveKitToken && (
        <LiveKitRoom
          video={false} // CallView toggles this
          audio={false}
          token={liveKitToken}
          serverUrl={liveKitUrl}
          connect={true}
          className={isInCall ? 'livekit-fullscreen' : 'livekit-hidden'}
        >
          {isInCall && <CallView onEndCall={() => setIsInCall(false)} />}
        </LiveKitRoom>
      )}
      <div className="sidebar">
        <div className="sidebar-header" style={{ paddingBottom: 0 }}>
          <h2>Ezzchat</h2>
        </div>
        <div style={{ padding: '15px' }}>
          <div style={{ display: 'flex', gap: '5px' }}>
            <input 
              placeholder="Search user by email or @username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '0.9rem' }}
            />
            <button onClick={searchUser} className="send-btn" style={{ width: '40px', height: '40px' }}>🔍</button>
          </div>
        </div>
        <div className="chat-list">
          {sidebarChats.map(chat => (
            <div 
              key={chat.id} 
              className={`chat-item ${activeConversation === chat.id ? 'active' : ''}`}
              onClick={() => setActiveConversation(chat.id)}
            >
              <div className="avatar" style={{ overflow: 'hidden' }}>
                {chat.avatar && chat.avatar !== '#' ? <img src={chat.avatar} alt="avatar" style={{width:'100%', height:'100%', objectFit:'cover'}}/> : chat.avatar || '👤'}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{chat.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{chat.subtitle}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="copyright-sidebar" style={{ padding: '15px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-glass)' }}>
          حقوق الطبع محفوظة للمهندس عزالدين الرهمي ©️
        </div>
      </div>

      <div className="main-chat">
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div className="avatar" style={{ overflow: 'hidden' }}>
              {sidebarChats.find(c => c.id === activeConversation)?.avatar?.includes('http') 
                ? <img src={sidebarChats.find(c => c.id === activeConversation)?.avatar} alt="avatar" style={{width:'100%', height:'100%', objectFit:'cover'}}/> 
                : 'Z'}
            </div>
            <div>
              <h3>{sidebarChats.find(c => c.id === activeConversation)?.name || 'Chat'}</h3>
              {isTyping ? (
                <span className="typing-indicator">Typing...</span>
              ) : (
                <span className={`online-status ${isOnline ? '' : 'offline'}`}>
                  {isOnline 
                    ? '● Online' 
                    : lastSeen 
                      ? `Last seen at ${new Date(lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` 
                      : '● Offline'}
                </span>
              )}
            </div>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => startCall(false)}>📞 Voice</button>
            <button onClick={() => startCall(true)}>🎥 Video</button>
          </div>
        </div>

        <div className="messages-area">
          {localMessages?.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 'auto', marginBottom: 'auto' }}>
              No messages yet. Send a secure E2EE message!
            </div>
          )}
          {localMessages?.map(msg => (
            <div key={msg.id} className={`message ${msg.senderId === currentUser ? 'sent' : 'received'}`}>
              {msg.text.startsWith('data:audio/') ? (
                <audio src={msg.text} controls style={{ maxWidth: '250px', outline: 'none', borderRadius: '20px' }} />
              ) : (
                <div>{msg.text}</div>
              )}
              <div className="message-meta">
                <span className="message-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.senderId === currentUser && (
                  <span className={`message-status ${msg.status === 'read' ? 'read' : ''}`}>
                    {msg.status === 'sent' ? '✓' : '✓✓'}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-area" onSubmit={sendMessage}>
          <input 
            value={inputText} 
            onChange={handleTyping} 
            placeholder={isRecording ? "🎤 Recording... Release to send" : "Type a secure message..."}
            disabled={isRecording}
          />
          <button 
            type={inputText.trim() ? "submit" : "button"} 
            className={`send-btn ${isRecording ? 'recording' : ''}`}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerUp}
            onPointerLeave={handleMicPointerUp}
          >
            {inputText.trim() ? '➤' : '🎤'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default App;
