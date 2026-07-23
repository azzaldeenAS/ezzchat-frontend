import React, { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveMessageOffline } from './utils/db';
import { encryptMsg, decryptMsg, generateKeys } from './utils/crypto';
import io, { Socket } from 'socket.io-client';
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from '@livekit/components-react';
import { supabase } from './utils/supabase';
import '@livekit/components-styles';
import './index.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_API_URL || 'https://ezzchat-backend.onrender.com';

export const App: React.FC = () => {
  const [user, setUser] = useState<{ id: string, name: string, email?: string } | null>(null);
  
  // Auth state
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeConversation, setActiveConversation] = useState<string>('group_zero');
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [inCall, setInCall] = useState(false);
  const [callToken, setCallToken] = useState('');

  const localMessages = useLiveQuery(
    () => db.messages.where('conversationId').equals(activeConversation).sortBy('timestamp'),
    [activeConversation]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  useEffect(() => {
    // Check active Supabase session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        handleSuccessfulLogin(session.user);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        handleSuccessfulLogin(session.user);
      } else {
        setUser(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleSuccessfulLogin = (supabaseUser: any) => {
    const name = supabaseUser.user_metadata?.full_name || supabaseUser.email?.split('@')[0] || 'User';
    const loggedInUser = { id: supabaseUser.id, name, email: supabaseUser.email };
    setUser(loggedInUser);
    initChat(loggedInUser);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!emailInput || !passwordInput) return setAuthError('Email and Password required');

    try {
      if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailInput,
          password: passwordInput,
        });
        if (error) throw error;
      } else {
        if (!nameInput) return setAuthError('Name is required for Signup');
        const { error } = await supabase.auth.signUp({
          email: emailInput,
          password: passwordInput,
          options: {
            data: { full_name: nameInput }
          }
        });
        if (error) throw error;
        alert('Signup successful! Check your email to verify (if enabled) or just login!');
        setIsLoginMode(true);
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });
      if (error) throw error;
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    if(socket) socket.disconnect();
  };

  const initChat = (loggedInUser: {id: string, name: string}) => {
    if (!localStorage.getItem('ezzchat_private_key')) {
      generateKeys().then(keys => {
        localStorage.setItem('ezzchat_private_key', keys.privateKey);
        localStorage.setItem('ezzchat_public_key', keys.publicKey);
      });
    }

    const newSocket = io(BACKEND_URL, {
      auth: { userId: loggedInUser.id }
    });

    newSocket.on('connect', () => {
      newSocket.emit('join_group', 'group_zero');
    });

    newSocket.on('receive_group', async (data) => {
      if(data.senderId === loggedInUser.id) return;
      
      const privateKeyBase64 = localStorage.getItem('ezzchat_private_key') || '';
      let plainText = '🔒 Encrypted Message';
      try {
        plainText = await decryptMsg(data.encryptedText, privateKeyBase64).catch(() => data.encryptedText);
      } catch (e) {}

      await saveMessageOffline({
        conversationId: 'group_zero',
        senderId: data.senderId,
        senderName: data.senderName,
        text: plainText,
        status: 'delivered',
        timestamp: data.timestamp
      });
    });

    setSocket(newSocket);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !socket || !user) return;

    const pubKey = localStorage.getItem('ezzchat_public_key') || '';
    const encryptedText = await encryptMsg(inputText, pubKey);

    const newMsg = {
      conversationId: activeConversation,
      senderId: user.id,
      senderName: user.name,
      text: inputText, 
      status: 'sent' as const,
      timestamp: Date.now()
    };

    await saveMessageOffline(newMsg);
    
    socket.emit('group_message', {
      groupId: 'zero',
      senderName: user.name,
      encryptedText
    });

    setInputText('');
  };

  const startCall = async () => {
    if(!user) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/call/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: activeConversation, userId: user.id })
      });
      const data = await res.json();
      if(data.token) {
        setCallToken(data.token);
        setInCall(true);
      }
    } catch(err) {
      alert('Failed to start call. Make sure backend is running.');
    }
  };

  if (!user) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h2>Ezzchat</h2>
          <p>Secure & Zero-Cost Messaging</p>
          
          <button className="google-btn" onClick={handleGoogleLogin}>
            <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>

          <div className="divider"><span>OR</span></div>

          {authError && <div className="error-msg">{authError}</div>}

          <form onSubmit={handleEmailAuth}>
            {!isLoginMode && (
              <input 
                type="text" 
                placeholder="Full Name" 
                value={nameInput} 
                onChange={e => setNameInput(e.target.value)} 
              />
            )}
            <input 
              type="email" 
              placeholder="Email Address" 
              value={emailInput} 
              onChange={e => setEmailInput(e.target.value)} 
            />
            <input 
              type="password" 
              placeholder="Password" 
              value={passwordInput} 
              onChange={e => setPasswordInput(e.target.value)} 
            />
            <button type="submit">{isLoginMode ? 'Login' : 'Create Account'}</button>
          </form>

          <div className="toggle-auth">
            {isLoginMode ? "Don't have an account? " : "Already have an account? "}
            <span onClick={() => setIsLoginMode(!isLoginMode)}>
              {isLoginMode ? 'Sign up' : 'Login'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {inCall && (
        <div className="call-modal">
           <LiveKitRoom
              video={true}
              audio={true}
              token={callToken}
              serverUrl={import.meta.env.VITE_LIVEKIT_URL || 'wss://ezzchat-u6d2le0b.livekit.cloud'}
              onDisconnected={() => setInCall(false)}
              data-lk-theme="default"
              style={{ height: '100vh', width: '100vw' }}
            >
              <VideoConference />
              <RoomAudioRenderer />
            </LiveKitRoom>
            <button className="close-call-btn" onClick={() => setInCall(false)}>❌ Close Call</button>
        </div>
      )}

      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Ezzchat</h2>
          <div className="user-profile">
             <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
             <div style={{display:'flex', flexDirection:'column'}}>
               <span>{user.name}</span>
               <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}} onClick={handleLogout} className="logout-btn">Logout</span>
             </div>
          </div>
        </div>
        <div className="chat-list">
          <div className="chat-item active">
            <div className="avatar" style={{background: 'var(--accent)'}}>#</div>
            <div>
              <div style={{ fontWeight: 600 }}>Public Lounge</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Global Chat Room</div>
            </div>
          </div>
        </div>
      </div>

      <div className="main-chat">
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div className="avatar" style={{background: 'var(--accent)'}}>#</div>
            <div>
              <h3>Public Lounge</h3>
              <span style={{ fontSize: '0.85rem', color: '#10b981' }}>● Online</span>
            </div>
          </div>
          <div className="header-actions">
            <button onClick={startCall} className="call-btn">🎥 Video Call</button>
          </div>
        </div>

        <div className="messages-area">
          {localMessages?.length === 0 && (
            <div className="empty-chat">
              <span>👋</span>
              <p>Welcome! Send the first secure message.</p>
            </div>
          )}
          {localMessages?.map((msg: any) => {
             const isMe = msg.senderId === user.id;
             return (
              <div key={msg.id} className={`message-wrapper ${isMe ? 'me' : 'them'}`}>
                {!isMe && <span className="sender-name">{msg.senderName || 'Unknown'}</span>}
                <div className={`message ${isMe ? 'sent' : 'received'}`}>
                  <div>{msg.text}</div>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-area" onSubmit={sendMessage}>
          <input 
            value={inputText} 
            onChange={e => setInputText(e.target.value)} 
            placeholder="Type a secure message..."
          />
          <button type="submit" className="send-btn" disabled={!inputText.trim()}>
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default App;
