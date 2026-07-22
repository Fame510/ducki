/* DUCKi Rooms by AEON DUX — P2P video mesh via PeerJS.
   Host's peer id = room code. Host approves joiners, can kick. Max 6. */
(function () {
  'use strict'
  var MAX = 6
  var $ = function (id) { return document.getElementById(id) }
  var peer = null            // our PeerJS peer
  var myId = null
  var myNick = ''
  var isHost = false
  var hostId = null          // the room code
  var localStream = null
  var conns = {}             // peerId -> DataConnection
  var calls = {}             // peerId -> MediaConnection
  var members = {}           // peerId -> { nick, host }
  var pending = {}           // host-only: peerId -> { nick, conn }

  /* ---------- global live lobby via Supabase Realtime Presence (no tables/SQL) ---------- */
  var sb = null, lobbyCh = null, presReady = false, myRoomCode = null
  var presKey = 'p' + Math.random().toString(36).slice(2, 9)
  function myAlias() { var n = ($('nick') && $('nick').value || '').trim(); return n || ('Duck' + presKey.slice(-3).toUpperCase()) }
  function lobbyState() { return (lobbyCh && lobbyCh.presenceState && lobbyCh.presenceState()) || {} }
  function trackPres() { if (lobbyCh && presReady) { try { lobbyCh.track({ alias: myAlias(), room: myRoomCode, ts: Date.now() }) } catch (e) {} } }
  function renderLobbyLive() {
    var st = lobbyState(), people = [], rooms = {}
    Object.keys(st).forEach(function (k) { var m = st[k] && st[k][0]; if (!m) return; people.push(m.alias || 'Duck'); if (m.room) rooms[m.room] = (rooms[m.room] || 0) + 1 })
    var n = people.length, rc = Object.keys(rooms).length
    var t = $('lobbyLiveText')
    if (t) t.textContent = n + (n === 1 ? ' duck' : ' ducks') + ' online now' + (rc ? (' \u00b7 ' + rc + (rc === 1 ? ' house' : ' houses') + ' live') : ' \u00b7 be the first to open a house')
    var box = $('onlineAliases')
    if (box) box.innerHTML = people.slice(0, 40).map(function (a) { return '<span style="background:#0a0f1e;border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--cyan)">' + escapeHtml(a) + '</span>' }).join('')
  }
  function openRooms() { // rooms with 1..MAX-1 ducks, fullest first (fill before spawning a new one)
    var st = lobbyState(), rooms = {}
    Object.keys(st).forEach(function (k) { var m = st[k] && st[k][0]; if (m && m.room) rooms[m.room] = (rooms[m.room] || 0) + 1 })
    return Object.keys(rooms).filter(function (r) { return rooms[r] > 0 && rooms[r] < MAX }).sort(function (a, b) { return rooms[b] - rooms[a] })
  }
  function autoJoin() {
    myNick = ($('nick').value || '').trim() || ('Guest' + rand(3))
    var open = openRooms()
    if (open.length) { toast('Found an open house \u2014 asking the host to let you in\u2026'); joinRoom(open[0].replace('DUCKI-', '')) }
    else { toast('No open houses right now \u2014 opening a fresh one. You\u2019re the host.'); createRoom() }
  }
  function lobbyConnect() {
    var cfg = window.DUCKHOUSE_SB
    var t = $('lobbyLiveText')
    if (!cfg || !cfg.url || !cfg.key) { if (t) t.textContent = 'Live lobby not configured.'; return }
    import('https://esm.run/@supabase/supabase-js@2').then(function (M) {
      sb = M.createClient(cfg.url, cfg.key, { realtime: { params: { eventsPerSecond: 5 } } })
      lobbyCh = sb.channel('duckhouse-lobby', { config: { presence: { key: presKey } } })
      lobbyCh.on('presence', { event: 'sync' }, renderLobbyLive)
      lobbyCh.on('presence', { event: 'join' }, renderLobbyLive)
      lobbyCh.on('presence', { event: 'leave' }, renderLobbyLive)
      lobbyCh.subscribe(function (status) { if (status === 'SUBSCRIBED') { presReady = true; trackPres() } })
    }).catch(function (e) { console.error(e); if (t) t.textContent = 'Live lobby unavailable right now.' })
  }


  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg
    $('toasts').appendChild(t); setTimeout(function () { t.style.opacity = '0'; setTimeout(function(){ t.remove() }, 400) }, 4200)
  }
  function rand(n) { var s = '', a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for (var i=0;i<n;i++) s += a[Math.floor(Math.random()*a.length)]; return s }
  function updateLive() {
    var n = Object.keys(members).length
    $('liveCount').textContent = n + (n === 1 ? ' person live' : ' people live') + ' / ' + MAX
    renderRoster()
  }
  function renderRoster() {
    var box = document.getElementById('roster'); if (!box) return
    var ids = Object.keys(members)
    box.innerHTML = '<div class="roster-title">In the house (' + ids.length + '/' + MAX + ')</div>' +
      ids.map(function (id) {
        var m = members[id]
        return '<div class="roster-row">' +
          '<span class="dot-live"></span>' +
          '<span class="rn">' + escapeHtml(m.nick) + (id === myId ? ' (you)' : '') + '</span>' +
          (m.host ? '<span class="host-badge">HOST</span>' : '') +
          ((isHost && id !== myId) ? '<button class="rkick" data-rk="' + id + '">remove</button>' : '') +
          '</div>'
      }).join('')
    Array.prototype.forEach.call(box.querySelectorAll('[data-rk]'), function (b) {
      b.addEventListener('click', function () { kick(b.getAttribute('data-rk')) })
    })
  }

  // ---------- media ----------
  function getMedia() {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(function (s) { localStream = s; addTile(myId, myNick, true, isHost); attachStream(myId, s); return s })
  }
  function attachStream(id, stream) {
    var v = document.querySelector('[data-vid="' + id + '"]')
    if (!v) { // tile not built yet — create a placeholder tile then retry once
      var nick = (members[id] && members[id].nick) || 'Guest'
      addTile(id, nick, id === myId, members[id] && members[id].host)
      v = document.querySelector('[data-vid="' + id + '"]')
    }
    if (v) { v.srcObject = stream; v.play && v.play().catch(function(){}) }
  }
  function addTile(id, nick, you, host) {
    if (document.querySelector('[data-tile="' + id + '"]')) return
    var d = document.createElement('div'); d.className = 'tile' + (you ? ' you' : ''); d.setAttribute('data-tile', id)
    d.innerHTML = '<video data-vid="' + id + '" autoplay playsinline ' + (you ? 'muted' : '') + '></video>' +
      '<div class="name">' + (host ? '<span class="host-badge">HOST</span>' : '') + '<span>' + escapeHtml(nick) + (you ? ' (you)' : '') + '</span></div>' +
      ((isHost && !you) ? '<button class="kick" data-kick="' + id + '">Kick</button>' : '')
    $('tiles').appendChild(d)
    var kb = d.querySelector('[data-kick]'); if (kb) kb.addEventListener('click', function () { kick(id) })
  }
  function removeTile(id) { var d = document.querySelector('[data-tile="' + id + '"]'); if (d) d.remove() }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c] }) }

  // ---------- signaling messages over data channels ----------
  function send(conn, type, data) { try { conn.send(JSON.stringify({ type: type, data: data || {} })) } catch (e) {} }
  function broadcast(type, data) { Object.keys(conns).forEach(function (id) { send(conns[id], type, data) }) }

  function wireConn(conn) {
    conn.on('data', function (raw) {
      var msg; try { msg = JSON.parse(raw) } catch (e) { return }
      handleMessage(conn, msg)
    })
    conn.on('close', function () { dropPeer(conn.peer) })
    conn.on('error', function () { dropPeer(conn.peer) })
  }

  function handleMessage(conn, msg) {
    var d = msg.data || {}
    switch (msg.type) {
      case 'join_request': // host receives
        if (!isHost) return
        if (Object.keys(members).length >= MAX) { send(conn, 'rejected', { reason: 'Room is full (6 max).' }); return }
        pending[conn.peer] = { nick: d.nick || 'Guest', conn: conn }
        renderRequests(); toast(d.nick + ' wants to join'); break
      case 'approved': // joiner receives from host
        hostId = d.hostId; members = d.members || {}; members[myId] = { nick: myNick, host: false }
        enterRoom(); d.peers.forEach(function (p) { if (p !== myId) { connectToPeer(p); callPeer(p) } }); updateLive(); toast('You are in!'); break
      case 'rejected':
        toast('Join refused: ' + (d.reason || 'host declined')); cleanup(); showLobby(); break
      case 'roster': // host broadcasts membership changes
        members = d.members || members; syncTiles(); updateLive(); break
      case 'hello': // peer announces nick after mesh connect
        members[conn.peer] = { nick: d.nick, host: !!d.host }; if (!document.querySelector('[data-tile="'+conn.peer+'"]')) addTile(conn.peer, d.nick, false, !!d.host); updateLive(); callPeer(conn.peer); break
      case 'kicked':
        toast('You were removed by the host.'); cleanup(); showLobby(); break
      case 'kick_peer': // host tells everyone to drop someone
        if (d.id === myId) { toast('You were removed by the host.'); cleanup(); showLobby(); return }
        dropPeer(d.id); break
    }
  }

  // ---------- host: approve / reject / kick ----------
  function renderRequests() {
    var box = $('requests'); box.innerHTML = ''
    Object.keys(pending).forEach(function (pid) {
      var p = pending[pid]
      var row = document.createElement('div'); row.className = 'req'
      row.innerHTML = '<span class="nm">' + escapeHtml(p.nick) + '</span>'
      var ok = document.createElement('button'); ok.className = 'btn-primary'; ok.textContent = 'Admit'
      var no = document.createElement('button'); no.className = 'btn-danger'; no.textContent = 'Reject'
      ok.onclick = function () { approve(pid) }; no.onclick = function () { reject(pid) }
      row.appendChild(ok); row.appendChild(no); box.appendChild(row)
    })
    $('hostPanel').classList.toggle('hidden', Object.keys(pending).length === 0)
  }
  function approve(pid) {
    var p = pending[pid]; if (!p) return
    if (Object.keys(members).length >= MAX) { send(p.conn, 'rejected', { reason: 'Room is full.' }); delete pending[pid]; renderRequests(); return }
    members[pid] = { nick: p.nick, host: false }
    var peers = Object.keys(members)
    send(p.conn, 'approved', { hostId: myId, members: members, peers: peers })
    conns[pid] = p.conn; wireConn(p.conn)
    delete pending[pid]; renderRequests(); broadcast('roster', { members: members }); syncTiles(); updateLive()
    callPeer(pid) // host -> joiner media call (this direction was missing)
    toast(p.nick + ' admitted')
  }
  function reject(pid) { var p = pending[pid]; if (p) { send(p.conn, 'rejected', { reason: 'Host declined.' }); delete pending[pid]; renderRequests() } }
  function kick(id) {
    if (!isHost) return
    broadcast('kick_peer', { id: id })
    if (conns[id]) send(conns[id], 'kicked', {})
    dropPeer(id); delete members[id]; broadcast('roster', { members: members }); updateLive()
  }

  // ---------- mesh ----------
  // Robust, bidirectional media call: safe to call from either side, dedupes,
  // and never places a call with a null stream (waits for local media first).
  function callPeer(pid) {
    if (pid === myId) return
    if (!localStream) { // local media not ready yet — retry shortly
      setTimeout(function () { callPeer(pid) }, 250); return
    }
    if (calls[pid]) return // already have a media connection to this peer
    var call = peer.call(pid, localStream)
    if (call) {
      calls[pid] = call
      call.on('stream', function (rs) { ensureRemote(pid, rs) })
      call.on('close', function () { delete calls[pid] })
      call.on('error', function () { delete calls[pid] })
    }
  }
  function connectToPeer(pid) {
    if (pid === myId || conns[pid]) return
    var c = peer.connect(pid, { reliable: true })
    c.on('open', function () { conns[pid] = c; wireConn(c); send(c, 'hello', { nick: myNick, host: isHost }); callPeer(pid) })
  }
  function ensureRemote(pid, stream) {
    var nick = (members[pid] && members[pid].nick) || 'Guest'
    if (!document.querySelector('[data-tile="' + pid + '"]')) addTile(pid, nick, false, members[pid] && members[pid].host)
    attachStream(pid, stream)
  }
  function syncTiles() {
    Object.keys(members).forEach(function (id) {
      if (id === myId) return
      if (!document.querySelector('[data-tile="' + id + '"]')) addTile(id, members[id].nick, false, members[id].host)
    })
  }
  function dropPeer(id) {
    if (conns[id]) { try { conns[id].close() } catch (e) {} delete conns[id] }
    if (calls[id]) { try { calls[id].close() } catch (e) {} delete calls[id] }
    delete members[id]; removeTile(id); updateLive()
  }

  // ---------- lifecycle ----------
  function makePeer() {
    return new Promise(function (resolve, reject) {
      var ICE = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
      }
      var p = new Peer(isHost ? ('DUCKI-' + rand(6)) : undefined, { config: ICE })
      p.on('open', function (id) { peer = p; myId = id; resolve(id) })
      p.on('error', function (e) { toast('Connection error: ' + (e.type || e.message || 'unknown')); reject(e) })
      p.on('connection', function (conn) { conn.on('open', function () { wireConn(conn) }) }) // incoming data
      p.on('call', function (call) {
        function doAnswer() {
          if (!localStream) { setTimeout(doAnswer, 250); return }
          call.answer(localStream)
          calls[call.peer] = call
          call.on('stream', function (rs) { ensureRemote(call.peer, rs) })
          call.on('close', function () { delete calls[call.peer] })
          call.on('error', function () { delete calls[call.peer] })
        }
        doAnswer()
      })
    })
  }

  function createRoom() {
    isHost = true
    makePeer().then(function (id) {
      hostId = id; members[id] = { nick: myNick, host: true }
      return getMedia()
    }).then(function () {
      enterRoom(); $('roomCode').textContent = myId.replace('DUCKI-', ''); fullCode = myId; updateLive()
      toast('Room created. Share the code to invite people.')
    }).catch(function (e) { toast('Could not start camera/room: ' + (e.message || e)); showLobby() })
  }

  var fullCode = ''
  function inviteURL () {
    var code = ($('roomCode').textContent || '').trim()
    return location.origin + location.pathname + '?room=' + encodeURIComponent(code)
  }
  function joinRoom(code) {
    isHost = false
    var target = code.indexOf('DUCKI-') === 0 ? code : ('DUCKI-' + code)
    makePeer().then(function () { return getMedia() }).then(function () {
      var c = peer.connect(target, { reliable: true })
      c.on('open', function () { wireConn(c); conns[target] = c; send(c, 'join_request', { nick: myNick }); toast('Asked the host to let you in…') })
      c.on('error', function () { toast('Room not found or host offline.'); cleanup(); showLobby() })
      setTimeout(function () { if (!document.querySelector('#room').offsetParent && Object.keys(members).length === 0) { /* still waiting */ } }, 1)
    }).catch(function (e) { toast('Could not start camera: ' + (e.message || e)); showLobby() })
  }

  function enterRoom() {
    $('lobby').classList.add('hidden'); $('room').classList.remove('hidden')
    myRoomCode = (fullCode || hostId || myId || null); trackPres()
    $('roomCode').textContent = (fullCode || hostId || myId || '').replace('DUCKI-', '')
    $('hostPanel').classList.toggle('hidden', !isHost)
    $('roomHint').textContent = isHost ? 'You are the host. Approve join requests above; hover a tile to kick someone.' : 'Connected. Anyone can leave anytime; the host moderates the room.'
  }
  function showLobby() { $('room').classList.add('hidden'); $('lobby').classList.remove('hidden'); $('liveCount').textContent = 'in lobby'; myRoomCode = null; trackPres() }
  function cleanup() {
    Object.keys(conns).forEach(function (id){ try{conns[id].close()}catch(e){} })
    Object.keys(calls).forEach(function (id){ try{calls[id].close()}catch(e){} })
    if (localStream) localStream.getTracks().forEach(function (t){ t.stop() })
    if (peer) { try { peer.destroy() } catch (e) {} }
    peer=null; conns={}; calls={}; members={}; pending={}; isHost=false; localStream=null; myRoomCode=null
    $('tiles').innerHTML=''; $('requests').innerHTML=''
  }

  // ---------- controls ----------
  function init() {
    $('createBtn').onclick = function () {
      myNick = ($('nick').value || '').trim() || ('Guest' + rand(3)); createRoom()
    }
    $('joinBtn').onclick = function () {
      myNick = ($('nick').value || '').trim() || ('Guest' + rand(3))
      var code = ($('roomInput').value || '').trim().toUpperCase(); if (!code) { toast('Enter a room code to join.'); return }
      joinRoom(code)
    }
    $('copyCode').onclick = function () {
      var url = inviteURL()
      if (navigator.clipboard) navigator.clipboard.writeText(url)
      toast('Invite link copied — paste it to anyone.')
    }
    if ($('shareBtn')) $('shareBtn').onclick = function () {
      var url = inviteURL(), code = $('roomCode').textContent
      var text = 'Come join me live in The Duck House 🦆 — room ' + code
      if (navigator.share) { navigator.share({ title: 'The Duck House', text: text, url: url }).catch(function () {}) }
      else if (navigator.clipboard) { navigator.clipboard.writeText(url); toast('Invite link copied — text it to a friend.') }
      else { toast(url) }
    }
    $('leaveBtn').onclick = function () { if (isHost) broadcast('kick_peer', { id: '__host_left__' }); cleanup(); showLobby() }
    $('micBtn').onclick = function () {
      if (!localStream) return; var a = localStream.getAudioTracks()[0]; if (!a) return
      a.enabled = !a.enabled; $('micBtn').textContent = a.enabled ? '🎤 Mute' : '🔇 Unmute'
    }
    $('camBtn').onclick = function () {
      if (!localStream) return; var v = localStream.getVideoTracks()[0]; if (!v) return
      v.enabled = !v.enabled; $('camBtn').textContent = v.enabled ? '📷 Camera off' : '📷 Camera on'
    }
    // Invited via a shared link (?room=CODE): prefill the code and prompt for a nickname.
    try {
      var invited = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase()
      if (invited) {
        $('roomInput').value = invited
        var b = $('inviteBanner')
        if (b) { b.classList.remove('hidden'); b.innerHTML = '🎉 You’ve been invited to room <b>' + escapeHtml(invited) + '</b>. Enter a nickname, then tap <b>Join</b>.' }
        var nk = $('nick'); if (nk) nk.focus()
      }
    } catch (e) {}
    if ($('autoBtn')) $('autoBtn').onclick = autoJoin
    if ($('nick')) $('nick').addEventListener('change', trackPres)
    lobbyConnect()
    window.addEventListener('beforeunload', cleanup)
    matrix()
  }

  // ---------- matrix bg ----------
  function matrix() {
    var c = document.getElementById('matrixfx'); if (!c) return; var ctx = c.getContext('2d')
    var font = 16, cols, drops, glyphs = 'アカサタナ0123456789ABCDEFDUCKi'.split('')
    function resize(){ c.width=innerWidth; c.height=innerHeight; cols=Math.floor(c.width/font); drops=[]; for(var i=0;i<cols;i++) drops[i]=Math.random()*-50 }
    function draw(){ ctx.fillStyle='rgba(8,12,24,0.10)'; ctx.fillRect(0,0,c.width,c.height); ctx.font=font+'px monospace'
      for(var i=0;i<cols;i++){ var ch=glyphs[Math.floor(Math.random()*glyphs.length)]; ctx.fillStyle=Math.random()>0.975?'#f5a623':'#4fc3f7'; ctx.fillText(ch,i*font,drops[i]*font); if(drops[i]*font>c.height&&Math.random()>0.975)drops[i]=0; drops[i]+=0.5 } requestAnimationFrame(draw) }
    resize(); addEventListener('resize',resize)
    if(!matchMedia||!matchMedia('(prefers-reduced-motion: reduce)').matches) draw()
  }

  document.addEventListener('DOMContentLoaded', init)
})();