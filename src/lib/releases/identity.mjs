import { createPublicKey, verify } from 'node:crypto';
const issuer='https://token.actions.githubusercontent.com';
let cached;
/** @param {unknown} token @param {{origin?:string,repository?:string,transport?:typeof fetch,clock?:()=>number}} options */
export async function verifyReleaseIdentity(token, {origin,repository,transport=fetch,clock=Date.now}={}){
 if(typeof origin!=='string'||!origin||typeof repository!=='string'||!repository)throw Error('release_identity_required');
 if(typeof token!=='string'||token.length>16000)throw Error('release_identity_required');
 const parts=token.split('.');if(parts.length!==3)throw Error('release_identity_required');
 const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)throw Error('release_identity_required');
 if(!cached||cached.until<clock()||!cached.keys.some(k=>k.kid===header.kid)){
  const r=await transport(issuer+'/.well-known/jwks',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('release_identity_required');
  const bytes=await r.arrayBuffer();if(bytes.byteLength>100000)throw Error('release_identity_required');
  const keys=JSON.parse(Buffer.from(bytes).toString()).keys;
  if(!Array.isArray(keys)||keys.length>20)throw Error('release_identity_required');
  cached={keys,until:clock()+300000};
 }
 const key=cached.keys.find(k=>k.kid===header.kid&&k.kty==='RSA');
 if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('release_identity_required');
 const p=JSON.parse(Buffer.from(parts[1],'base64url').toString()),now=clock()/1000;
 if(p.iss!==issuer||p.aud!==origin||p.repository!==repository||p.workflow_ref!==`${repository}/.github/workflows/project-release.yml@refs/heads/main`||p.ref!=='refs/heads/main'||p.event_name!=='workflow_dispatch'||!Number.isFinite(p.exp)||p.exp<=now||p.exp>now+900||!Number.isFinite(p.nbf)||p.nbf>now+30||!/^\d+$/.test(String(p.run_id)))throw Error('release_identity_required');
 return{runId:String(p.run_id)};
}
