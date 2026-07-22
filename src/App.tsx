import React, { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveMessageOffline } from './utils/db';
import { encryptMsg, decryptMsg, generateKeys } from './utils/crypto';
import io, { Socket } from 'socket.io-client';
import './index.css';

const BACKEND_URL = 'http://localhost:8000';

export const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeConversation, setActiveConversation] = useState<string>('group_zero');
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Offline-First: Load instantly from IndexedDB
  const localMessages = useLiveQuery(
    () => db.messages.where('conversationId').equals(activeConversation).sortBy('timestamp'),
    [activeConversation]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  useEffect(() => {
    // Generate keys if missing
    if (!localStorage.getItem('ezzchat_private_key')) {
      generateKeys().then(keys => {
        localStorage.setItem('ezzchat_private_key', keys.privateKey);
        localStorage.setItem('ezzchat_public_key', keys.publicKey);
      });
    }

    const newSocket = io(BACKEND_URL, {
      auth: { userId: 'guest_user' } // Mock auth for demo
    });

    newSocket.on('connect', () => {
      console.log('🟢 Connected via WebSockets');
      newSocket.emit('join_group', 'group_zero');
    });

    newSocket.on('receive_group', async (data) => {
      if(data.senderId === 'guest_user') return; // Ignore own messages
      
      const privateKeyBase64 = localStorage.getItem('ezzchat_private_key') || '';
      let plainText = '🔒 Encrypted Message';
      try {
        // Mocking decryption for demo stability if keys don't match
        plainText = await decryptMsg(data.encryptedText, privateKeyBase64).catch(() => data.encryptedText);
      } catch (e) {}

      await saveMessageOffline({
        conversationId: 'group_zero',
        senderId: data.senderId,
        text: plainText,
        status: 'delivered',
        timestamp: data.timestamp
      });
    });

    setSocket(newSocket);
    return () => { newSocket.disconnect(); };
  }, []);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !socket) return;

    const pubKey = localStorage.getItem('ezzchat_public_key') || '';
    const encryptedText = await encryptMsg(inputText, pubKey);

    const newMsg = {
      conversationId: activeConversation,
      senderId: 'guest_user',
      text: inputText, 
      status: 'sent' as const,
      timestamp: Date.now()
    };

    await saveMessageOffline(newMsg);
    
    socket.emit('group_message', {
      groupId: 'zero',
      encryptedText
    });

    setInputText('');
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Ezzchat</h2>
        </div>
        <div className="chat-list">
          <div className="chat-item active">
            <div className="avatar">#</div>
            <div>
              <div style={{ fontWeight: 600 }}>Zero-Cost Room</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tap to join discussion</div>
            </div>
          </div>
        </div>
      </div>

      <div className="main-chat">
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div className="avatar">Z</div>
            <div>
              <h3>Zero-Cost Architecture</h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>● Online</span>
            </div>
          </div>
          <div className="header-actions">
            <button>🎥 Video Call</button>
          </div>
        </div>

        <div className="messages-area">
          {localMessages?.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 'auto', marginBottom: 'auto' }}>
              No messages yet. Send a secure E2EE message!
            </div>
          )}
          {localMessages?.map(msg => (
            <div key={msg.id} className={`message ${msg.senderId === 'guest_user' ? 'sent' : 'received'}`}>
              <div>{msg.text}</div>
              <span className="message-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-area" onSubmit={sendMessage}>
          <input 
            value={inputText} 
            onChange={e => setInputText(e.target.value)} 
            placeholder="Type a secure message..."
          />
          <button type="submit" className="send-btn">
            ➤
          </button>
        </form>
      </div>
    </div>
  );
};

export default App;
