const express = require('express');
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'hearme.sqlite');
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS telemetry (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 source TEXT, battery_voltage REAL, battery_percent REAL, free_psram INTEGER, total_psram INTEGER,
 rms REAL, peak REAL, latency_ms REAL, uptime_ms INTEGER, firmware TEXT, wifi_rssi INTEGER, wifi_ip TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS detections (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 event TEXT NOT NULL, confidence REAL NOT NULL, latency_ms REAL, haptic_pattern TEXT, source TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS inferences (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 total_inferences INTEGER, inference_ms REAL, predicted_class TEXT, confidence REAL, source TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS commands (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 command TEXT, status TEXT, source TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS experiments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, notes TEXT, metadata TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.svg', (req,res)=>res.sendFile(path.join(__dirname,'public','favicon.svg')));
const safeNum = v => Number.isFinite(Number(v)) ? Number(v) : null;
const broadcast = (obj, except) => { const msg=JSON.stringify(obj); for(const c of wss.clients) if(c!==except && c.readyState===WebSocket.OPEN) c.send(msg); };
let device = null;
function deviceStatus(){ return {type:'device_status',connected:!!device,ip:device?.ip||null,rssi:device?.rssi??null}; }
server.on('upgrade',(req,socket,head)=>{
 const parsedUrl=new URL(req.url,'http://localhost'); const pathname=parsedUrl.pathname;
 if(pathname!='/device' && pathname!='/dashboard'){socket.destroy();return;}
 const expectedToken=process.env.DEVICE_TOKEN; if(pathname==='/device' && expectedToken && parsedUrl.searchParams.get('token')!==expectedToken){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();return;}
 wss.handleUpgrade(req,socket,head,ws=>{ws.route=pathname;wss.emit('connection',ws,req);});
});
wss.on('connection',(ws,req)=>{
 if(ws.route==='/device'){
  device=ws; ws.ip=req.socket.remoteAddress; ws.rssi=null; broadcast(deviceStatus());
  ws.on('message',raw=>{
   const line=raw.toString(); for(const part of line.split(/\r?\n/)){if(!part.trim())continue;let p;try{p=JSON.parse(part)}catch{continue;}
    if(p.type==='telemetry'){if(p.wifi_rssi!=null)ws.rssi=safeNum(p.wifi_rssi);if(p.wifi_ip)ws.ip=p.wifi_ip;}
    broadcast(p,ws);
   }
  });
  ws.on('close',()=>{if(device===ws)device=null;broadcast(deviceStatus());});
 } else { ws.send(JSON.stringify(deviceStatus())); ws.on('message',raw=>{let p;try{p=JSON.parse(raw.toString())}catch{return;} if(p.type==='command' && device?.readyState===WebSocket.OPEN) device.send(JSON.stringify(p));}); }
});
app.get('/api/health',(req,res)=>res.json({ok:true,database:'sqlite',deviceConnected:!!device}));
app.get('/api/config',(req,res)=>res.json({deviceWsUrl:process.env.DEVICE_WS_URL||'ws://192.168.4.1/device'}));
app.get('/api/stats',(req,res)=>res.json({detections:db.prepare('SELECT COUNT(*) n FROM detections').get().n,inferenceWindows:db.prepare('SELECT COALESCE(MAX(total_inferences),COUNT(*)) n FROM inferences').get().n,telemetryRows:db.prepare('SELECT COUNT(*) n FROM telemetry').get().n,experiments:db.prepare('SELECT COUNT(*) n FROM experiments').get().n}));
app.delete('/api/detections',(req,res)=>{const info=db.prepare('DELETE FROM detections').run();res.json({deleted:info.changes});});
app.get('/api/detections',(req,res)=>{const limit=Math.min(1000,Math.max(1,Number(req.query.limit)||200));res.json(db.prepare('SELECT * FROM detections ORDER BY id DESC LIMIT ?').all(limit));});
app.post('/api/detections',(req,res)=>{const p=req.body||{};if(typeof p.event!=='string'||!Number.isFinite(Number(p.confidence)))return res.status(400).json({error:'event and confidence are required'});const info=db.prepare('INSERT INTO detections(event,confidence,latency_ms,haptic_pattern,source,payload) VALUES(?,?,?,?,?,?)').run(p.event,Number(p.confidence),safeNum(p.latency_ms),p.haptic_pattern||null,p.source||'device',JSON.stringify(p));res.status(201).json({id:info.lastInsertRowid});});
app.post('/api/inference',(req,res)=>{const p=req.body||{};const info=db.prepare('INSERT INTO inferences(total_inferences,inference_ms,predicted_class,confidence,source,payload) VALUES(?,?,?,?,?,?)').run(safeNum(p.total_inferences),safeNum(p.inference_ms??p.latency_ms),p.predicted_class||p.event||null,safeNum(p.confidence),p.source||'device',JSON.stringify(p));res.status(201).json({id:info.lastInsertRowid});});
app.post('/api/telemetry',(req,res)=>{const p=req.body||{};const info=db.prepare('INSERT INTO telemetry(source,battery_voltage,battery_percent,free_psram,total_psram,rms,peak,latency_ms,uptime_ms,firmware,wifi_rssi,wifi_ip,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.source||'device',safeNum(p.battery_voltage),safeNum(p.battery_percent),safeNum(p.free_psram),safeNum(p.total_psram),safeNum(p.rms),safeNum(p.peak),safeNum(p.latency_ms),safeNum(p.uptime_ms),p.firmware||null,safeNum(p.wifi_rssi),p.wifi_ip||null,JSON.stringify(p));res.status(201).json({id:info.lastInsertRowid});});
app.post('/api/commands/log',(req,res)=>{const p=req.body||{};const info=db.prepare('INSERT INTO commands(command,status,source,payload) VALUES(?,?,?,?)').run(p.command||null,p.status||null,p.source||'device',JSON.stringify(p));res.status(201).json({id:info.lastInsertRowid});});
app.get('/api/experiments',(req,res)=>res.json(db.prepare('SELECT * FROM experiments ORDER BY id DESC LIMIT 200').all().map(x=>({...x,metadata:JSON.parse(x.metadata||'{}')}))));
app.post('/api/experiments',(req,res)=>{const p=req.body||{};if(!String(p.name||'').trim())return res.status(400).json({error:'Experiment name is required'});const info=db.prepare('INSERT INTO experiments(name,notes,metadata) VALUES(?,?,?)').run(String(p.name).slice(0,120),String(p.notes||'').slice(0,2000),JSON.stringify(p.metadata||{}));res.status(201).json({id:info.lastInsertRowid});});
app.get('/api/export',(req,res)=>{const tables=['telemetry','detections','inferences','commands','experiments','settings'];const result={exportedAt:new Date().toISOString(),database:'HearMe SQLite',tables:{}};for(const t of tables)result.tables[t]=db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();res.json(result);});
app.get('/api/telemetry/latest',(req,res)=>res.json(db.prepare('SELECT * FROM telemetry ORDER BY id DESC LIMIT 1').get()||{}));
app.get('/api/commands',(req,res)=>res.json(db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT 100').all()));
app.listen(PORT,'0.0.0.0',()=>console.log(`HearMe dashboard: http://localhost:${PORT}\nSQLite: ${DB_PATH}`));
