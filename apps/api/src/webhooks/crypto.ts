// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.LSDS_WEBHOOK_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "LSDS_WEBHOOK_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
      "Generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

export function isWebhookEncryptionKeySet(): boolean {
  const hex = process.env.LSDS_WEBHOOK_ENCRYPTION_KEY;
  return typeof hex === "string" && hex.length === 64;
}

export function encryptSecret(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptSecret(encrypted: Buffer): string {
  const key = getKey();
  const iv = encrypted.subarray(0, IV_LEN);
  const tag = encrypted.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = encrypted.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestamp}.${rawBody}`);
  return `sha256=${mac.digest("hex")}`;
}
