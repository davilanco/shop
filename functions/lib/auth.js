const COOKIE='davilanco_session';
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
export async function sha256(v){let b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function randomToken(n=32){let b=crypto.getRandomValues(new Uint8Array(n));return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}
export async function hashPassword(password,salt){let s=salt||crypto.getRandomValues(new Uint8Array(16)),k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']),bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:s,iterations:210000,hash:'SHA-256'},k,256);return{salt:btoa(String.fromCharCode(...s)),hash:btoa(String.fromCharCode(...new Uint8Array(bits)))}}
export async function verifyPassword(p,salt,expected){let s=Uint8Array.from(atob(salt),c=>c.charCodeAt(0)),r=await hashPassword(p,s);return r.hash===expected}
export function cookieHeader(t){return COOKIE+'='+t+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800'}
export const clearCookie=()=>COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
export async function getSession(req,env){let t=req.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!t)return null;return env.DB.prepare("SELECT u.id,u.name,u.email,u.role,u.referral_code FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now')").bind(await sha256(t)).first()}
export async function requireUser(req,env,roles=[]){let u=await getSession(req,env);if(!u)throw Object.assign(Error('Please sign in.'),{status:401});if(roles.length&&!roles.includes(u.role))throw Object.assign(Error('Insufficient permissions.'),{status:403});return u}
export async function body(req){if(!(req.headers.get('content-type')||'').includes('application/json'))throw Object.assign(Error('JSON request required.'),{status:415});return req.json()}
