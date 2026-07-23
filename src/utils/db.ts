import Dexie, { Table } from 'dexie';

// 1. Define the TypeScript interfaces for our local tables
export interface LocalConversation {
  id: string;
  isGroup: boolean;
  name?: string;
  lastMessagePreview?: string;
  updatedAt: number;
}

export interface LocalMessage {
  id?: number; // Auto-incremented local ID
  conversationId: string;
  senderId: string;
  senderName?: string;
  text: string; // DECRYPTED text or filename
  type?: 'text' | 'image' | 'audio' | 'file';
  mediaData?: string; // base64 string
  status: 'sent' | 'delivered' | 'read';
  timestamp: number;
}

// 2. Initialize the Dexie Database
export class EzzchatOfflineDB extends Dexie {
  conversations!: Table<LocalConversation, string>;
  messages!: Table<LocalMessage, number>;

  constructor() {
    super('EzzchatZeroCostDB');
    
    // Define the schema (indexes)
    this.version(1).stores({
      conversations: 'id, updatedAt', // Primary key 'id', indexed by 'updatedAt'
      messages: '++id, conversationId, timestamp' // Auto-increment primary key 'id'
    });
  }
}

// Export a singleton instance
export const db = new EzzchatOfflineDB();

// Helper to save a decrypted message offline instantly
export const saveMessageOffline = async (msg: LocalMessage) => {
  await db.messages.add(msg);
  // Update conversation timestamp
  await db.conversations.update(msg.conversationId, {
    lastMessagePreview: msg.text.substring(0, 30),
    updatedAt: msg.timestamp
  });
};
