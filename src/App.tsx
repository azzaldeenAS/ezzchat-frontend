import React, { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveMessageOffline } from './utils/db';
import { encryptMsg, decryptMsg, generateKeys } from './utils/crypto';
import io, { Socket } from 'socket.io-client';
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import './index.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:8000';

export const App: React.FC = () => {
  const [user, setUser] = useState<{ id: string, name: string } | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: usernameInput })
      });
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        initChat(data.user);
      }
    } catch (err) {
      alert('Login failed. Ensure backend is running.');
    }
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
      alert('Failed to start call');
    }
  };

  if (!user) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h2>Welcome to Ezzchat</h2>
          <p>Zero-Cost Encrypted Messaging</p>
          <form onSubmit={handleLogin}>
            <input 
              type="text" 
              placeholder="Enter your name" 
              value={usernameInput} 
              onChange={e => setUsernameInput(e.target.value)} 
              autoFocus
            />
            <button type="submit">Join Chat</button>
          </form>
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
             <span>{user.name}</span>
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
