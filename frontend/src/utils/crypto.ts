/**
 * Zero-Cost E2EE (End-to-End Encryption)
 * We use the native Web Crypto API so we don't have to install heavy external libraries.
 */

export const generateKeys = async () => {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );

  const pubKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: btoa(String.fromCharCode(...new Uint8Array(pubKey))),
    // The private key must NEVER leave the device. It will be stored in IndexedDB.
    privateKey: btoa(String.fromCharCode(...new Uint8Array(privKey))),
  };
};

export const encryptMsg = async (text: string, recipientPubKeyBase64: string) => {
  const binaryDer = Uint8Array.from(atob(recipientPubKeyBase64), c => c.charCodeAt(0));
  const publicKey = await window.crypto.subtle.importKey(
    "spki", binaryDer, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]
  );

  const encrypted = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" }, publicKey, new TextEncoder().encode(text)
  );
  
  // This Base64 payload is what gets sent over WebSockets.
  // The server literally cannot read it.
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
};

export const decryptMsg = async (encryptedBase64: string, myPrivKeyBase64: string) => {
  const binaryDer = Uint8Array.from(atob(myPrivKeyBase64), c => c.charCodeAt(0));
  const privateKey = await window.crypto.subtle.importKey(
    "pkcs8", binaryDer, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]
  );

  const encryptedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const decrypted = await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedBytes);

  return new TextDecoder().decode(decrypted);
};
