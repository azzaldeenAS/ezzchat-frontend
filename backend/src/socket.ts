import { Server } from 'socket.io';
import { createClient } from 'redis';
import http from 'http';
import webPush from 'web-push';

// Configure Web Push with VAPID keys
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BMExOl1zX2sQ6rSlSkkjSH-4kdoo4X35Byuz5h6apADaO1fquMGwFaqZJpl5ifw8T0_p8zQCxrPAih2BJGM1XY0';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'XnJKpkX4ZnAKwkbGWeX00p2QUFE_GzFmd-WsntQjE_s';
webPush.setVapidDetails('mailto:support@ezzchat.local', publicVapidKey, privateVapidKey);

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const initSockets = async (server: http.Server) => {
  const io = new Server(server, { cors: { origin: '*' } });
  
  const redisPub = createClient({ url: REDIS_URL });
  const redisSub = redisPub.duplicate();
  await redisPub.connect();
  await redisSub.connect();

  io.on('connection', async (socket) => {
    // Ideally authentication happens here using JWT...
    const userId = socket.handshake.auth.userId; 
    if (!userId) return socket.disconnect();

    // Track user session in Redis
    await redisPub.hSet('online_users', userId, socket.id);
    
    // Broadcast to others that this user is online
    io.emit('user_status', { userId, status: 'online' });

    // Handle Push Subscription
    socket.on('push_subscribe', async (subscription) => {
      await redisPub.hSet('push_subs', userId, JSON.stringify(subscription));
    });

    // Private Messaging
    socket.on('private_message', async (data) => {
      const { recipientId, encryptedText, conversationId } = data;
      const recipientSocket = await redisPub.hGet('online_users', recipientId);
      
      if (recipientSocket) {
        io.to(recipientSocket).emit('receive_private', {
          senderId: userId,
          encryptedText,
          conversationId,
          timestamp: Date.now()
        });
      } else {
        // User is offline, send Push Notification
        const subStr = await redisPub.hGet('push_subs', recipientId);
        if (subStr) {
          const subscription = JSON.parse(subStr);
          const payload = JSON.stringify({
            title: `New message from ${userId}`,
            body: 'You have a new encrypted message.',
            url: '/'
          });
          webPush.sendNotification(subscription, payload).catch(err => console.error("Push Error", err));
        }
      }
    });

    // Group Messaging using Redis Pub/Sub (Zero-Cost Scaling)
    socket.on('join_group', async (groupId) => {
      socket.join(`group:${groupId}`);
      // Subscribe to Redis Channel for this group
      await redisSub.subscribe(`channel:group:${groupId}`, (message) => {
        io.to(`group:${groupId}`).emit('receive_group', JSON.parse(message));
      });
    });

    socket.on('group_message', async (data) => {
      const { groupId, encryptedText } = data;
      // Broadcast to Redis Channel so ALL servers get the message
      await redisPub.publish(`channel:group:${groupId}`, JSON.stringify({
        senderId: userId,
        groupId,
        encryptedText,
        timestamp: Date.now()
      }));
    });

    // WhatsApp Features: Typing & Read Receipts
    socket.on('typing', async (data) => {
      const { groupId, recipientId } = data;
      if (groupId) {
        socket.to(`group:${groupId}`).emit('user_typing', { userId, groupId });
      } else if (recipientId) {
        const recipientSocket = await redisPub.hGet('online_users', recipientId);
        if (recipientSocket) io.to(recipientSocket).emit('user_typing', { userId });
      }
    });

    socket.on('stop_typing', async (data) => {
      const { groupId, recipientId } = data;
      if (groupId) {
        socket.to(`group:${groupId}`).emit('user_stop_typing', { userId, groupId });
      } else if (recipientId) {
        const recipientSocket = await redisPub.hGet('online_users', recipientId);
        if (recipientSocket) io.to(recipientSocket).emit('user_stop_typing', { userId });
      }
    });

    socket.on('message_status', async (data) => {
      // data: { messageId, status: 'delivered' | 'read', senderId (original sender) }
      const { messageId, status, senderId } = data;
      const senderSocket = await redisPub.hGet('online_users', senderId);
      if (senderSocket) {
        io.to(senderSocket).emit('message_status_update', { messageId, status, userId });
      }
    });

    socket.on('disconnect', async () => {
      await redisPub.hDel('online_users', userId);
      io.emit('user_status', { userId, status: 'offline', lastSeen: Date.now() });
    });

    // --- LiveKit Call Signaling ---
    
    // 1-on-1 Call Request
    socket.on('request_call', async (data) => {
      const { recipientId, roomId } = data;
      const recipientSocket = await redisPub.hGet('online_users', recipientId);
      if (recipientSocket) {
        io.to(recipientSocket).emit('incoming_call', { callerId: userId, roomId });
      } else {
        // Send Call Notification
        const subStr = await redisPub.hGet('push_subs', recipientId);
        if (subStr) {
          const subscription = JSON.parse(subStr);
          const payload = JSON.stringify({
            title: `Incoming call from ${userId}`,
            body: 'Tap to answer',
            url: '/'
          });
          webPush.sendNotification(subscription, payload).catch(err => console.error("Push Error", err));
        }
      }
    });

    // Group Call Request (Zero-Cost Broadcasting)
    socket.on('start_group_call', async (data) => {
      const { groupId, roomId } = data;
      // Publish event to Redis, all connected servers will forward it to their local sockets
      await redisPub.publish(`channel:group:${groupId}`, JSON.stringify({
        type: 'GROUP_CALL',
        callerId: userId,
        groupId,
        roomId
      }));
    });
  });
};
