/**
 * Encryption utilities for storing sensitive API keys
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';

export interface EncryptedKey {
  iv: string;
  authTag: string;
  encryptedData: string;
}

/**
 * Generate a random encryption key (256 bits for AES-256)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Encrypt a string using AES-256-GCM
 * @param plaintext The string to encrypt
 * @param key The encryption key (64 hex chars = 32 bytes)
 * @returns Encrypted data in format: iv:authTag:encryptedData
 */
export function encryptKey(plaintext: string, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encryptKey
 * @param encryptedString The encrypted string (format: iv:authTag:encryptedData)
 * @param key The encryption key (64 hex chars = 32 bytes)
 * @returns The decrypted plaintext
 */
export function decryptKey(encryptedString: string, key: string): string {
  try {
    const [iv, authTag, encryptedData] = encryptedString.split(':');
    
    if (!iv || !authTag || !encryptedData) {
      throw new Error('Invalid encrypted string format');
    }

    const keyBuffer = Buffer.from(key, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (64 hex characters)');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyBuffer,
      Buffer.from(iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}

/**
 * Encrypt multiple API keys for storage
 */
export function encryptKeys(
  keys: Record<string, string>,
  encryptionKey: string
): Record<string, string> {
  const encrypted: Record<string, string> = {};
  
  for (const [name, value] of Object.entries(keys)) {
    encrypted[name] = encryptKey(value, encryptionKey);
  }
  
  return encrypted;
}

/**
 * Decrypt multiple API keys
 */
export function decryptKeys(
  encryptedKeys: Record<string, string>,
  encryptionKey: string
): Record<string, string> {
  const decrypted: Record<string, string> = {};
  
  for (const [name, value] of Object.entries(encryptedKeys)) {
    decrypted[name] = decryptKey(value, encryptionKey);
  }
  
  return decrypted;
}
