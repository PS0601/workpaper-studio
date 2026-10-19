'use strict';
// Dependency-free Node 22.16+ server. Role switching is deliberately a demo feature,
// not identity authentication. Use fictional data only and restrict public access.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const C=require('./public/core.js');
const PORT=Number(process.env.PORT||3000),HOST=process.env.HOST||'0.0.0.0';
const ROOT=__dirname,STORE=process.env.DATA_DIR||path.join(ROOT,'storage');
fs.mkdirSync(STORE,{recursive:true});
const raw=fs.readFileSync(process.env.PACKET_PATH||path.join(ROOT,'data','packet.json'),'utf8');
const packet=C.validatePacket(JSON.parse(raw));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),packetHash=hash(raw);
const db=new DatabaseSync(path.join(STORE,'trace.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS packet (id INTEGER PRIMARY KEY CHECK(id=1), sha256 TEXT NOT NULL, original TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit (revision INTEGER PRIMARY KEY, body TEXT NOT NULL, previous_hash TEXT NOT NULL, sha256 TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS frozen (id TEXT PRIMARY KEY, body TEXT NOT NULL, sha256 TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, actor TEXT NOT NULL, expires INTEGER NOT NULL, revealed INTEGER NOT NULL DEFAULT 0);
 CREATE TRIGGER IF NOT EXISTS no_audit_updates BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS no_audit_deletes BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS no_frozen_updates BEFORE UPDATE ON frozen BEGIN SELECT RAISE(ABORT,'snapshot is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS no_frozen_deletes BEFORE DELETE ON frozen BEGIN SELECT RAISE(ABORT,'snapshot is immutable'); END;
`);
const oldPacket=db.prepare('SELECT sha256 FROM packet WHERE id=1').get();
if(oldPacket&&oldPacket.sha256!==packetHash)throw Error('The packet differs from the workspace source. Use a new DATA_DIR; never overwrite historical packet facts.');
if(!oldPacket)db.prepare('INSERT INTO packet VALUES(1,?,?)').run(packetHash,raw);
if(!db.prepare('SELECT id FROM workspace WHERE id=1').get())db.prepare('INSERT INTO workspace VALUES(1,0,?)').run(JSON.stringify(C.initial(packet)));
const sessions=new Set(),rates=new Map();
const readState=()=>JSON.parse(db.prepare('SELECT body FROM workspace WHERE id=1').get().body);
function headers(res,extra={}){res.writeHead(extra.status||200,{'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",...Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='status'))});}
function json(res,status,data,extra={}){headers(res,{status,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(data));}
function getSession(req){const token=(req.headers.cookie||'').match(/(?:^|;\s*)trace_session=([a-f0-9]+)/)?.[1];if(!token)return null;const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,Date.now());return s||null;}
function newSession(req,actor){const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?,0)').run(token,actor,Date.now()+12*3600000);const secure=req.headers['x-forwarded-proto']==='https'?'; Secure':'';return {token,cookie:`trace_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`};}
async function body(req){let s='',n=0;for await(const c of req){n+=c.length;if(n>4200000){const e=Error('Request too large (4 MB maximum)');e.status=413;throw e;}s+=c;}try{return JSON.parse(s||'{}');}catch{throw Error('Invalid JSON request');}}
function csrf(req){if(req.headers['x-trace']!=='1')throw Error('Missing same-origin request header');const origin=req.headers.origin;if(origin){const host=req.headers['x-forwarded-host']||req.headers.host;let o;try{o=new URL(origin);}catch{throw Error('Invalid origin');}if(o.host!==host)throw Error('Cross-origin request rejected');}}
function bootstrap(s){const a=C.actor(packet,s.actor),v=C.publicView(packet,readState(),a,!!s.revealed);return {...v,packetHash,appVersion:'1.0.0',integrity:db.prepare('SELECT sha256 FROM audit ORDER BY revision DESC LIMIT 1').get()?.sha256||'genesis'};}
function append(session,request){let s=readState();if(request.revision!==s.revision){const e=Error('Another user changed this workspace. The latest revision has been loaded; review it and try again.');e.status=409;throw e;}
 const at=new Date().toISOString(),id=crypto.randomUUID();
 const next=C.apply(packet,s,session.actor,request.action,{at,id,packetHash});
 const event=next.audit.at(-1);const prev=db.prepare('SELECT sha256 FROM audit ORDER BY revision DESC LIMIT 1').get()?.sha256||'genesis';const eventBody=JSON.stringify(event);const eventHash=hash(prev+eventBody);
 // SHA-256 is the authoritative server integrity check. The portable FNV fingerprint
 // is only a UI change identifier, not a cryptographic signature.
 for(const snap of next.snapshots){if(!snap.sha256)snap.sha256=hash(JSON.stringify(snap));}
 db.exec('BEGIN IMMEDIATE');
 try{db.prepare('UPDATE workspace SET revision=?,body=? WHERE id=1 AND revision=?').run(next.revision,JSON.stringify(next),s.revision);db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(next.revision,eventBody,prev,eventHash);for(const sn of next.snapshots)if(!db.prepare('SELECT id FROM frozen WHERE id=?').get(sn.id))db.prepare('INSERT INTO frozen VALUES(?,?,?)').run(sn.id,JSON.stringify(sn),sn.sha256);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 for(const res of sessions)res.write(`data: ${JSON.stringify({revision:next.revision})}\n\n`);
 return next;
}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),route=url.pathname;
 if(route==='/health'){return json(res,200,{ok:true,version:'1.0.0'});}
 if(route.startsWith('/api/')){
  let sess=getSession(req);
  if(route==='/api/login'&&req.method==='POST'){csrf(req);const b=await body(req);if(process.env.ACCESS_CODE&&b.code!==process.env.ACCESS_CODE)return json(res,401,{error:'The deployment access code is incorrect.'});const fresh=newSession(req,'st-01');return json(res,200,{ok:true},{'Set-Cookie':fresh.cookie});}
  if(!sess){if(process.env.ACCESS_CODE)return json(res,401,{error:'Enter this deployment\'s access code.'});const fresh=newSession(req,'st-01');sess={token:fresh.token,actor:'st-01',revealed:0};if(route==='/api/bootstrap')return json(res,200,bootstrap(sess),{'Set-Cookie':fresh.cookie});return json(res,401,{error:'Open the app to initialize your session.'});}
  if(route==='/api/bootstrap'&&req.method==='GET')return json(res,200,bootstrap(sess));
  if(route==='/api/events'&&req.method==='GET'){headers(res,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');sessions.add(res);const interval=setInterval(()=>res.write(': heartbeat\n\n'),25000);req.on('close',()=>{clearInterval(interval);sessions.delete(res);});return;}
  if(route==='/api/switch'&&req.method==='POST'){csrf(req);const b=await body(req);C.actor(packet,b.actor);db.prepare('UPDATE sessions SET actor=?,revealed=0 WHERE token=?').run(b.actor,sess.token);return json(res,200,bootstrap({...sess,actor:b.actor,revealed:0}));}
  if(route==='/api/action'&&req.method==='POST'){
   csrf(req);const b=await body(req);const t=Date.now(),r=rates.get(sess.token)||{time:t,count:0};if(t-r.time>60000){r.time=t;r.count=0;}if(++r.count>250)return json(res,429,{error:'Please wait a moment before sending more changes.'});rates.set(sess.token,r);
   append(sess,b);if(b.action.type==='reveal'){db.prepare('UPDATE sessions SET revealed=1 WHERE token=?').run(sess.token);sess.revealed=1;}return json(res,200,bootstrap(sess));
  }
  if(route==='/api/conceal'&&req.method==='POST'){csrf(req);db.prepare('UPDATE sessions SET revealed=0 WHERE token=?').run(sess.token);return json(res,200,bootstrap({...sess,revealed:0}));}
  if(route==='/api/integrity'&&req.method==='GET'){
   if(sess.actor.startsWith('cu-'))return json(res,403,{error:'Internal record only'});let prev='genesis',ok=true;for(const r of db.prepare('SELECT * FROM audit ORDER BY revision').all()){if(r.previous_hash!==prev||r.sha256!==hash(prev+r.body))ok=false;prev=r.sha256;}return json(res,200,{auditChainValid:ok,events:readState().audit.length,head:prev,packetSHA256:packetHash});
  }
  return json(res,404,{error:'API route not found'});
 }
 const files={'/':'index.html','/index.html':'index.html','/core.js':'core.js','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
 const file=files[route];if(!file)return json(res,404,{error:'Not found'});const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';headers(res,{'Content-Type':mime+'; charset=utf-8'});fs.createReadStream(path.join(ROOT,'public',file)).pipe(res);
 }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e.message});else res.end();}});
server.listen(PORT,HOST,()=>console.log(`TRACE is running on http://localhost:${PORT} | SQLite: ${STORE} | packet SHA-256: ${packetHash}`));
function close(){for(const s of sessions)s.end();server.close(()=>{db.close();process.exit(0);});}
process.on('SIGTERM',close);process.on('SIGINT',close);
