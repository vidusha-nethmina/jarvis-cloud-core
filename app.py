import os, time, secrets, threading
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'Remote_Web'
app = Flask(__name__, static_folder=None)

OWNER_PASSWORD = os.getenv('JARVIS_OWNER_PASSWORD','').strip()
DEVICE_TOKEN = os.getenv('JARVIS_DEVICE_TOKEN','').strip()
PC_TOKEN = os.getenv('JARVIS_PC_TOKEN','').strip()
SESSION_TTL = 86400 * 30
_lock = threading.RLock()
_sessions = {}
_room_queue = []
_pc_queue = []
_room_state = {'online': False, 'light':'unknown','light_mode':1,'fan':'off','fan_speed':0,'last_seen':0}
_pc_state = {'online': False, 'last_seen':0}


def _clean_sessions():
    now=time.time()
    for k,v in list(_sessions.items()):
        if v < now: _sessions.pop(k,None)

def _auth():
    tok=request.headers.get('Authorization','').replace('Bearer ','').strip()
    with _lock:
        _clean_sessions(); return bool(tok and tok in _sessions)

def _device_auth(): return bool(DEVICE_TOKEN and secrets.compare_digest(request.headers.get('X-Device-Token',''), DEVICE_TOKEN))
def _pc_auth(): return bool(PC_TOKEN and secrets.compare_digest(request.headers.get('X-PC-Token',''), PC_TOKEN))

def _room_cmd(text):
    t=' '.join((text or '').lower().replace("'",' ').split())
    if any(x in t for x in ['good night','going to sleep','sleep mode','bedtime']): return [('light_off',None),('fan_speed',3)], 'Sleep mode activated.'
    if 'light' in t and ('off' in t or 'of' in t): return [('light_off',None)], 'Room light off.'
    if 'light' in t and ('on' in t): return [('light_on',None)], 'Room light on.'
    if 'light' in t and ('mode' in t or 'mood' in t):
        for n,w in [(3,'three'),(2,'two'),(1,'one')]:
            if str(n) in t or w in t: return [('light_mode',n)], f'Light mode {n}.'
    if ('fan' in t or 'fun' in t) and ('off' in t or 'stop' in t): return [('fan_off',None)], 'Fan off.'
    if ('fan' in t or 'fun' in t) and ('speed' in t or 'speet' in t):
        for n,w in [(3,'three'),(2,'two'),(1,'one')]:
            if str(n) in t or w in t: return [('fan_speed',n)], f'Fan speed {n}.'
    return None, None

@app.get('/')
def index(): return send_from_directory(WEB,'index.html')
@app.get('/<path:p>')
def assets(p):
    fp=WEB/p
    if fp.exists() and fp.is_file(): return send_from_directory(WEB,p)
    return send_from_directory(WEB,'index.html')

@app.post('/api/login')
def login():
    if not OWNER_PASSWORD: return jsonify(ok=False,error='Owner password not configured on cloud server.'),503
    b=request.get_json(silent=True) or {}
    if not secrets.compare_digest(str(b.get('password','')),OWNER_PASSWORD): return jsonify(ok=False,error='Invalid password.'),403
    tok=secrets.token_urlsafe(32)
    with _lock: _sessions[tok]=time.time()+SESSION_TTL
    return jsonify(ok=True,token=tok,face_required=False,cloud=True)

@app.get('/api/status')
def status():
    if not _auth(): return jsonify(ok=False,error='Unauthorized'),401
    now=time.time()
    with _lock:
        room=dict(_room_state); pc=dict(_pc_state)
    room['online']=bool(now-room.get('last_seen',0)<20)
    pc['online']=bool(now-pc.get('last_seen',0)<20)
    return jsonify(ok=True,cloud=True,room=room,pc=pc,pc_online=pc['online'])

@app.get('/api/room/status')
def room_status():
    if not _auth(): return jsonify(ok=False,error='Unauthorized'),401
    now=time.time(); st=dict(_room_state); st['online']=bool(now-st.get('last_seen',0)<20)
    return jsonify(ok=True,enabled=True,name='My Room',**st)

@app.post('/api/room/action')
def room_action():
    if not _auth(): return jsonify(ok=False,error='Unauthorized'),401
    b=request.get_json(silent=True) or {}; a=str(b.get('action','')); v=b.get('value')
    if a not in {'light_on','light_off','light_next_mode','light_mode','fan_off','fan_speed'}: return jsonify(ok=False,error='Invalid action'),400
    with _lock: _room_queue.append({'id':secrets.token_hex(8),'action':a,'value':v,'ts':time.time()})
    return jsonify(ok=True,queued=True,action=a,value=v)

@app.post('/api/command')
def command():
    if not _auth(): return jsonify(ok=False,error='Unauthorized'),401
    b=request.get_json(silent=True) or {}; text=str(b.get('text','')).strip()
    acts,msg=_room_cmd(text)
    if acts:
        with _lock:
            for a,v in acts: _room_queue.append({'id':secrets.token_hex(8),'action':a,'value':v,'ts':time.time()})
        return jsonify(ok=True,reply=msg,route='cloud-room')
    with _lock:
        _pc_queue.append({'id':secrets.token_hex(8),'text':text,'ts':time.time()})
        pc_online=(time.time()-_pc_state.get('last_seen',0)<20)
    if not pc_online: return jsonify(ok=True,reply='Home PC is offline. Smart-room commands still work.',route='pc-offline')
    return jsonify(ok=True,reply='Sent to your home PC.',route='pc')

@app.get('/api/device/poll')
def device_poll():
    if not _device_auth(): return jsonify(ok=False,error='Unauthorized'),401
    with _lock:
        cmd=_room_queue.pop(0) if _room_queue else None
    return jsonify(ok=True,command=cmd)

@app.post('/api/device/status')
def device_status():
    if not _device_auth(): return jsonify(ok=False,error='Unauthorized'),401
    b=request.get_json(silent=True) or {}
    with _lock:
        for k in ['light','light_mode','fan','fan_speed']:
            if k in b: _room_state[k]=b[k]
        _room_state['last_seen']=time.time(); _room_state['online']=True
    return jsonify(ok=True)

@app.get('/api/pc/poll')
def pc_poll():
    if not _pc_auth(): return jsonify(ok=False,error='Unauthorized'),401
    with _lock:
        _pc_state['online']=True; _pc_state['last_seen']=time.time(); cmd=_pc_queue.pop(0) if _pc_queue else None
    return jsonify(ok=True,command=cmd)

@app.post('/api/pc/result')
def pc_result():
    if not _pc_auth(): return jsonify(ok=False,error='Unauthorized'),401
    with _lock: _pc_state['online']=True; _pc_state['last_seen']=time.time()
    return jsonify(ok=True)

if __name__=='__main__':
    app.run(host='0.0.0.0',port=int(os.getenv('PORT','8780')))
