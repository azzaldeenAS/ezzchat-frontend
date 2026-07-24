import express from 'express';
import http from 'http';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Load LiveKit credentials from environment (Placeholders provided)
const livekitHost = process.env.LIVEKIT_URL || 'wss://your-livekit-server.com';
const livekitApiKey = process.env.LIVEKIT_API_KEY || 'your-api-key';
const livekitApiSecret = process.env.LIVEKIT_API_SECRET || 'your-api-secret';

app.post('/api/call/token', (req, res) => {
  try {
    const { identity, name, roomName } = req.body;
    if (!identity) {
      return res.status(400).json({ error: 'Identity is required' });
    }

    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: identity,
      name: name || identity,
    });
    
    // Connect user to their personal background room to listen for incoming rings
    // Or connect them to a specific room if requested
    const targetRoom = roomName || `presence_${identity}`;
    
    at.addGrant({ 
      roomJoin: true, 
      room: targetRoom, 
      canPublish: true, 
      canSubscribe: true 
    });

    const token = at.toJwt();
    res.json({ token, url: livekitHost });
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

const server = http.createServer(app);

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 LiveKit Token Server running on port ${PORT}`);
});
