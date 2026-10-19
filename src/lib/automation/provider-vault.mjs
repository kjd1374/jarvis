import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const key = secret => { if(typeof secret!=='string'||secret.length<32)throw Error('provider_vault_unavailable');return createHash('sha256').update('jarvis-provider-vault-v1\0'+secret).digest(); };
export function sealProvider(value, secret, owner, space, provider) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(secret),iv);
  cipher.setAAD(Buffer.from(JSON.stringify([owner,space,provider])));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');
}
export function openProvider(sealed, secret, owner, space, provider) {
  try{const bytes=Buffer.from(sealed,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(secret),bytes.subarray(0,12));decipher.setAAD(Buffer.from(JSON.stringify([owner,space,provider])));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));}catch{throw Error('provider_connection_required');}
}
