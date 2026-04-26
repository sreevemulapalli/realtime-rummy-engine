const firebaseConfig = {
  apiKey: "AIzaSyAVQknzxepDf6v_8cZZ-KFvqdfDrGjDQUo",
  authDomain: "rummy-8907c.firebaseapp.com",
  databaseURL: "https://rummy-8907c-default-rtdb.firebaseio.com",
  projectId: "rummy-8907c",
  storageBucket: "rummy-8907c.firebasestorage.app",
  messagingSenderId: "194566357669",
  appId: "1:194566357669:web:d2100cf6dcae71123e434c",
  measurementId: "G-NJE31HJQ4M"
};

// Initialize Firebase using compat mode
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
let currentRoom = localStorage.getItem('rummy_room') || null;
let myPlayerId = localStorage.getItem('rummy_playerId') || null;
let localGroups = new Set(["0"]); // Set of group IDs
let currentHandData = [];
if (!myPlayerId) {
  myPlayerId = Math.random().toString(36).substr(2, 9);
  localStorage.setItem('rummy_playerId', myPlayerId);
}

let myPlayerName = localStorage.getItem('multi_playerName');

document.addEventListener('DOMContentLoaded', () => {
  if (!myPlayerName) {
    do {
      myPlayerName = prompt("What is your display name?");
    } while (!myPlayerName);
    localStorage.setItem('multi_playerName', myPlayerName);
  }
});

// UI Elements
const statusEl = document.getElementById('connection-status');
const lobbySec = document.getElementById('lobby-section');
const gameSec = document.getElementById('game-section');
const roomCodeInput = document.getElementById('input-room-code');

document.getElementById('btn-create-room').addEventListener('click', createRoom);
document.getElementById('btn-join-room').addEventListener('click', joinRoom);
document.getElementById('btn-leave-room').addEventListener('click', leaveRoom);
document.getElementById('btn-start-game').addEventListener('click', startGame);
document.getElementById('btn-vote-valid').addEventListener('click', () => submitVote('valid'));
document.getElementById('btn-vote-invalid').addEventListener('click', () => submitVote('invalid'));
document.getElementById('btn-drop').addEventListener('click', dropHand);
document.getElementById('btn-finalize-scores').addEventListener('click', finalizeScores);
document.getElementById('btn-next-round').addEventListener('click', startGame);

// Connection test
db.ref(".info/connected").on('value', (snap) => {
  if (snap.val() === true) {
    if (!currentRoom) statusEl.textContent = `Hello, ${myPlayerName || 'Player'}. Connected to servers 🟢`;
  } else {
    statusEl.textContent = 'Disconnected 🔴';
  }
});

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

async function createRoom() {
  const code = generateRoomCode();
  const roomRef = db.ref(`rooms/${code}`);
  
  try {
    await roomRef.set({
      status: 'waiting',
      host: myPlayerId,
      players: {
        [myPlayerId]: { name: myPlayerName }
      }
    });
    enterRoom(code);
  } catch (e) {
    alert("Database Error: " + e.message + "\n\nDid you forget to set the Database Rules to purely 'true'?");
  }
}

async function joinRoom() {
  const code = roomCodeInput.value.trim().toUpperCase();
  if(!code) return alert("Enter a room code!");
  
  try {
    const roomRef = db.ref(`rooms/${code}`);
    const snap = await roomRef.get();
    
    if (snap.exists() && snap.val().status === 'waiting') {
      await db.ref(`rooms/${code}/players/${myPlayerId}`).set({
        name: myPlayerName
      });
      enterRoom(code);
      roomCodeInput.value = '';
    } else {
      alert("Room not found or game already started.");
    }
  } catch (e) {
    alert("Database Error: " + e.message);
  }
}

function enterRoom(code) {
  currentRoom = code;
  localStorage.setItem('rummy_playerId', myPlayerId);
  localStorage.setItem('rummy_room', currentRoom);
  
  lobbySec.classList.add('hidden');
  gameSec.classList.remove('hidden');
  document.getElementById('room-code-display').textContent = `Room: ${code}`;
  statusEl.textContent = `In Room ${code} 🟢`;
  
  db.ref(`rooms/${code}/players/${myPlayerId}/disconnectedAt`).onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
  
  // Listen for changes to the room
  db.ref(`rooms/${code}`).on('value', (snap) => {
    if(snap.val()) renderRoomState(snap.val());
  });
}

function renderRoomState(data) {
  const now = Date.now();
  // P2P Auto Host Migration Mechanism
  if (data && data.host && data.players && data.players[data.host]) {
     const hData = data.players[data.host];
     if (hData.hasQuit || (hData.disconnectedAt && (now - hData.disconnectedAt > 30000))) {
         let newHost = null;
         if (data.playerOrder) {
            for (let pid of data.playerOrder) {
               const p = data.players[pid];
               if (p && !p.hasQuit && !p.isEliminated && (!p.disconnectedAt || (now - p.disconnectedAt <= 30000))) {
                  newHost = pid; break;
               }
            }
         } else {
            const activeIds = Object.keys(data.players).filter(id => !data.players[id].hasQuit && !data.players[id].disconnectedAt);
            if (activeIds.length > 0) newHost = activeIds[0];
         }
         
         if (newHost === myPlayerId) {
            db.ref(`rooms/${currentRoom}`).update({ 
               host: myPlayerId,
               [`players/${data.host}/hasQuit`]: true
            });
            return; // Halt and wait for my promotion sync
         }
     } else if (hData.disconnectedAt) {
        setTimeout(() => { db.ref(`rooms/${currentRoom}`).once('value', s => { if(s.val()) renderRoomState(s.val()) }); }, 1000);
     }
  }

  if (data.status === 'playing') {
    gameSec.classList.add('hidden');
    document.getElementById('voting-modal').classList.add('hidden');
    document.getElementById('showdown-section').classList.add('hidden');
    document.getElementById('scoreboard-section').classList.add('hidden');
    document.getElementById('play-board-section').classList.remove('hidden');
    renderPlayBoard(data);
  } else if (data.status === 'voting') {
    renderVoting(data);
  } else if (data.status === 'showdown') {
    renderShowdown(data);
  } else if (data.status === 'scoreboard') {
    renderScoreboard(data);
  } else {
    gameSec.classList.remove('hidden');
    document.getElementById('voting-modal').classList.add('hidden');
    document.getElementById('showdown-section').classList.add('hidden');
    document.getElementById('scoreboard-section').classList.add('hidden');
    document.getElementById('play-board-section').classList.add('hidden');
    renderRoomPlayers(data);
  }
}

function renderRoomPlayers(roomData) {
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  
  const players = roomData.players || {};
  Object.keys(players).forEach(pId => {
    const p = players[pId];
    const isHost = pId === roomData.host;
    const isMe = pId === myPlayerId;
    
    list.innerHTML += `
      <div style="padding: 0.75rem; background: var(--panel-bg); margin-bottom: 0.5rem; border-radius: 8px; border: 1px solid var(--panel-border); font-size: 1.1rem; display: flex; justify-content: space-between;">
        <span>${p.name} ${isMe ? '<span style="color:var(--text-muted);font-size:0.8rem;">(You)</span>' : ''}</span>
        ${isHost ? '<span title="Host">👑</span>' : ''}
      </div>
    `;
  });
  
  if(roomData.host === myPlayerId && Object.keys(players).length > 1) {
    document.getElementById('btn-start-game').classList.remove('hidden');
  } else {
    document.getElementById('btn-start-game').classList.add('hidden');
  }
}

async function leaveRoom() {
  const code = currentRoom;
  if (code) {
    db.ref(`rooms/${code}`).off(); // Unhook listener
    try { 
      const snap = await db.ref(`rooms/${code}`).get();
      const data = snap.val();
      if (data && data.status !== 'waiting') {
         await db.ref(`rooms/${code}/players/${myPlayerId}`).update({ hasQuit: true, isEliminated: true });
      } else {
         await db.ref(`rooms/${code}/players/${myPlayerId}`).remove(); 
      }
    } catch(e) {}
    currentRoom = null;
    myPlayerId = null;
    localStorage.removeItem('rummy_room');
    localStorage.removeItem('rummy_playerId');
    location.reload(); // Hard reset
  }
  
  lobbySec.classList.remove('hidden');
  gameSec.classList.add('hidden');
  document.getElementById('play-board-section').classList.add('hidden');
  statusEl.textContent = `Hello, ${myPlayerName}. Connected to servers 🟢`;
}

/* --- GAME ENGINE --- */

const suits = ['♠', '♥', '♦', '♣'];
const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function generateDeck() {
  let deck = [];
  for (let i = 0; i < 2; i++) {
    for (let s of suits) {
      for (let v of values) {
        deck.push({ suit: s, value: v, id: Math.random().toString(36).substr(2, 9) });
      }
    }
  }
  deck.push({ suit: '🃏', value: 'JOKER', id: Math.random().toString(36).substr(2, 9) });
  deck.push({ suit: '🃏', value: 'JOKER', id: Math.random().toString(36).substr(2, 9) });
  
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

window.addEventListener('load', async () => {
   if (currentRoom && myPlayerId) {
       document.getElementById('connection-status').textContent = "Reconnecting to Session...";
       const snap = await db.ref(`rooms/${currentRoom}`).get();
       const data = snap.val();
       
       if (data && data.players && data.players[myPlayerId]) {
           // Successfully found session
           document.getElementById('lobby-section').classList.add('hidden');
           document.getElementById('connection-status').textContent = `Connected as ${data.players[myPlayerId].name}`;
           document.getElementById('connection-status').style.color = 'var(--success)';
           
           // Reverse disconnect marks
           await db.ref(`rooms/${currentRoom}/players/${myPlayerId}`).update({ hasQuit: null, disconnectedAt: null });
           
           // Rehook onDisconnect
           db.ref(`rooms/${currentRoom}/players/${myPlayerId}/disconnectedAt`).onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
           
           // Rehook room listener
           db.ref(`rooms/${currentRoom}`).on('value', (s) => {
              if (s.val()) renderRoomState(s.val());
           });
           return;
       }
       // Fallback: Failed to reconnect (room deleted or player kicked)
       localStorage.removeItem('rummy_room');
       localStorage.removeItem('rummy_playerId');
       currentRoom = null;
       myPlayerId = null;
       document.getElementById('connection-status').textContent = "Lobby Disconnected";
   }
});

// START GAME -> Generates Deck -> Assigns Hands
async function startGame() {
  if (!currentRoom) return;
  const snap = await db.ref(`rooms/${currentRoom}`).get();
  const data = snap.val();
  if (!data || data.host !== myPlayerId) return;
  
  const playerOrder = Object.keys(data.players);
  let activeOrder = playerOrder.filter(id => !data.players[id].isEliminated);
  if(activeOrder.length === 0) activeOrder = playerOrder; // Start of game
  
  const deck = generateDeck();
  
  const hands = {};
  playerOrder.forEach(pId => {
    if (!data.players[pId].isEliminated) {
      hands[pId] = deck.splice(0, 13);
    }
  });
  
  const openDeck = [deck.pop()];
  const wildJoker = deck.pop();
  
  const turnIndex = data.turnIndex !== undefined ? data.turnIndex + 1 : 0;
  
  const updates = {
    status: 'playing',
    playerOrder: playerOrder,
    turnIndex: turnIndex,
    roundStartTurnIndex: turnIndex,
    hands: hands,
    closedDeck: deck,
    openDeck: openDeck,
    wildJoker: wildJoker,
    discardPool: null,
    votes: null,
    declaredHand: null,
    finishCard: null,
    declaredBy: null,
    claimedScores: null
  };
  
  playerOrder.forEach(p => {
    updates[`players/${p}/roundStatus`] = null;
    updates[`players/${p}/penaltyScore`] = null;
    updates[`players/${p}/lastRoundScore`] = null;
  });
  
  await db.ref(`rooms/${currentRoom}`).update(updates);
}

let currentWildJoker = null;

function getNextValidTurnIndex(data, currentIndex) {
  const pCount = data.playerOrder.length;
  let nextIdx = currentIndex + 1;
  for (let i = 0; i < pCount * 2; i++) { // safety iteration
    const pid = data.playerOrder[nextIdx % pCount];
    // Skip ghost players who left the room mid-game
    if (!data.players[pid]) {
      nextIdx++;
      continue;
    }
    const status = data.players[pid].roundStatus;
    const delim = data.players[pid].isEliminated;
    if (status !== 'failed' && status !== 'dropped' && !delim) {
      return nextIdx;
    }
    nextIdx++;
  }
  return nextIdx;
}

function renderPlayBoard(data) {
  // Check Auto-Win if only 1 active player is left
  if (data.host === myPlayerId) {
    let activePlayers = [];
    let startingPlayers = 0;
    data.playerOrder.forEach(p => {
      if (data.players[p]) {
        if(!data.players[p].isEliminated) startingPlayers++;
        if(!data.players[p].isEliminated && data.players[p].roundStatus !== 'dropped' && data.players[p].roundStatus !== 'failed') activePlayers.push(p);
      }
    });
    
    if (activePlayers.length === 1 && startingPlayers > 1 && data.status !== 'showdown' && data.status !== 'scoreboard') {
       db.ref(`rooms/${currentRoom}`).update({
         status: 'showdown',
         [`players/${activePlayers[0]}/penaltyScore`]: 0,
         [`players/${activePlayers[0]}/roundStatus`]: 'winner'
       });
       return;
    }
  }

  const pCount = data.playerOrder.length;
  const turnPlayerId = data.playerOrder[data.turnIndex % pCount];
  
  // Auto-skip players who ragequit or disconnected too long!
  const pData = data.players[turnPlayerId];
  if (!pData || pData.hasQuit || pData.isEliminated || (pData.disconnectedAt && (Date.now() - pData.disconnectedAt > 30000))) {
    if (data.host === myPlayerId) {
      db.ref(`rooms/${currentRoom}`).update({
         turnIndex: getNextValidTurnIndex(data, data.turnIndex),
         [`players/${turnPlayerId}/hasQuit`]: true
      });
    }
    return; // Wait for the skip update
  }
  
  const isMyTurn = turnPlayerId === myPlayerId;

  
  currentWildJoker = data.wildJoker;
  const wjEl = document.getElementById('wild-joker-display');
  if (currentWildJoker) {
    wjEl.innerHTML = renderCardHTML(currentWildJoker);
    wjEl.firstElementChild.draggable = false;
    wjEl.firstElementChild.style.cursor = 'default';
    wjEl.firstElementChild.style.margin = '0';
  }
  
  const indicator = document.getElementById('turn-indicator');
  const myHand = data.hands && data.hands[myPlayerId] ? data.hands[myPlayerId] : [];
  
  if (turnPlayerId === myPlayerId) {
    if (myHand.length === 13) {
      indicator.innerHTML = `<span style="color:var(--success)">🟢 Your Turn! Draw a card.</span>`;
    } else {
      indicator.innerHTML = `<span style="color:var(--success)">🟢 Your Turn! Discard a card.</span>`;
    }
  } else {
    if (pData.disconnectedAt) {
      const timeLeft = Math.floor((30000 - (Date.now() - pData.disconnectedAt)) / 1000);
      if (timeLeft > 0) {
         indicator.innerHTML = `Waiting for <span style="color:#fff;">${pData.name}</span> to reconnect... (${timeLeft}s)`;
         setTimeout(() => { db.ref(`rooms/${currentRoom}`).once('value', s => { if(s.val()) renderRoomState(s.val()) }); }, 1000);
      } else {
         indicator.innerHTML = `Dropping <span style="color:#fff;">${pData.name}</span>...`;
      }
    } else {
      indicator.innerHTML = `Waiting for <span style="color:#fff;">${pData.name}</span> to play...`;
      // Dealer override to kick a player who is afk
      if (data.host === myPlayerId) {
        indicator.innerHTML += `<br/><button class="btn-danger btn-outline" style="margin-top: 0.5rem; padding: 0.2rem 0.5rem; font-size:0.8rem; border-color: rgba(255,0,0,0.5);" onclick="forceFoldPlayer('${turnPlayerId}')">Force Fold (Sleeping)</button>`;
      }
    }
  }
  
  document.getElementById('closed-deck-count').textContent = data.closedDeck ? data.closedDeck.length : 0;
  document.getElementById('muck-pile-count').textContent = data.discardPool ? data.discardPool.length : 0;
  
  const openDeckEl = document.getElementById('open-deck');
  if (data.openDeck && data.openDeck.length > 0) {
    const topCard = data.openDeck[data.openDeck.length - 1];
    openDeckEl.innerHTML = renderCardHTML(topCard);
    
    const topCardEl = openDeckEl.firstElementChild;
    topCardEl.draggable = false;  // Can't drag from discard natively, we click to draw
    topCardEl.style.cursor = 'pointer';
    topCardEl.style.margin = '0'; // Center it
    topCardEl.style.pointerEvents = 'none'; // allow drops to hit the dropzone directly
  } else {
    openDeckEl.innerHTML = '';
  }
  
  const myStatus = data.players[myPlayerId] ? data.players[myPlayerId].roundStatus : null;
  const handActions = document.getElementById('hand-action-buttons');
  const handContainer = document.getElementById('meld-groups');
  
  if (myStatus === 'dropped' || myStatus === 'failed') {
      if(handActions) handActions.style.display = 'none';
      if(handContainer) {
        handContainer.innerHTML = `
          <div style="width:100%; text-align:center; padding: 2rem;">
             <h2 style="color:var(--warning); margin:0;">You have ${myStatus === 'dropped' ? 'Folded' : 'Failed a Declaration'}!</h2>
             <p style="color:var(--text-muted);">Please wait while the remaining players finish the round.</p>
          </div>
        `;
      }
  } else {
      if(handActions) handActions.style.display = 'flex';
      const hand = data.hands && data.hands[myPlayerId] ? data.hands[myPlayerId] : [];
      renderMyHand(hand);
  }
  
  // Inject Mini Scoreboard -> Classic Rummy Tally Sheet
  const miniBoard = document.getElementById('mini-scoreboard-area');
  if (miniBoard) {
    let maxRounds = 0;
    data.playerOrder.forEach(pId => {
      if (data.players[pId] && data.players[pId].scoreHistory) {
        maxRounds = Math.max(maxRounds, data.players[pId].scoreHistory.length);
      }
    });

    let miniHtml = `
      <div style="margin-top: 2rem; background: rgba(0,0,0,0.3); border-radius: 12px; padding: 1rem; border: 1px solid var(--panel-border); overflow-x: auto;">
        <h3 style="color:var(--text-muted); margin-top:0;">Scorecard</h3>
        <table style="width:100%; text-align:center; border-collapse:collapse; font-size: 0.95rem; min-width: 400px;">
          <thead>
            <tr style="border-bottom: 2px solid rgba(255,255,255,0.2); color:var(--primary); font-weight:bold;">
              <th style="padding: 0.5rem; text-align:left;">Round</th>
    `;
    data.playerOrder.forEach(pId => {
      if (!data.players[pId]) return;
      miniHtml += `<th style="padding: 0.5rem;">${data.players[pId].name}</th>`;
    });
    miniHtml += `</tr></thead><tbody>`;
    
    for (let r = 0; r < maxRounds; r++) {
       miniHtml += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: #ccc;">
          <td style="padding: 0.5rem; text-align:left;">R${r+1}</td>`;
       data.playerOrder.forEach(pId => {
          if (!data.players[pId]) return;
          const hist = data.players[pId].scoreHistory || [];
          const s = hist[r] !== undefined ? hist[r] : '-';
          miniHtml += `<td style="padding: 0.5rem;">${s}</td>`;
       });
       miniHtml += `</tr>`;
    }
    
    // Ongoing Round Row
    miniHtml += `<tr style="border-bottom: 1px dashed rgba(255,255,255,0.1); color: var(--warning); opacity: 0.7;">
          <td style="padding: 0.5rem; text-align:left; font-weight:bold;">R${maxRounds+1} (Current)</td>`;
    data.playerOrder.forEach(pId => {
        if (!data.players[pId]) return;
        const status = data.players[pId].roundStatus;
        let display = '...';
        if (data.players[pId].hasQuit) display = '🚪 QUIT';
        else if (status === 'dropped') display = `Fold (${data.players[pId].penaltyScore})`;
        else if (status === 'failed') display = 'Failed (80)';
        else if (data.players[pId].isEliminated) display = '💀';
        miniHtml += `<td style="padding: 0.5rem; font-size:0.85rem;">${display}</td>`;
    });
    miniHtml += `</tr>`;

    // Totals Footer
    miniHtml += `<tr style="border-top: 2px solid rgba(255,255,255,0.2); color: #fff; font-weight:bold; font-size:1.1rem;">
          <td style="padding: 0.5rem; text-align:left;">TOTAL</td>`;
    data.playerOrder.forEach(pId => {
        if (!data.players[pId]) return;
        const p = data.players[pId];
        const isOut = p.totalScore >= 250 || p.hasQuit;
        let statusStr = '';
        if (p.hasQuit) statusStr = '🚪';
        else if (p.totalScore >= 250) statusStr = '💀';
        miniHtml += `<td style="padding: 0.5rem; color: ${isOut ? 'var(--danger)' : '#fff'};">${p.totalScore || 0} ${statusStr}</td>`;
    });
    miniHtml += `</tr></tbody></table></div>`;
    miniBoard.innerHTML = miniHtml;
  }
}

function renderCardHTML(card) {
  const isJoker = card.value === 'JOKER';
  const color = (card.suit === '♥' || card.suit === '♦') ? '#ef4444' : '#18181b';
  
  let inner = '';
  if (isJoker) {
    inner = `
      <div style="writing-mode: vertical-rl; text-orientation: upright; letter-spacing: -2px; font-size: 0.9rem; pointer-events:none; margin-top:2px; font-weight:900;">JOKER</div>
      <div style="font-size: 1.2rem; pointer-events:none; margin-top: auto;">🃏</div>
    `;
  } else {
    inner = `
      <div style="pointer-events:none;">${card.value}</div>
      <div style="font-size: 1.3rem; pointer-events:none; margin-top:-2px;">${card.suit}</div>
    `;
  }
  
  return `
    <div class="playing-card" draggable="true" data-id="${card.id}" style="width: 70px; height: 100px; background: white; border-radius: 6px; color: ${color}; display:flex; flex-direction:column; align-items:flex-start; justify-content:flex-start; padding: 0.25rem 0.5rem; font-weight:bold; font-size: 1.1rem; line-height: 1.1; cursor:grab; user-select:none; margin-right: -40px; position: relative; box-shadow: -3px 0 6px rgba(0,0,0,0.3);">
      ${inner}
    </div>
  `;
}

function renderMyHand(cards) {
  currentHandData = cards;
  const meldGroups = document.getElementById('meld-groups');
  meldGroups.innerHTML = '';
  
  cards.forEach(c => {
    if (!c.groupId) c.groupId = "0";
    localGroups.add(c.groupId);
  });
  if (localGroups.size === 0) localGroups.add("0");
  
  localGroups.forEach(gId => {
    meldGroups.innerHTML += `<div class="meld-group dropzone" data-group="${gId}" style="min-width: 120px; min-height: 120px; background: rgba(255,255,255,0.05); border: 2px dashed rgba(255,255,255,0.2); border-radius: 8px; padding: 0.5rem; padding-right: 40px; display: flex; flex-direction: row; flex-wrap: nowrap; overflow: visible;"></div>`;
  });
  
  cards.forEach(card => {
    const groupEl = meldGroups.querySelector(`[data-group="${card.groupId}"]`);
    if(groupEl) groupEl.innerHTML += renderCardHTML(card);
  });
  
  attachDragEvents();
}

window.addGroup = function() {
  const newId = Math.random().toString(36).substring(2, 7);
  localGroups.add(newId);
  renderMyHand(currentHandData);
}

function attachDragEvents() {
  const cards = document.querySelectorAll('.playing-card');
  const dropzones = document.querySelectorAll('.meld-group.dropzone');
  
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
      card.style.opacity = '0.5';
    });
    card.addEventListener('dragend', (e) => {
      card.style.opacity = '1';
    });
    
    // Allow dropping ONTO another card for exact reordering inside a group!
    card.addEventListener('dragover', e => e.preventDefault());
    card.addEventListener('drop', async (e) => {
      e.stopPropagation(); // Do not trigger the group drop
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('text/plain');
      const targetId = card.getAttribute('data-id');
      if (sourceId !== targetId) {
        await reorderCards(sourceId, targetId);
      }
    });
  });
  
  dropzones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.style.background = 'rgba(255,255,255,0.1)';
    });
    zone.addEventListener('dragleave', (e) => {
      zone.style.background = 'rgba(255,255,255,0.05)';
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.style.background = 'rgba(255,255,255,0.05)';
      const cardId = e.dataTransfer.getData('text/plain');
      const groupId = zone.getAttribute('data-group');
      moveCardToGroup(cardId, groupId);
    });
  });
}

async function reorderCards(sourceId, targetId) {
  const sIdx = currentHandData.findIndex(c => c.id === sourceId);
  const tIdx = currentHandData.findIndex(c => c.id === targetId);
  if (sIdx === -1 || tIdx === -1) return;
  
  const sourceCard = currentHandData.splice(sIdx, 1)[0];
  sourceCard.groupId = currentHandData[currentHandData.findIndex(c => c.id === targetId)].groupId;
  
  const newTIdx = currentHandData.findIndex(c => c.id === targetId);
  currentHandData.splice(newTIdx, 0, sourceCard);
  
  renderMyHand(currentHandData);
  await db.ref(`rooms/${currentRoom}/hands/${myPlayerId}`).set(currentHandData);
}

async function moveCardToGroup(cardId, groupId) {
  const cardIndex = currentHandData.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return;
  
  currentHandData[cardIndex].groupId = groupId;
  await db.ref(`rooms/${currentRoom}/hands/${myPlayerId}`).set(currentHandData);
}

async function discardCard(cardId) {
  try {
    const snap = await db.ref(`rooms/${currentRoom}`).get();
    const data = snap.val();
    const pCount = data.playerOrder.length;
    const turnPlayerId = data.playerOrder[data.turnIndex % pCount];
    
    if (turnPlayerId !== myPlayerId) return alert("Not your turn!");
    if (currentHandData.length <= 13) return alert("You must draw a card before you can discard!");
    
    const cardIndex = currentHandData.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return alert("Error: Grabbed card ID missing from hand memory.");
    
    // Remove from hand, push to open deck
    const card = currentHandData.splice(cardIndex, 1)[0];
    const openDeck = data.openDeck || [];
    openDeck.push(card);
    
    const nextTurn = getNextValidTurnIndex(data, data.turnIndex);
    
    await db.ref(`rooms/${currentRoom}`).update({
      openDeck: openDeck,
      [`hands/${myPlayerId}`]: currentHandData,
      turnIndex: nextTurn
    });
  } catch(e) {
    alert("Discard failed: " + e.message);
  }
}

// === GAMEPLAY ACTIONS ===

window.viewDiscardPile = async function() {
  if (!currentRoom) return;
  const snap = await db.ref(`rooms/${currentRoom}`).get();
  const data = snap.val();
  
  if (!data || !data.openDeck || data.openDeck.length === 0) {
    return alert("The discard pile is completely empty!");
  }
  
  const display = document.getElementById('discard-pile-display');
  display.innerHTML = '';
  data.openDeck.forEach(c => {
    display.innerHTML += renderCardHTML(c);
  });
  
  // Disable dragging for visual preview
  display.querySelectorAll('.playing-card').forEach(el => {
    el.draggable = false;
    el.style.cursor = 'default';
    el.classList.remove('playing-card');
  });
  
  document.getElementById('discard-modal').classList.remove('hidden');
}

window.forceFoldPlayer = async function(targetPId) {
  if (!currentRoom) return;
  const snap = await db.ref(`rooms/${currentRoom}`).get();
  const data = snap.val();
  
  if (data.host !== myPlayerId) return alert("Only the host can force fold an AFK player.");
  if (!confirm(`Are you sure you want to forcefully fold ${data.players[targetPId].name}'s hand? They will immediately take the Drop Penalty.`)) return;
  
  const targetHand = data.hands && data.hands[targetPId] ? data.hands[targetPId] : [];
  if (targetHand.length === 14) {
      return alert("You cannot force fold a player after they have drawn a card. They must discard.");
  }
  
  const pool = data.discardPool || [];
  targetHand.forEach(c => pool.push(c));
  
  const startIdx = data.roundStartTurnIndex || 0;
  const isFirstTurn = (data.turnIndex - startIdx) < data.playerOrder.length;
  const score = isFirstTurn ? 25 : 40;
  
  const nextTurn = getNextValidTurnIndex(data, data.turnIndex);
  
  await db.ref(`rooms/${currentRoom}`).update({
    [`players/${targetPId}/roundStatus`]: 'dropped',
    [`players/${targetPId}/penaltyScore`]: score,
    [`hands/${targetPId}`]: [],
    discardPool: pool,
    turnIndex: nextTurn
  });
}

document.getElementById('closed-deck').addEventListener('click', async () => {
  if (!currentRoom) return;
  const snap = await db.ref(`rooms/${currentRoom}`).get();
  const data = snap.val();
  
  if (data.status !== 'playing') return;
  const turnPlayerId = data.playerOrder[data.turnIndex % data.playerOrder.length];
  if (turnPlayerId !== myPlayerId) return alert("Not your turn!");
  
  if (currentHandData.length >= 14) return alert("You already drew a card! Please discard.");
  
  let closedDeck = data.closedDeck || [];
  let openDeck = data.openDeck || [];
  let discardPool = data.discardPool || [];
  
  if (closedDeck.length === 0) {
    if (openDeck.length <= 1 && discardPool.length === 0) {
      return alert("The deck is completely exhausted!");
    }
    const topOpenCard = openDeck.length > 0 ? openDeck.pop() : null;
    closedDeck = [...openDeck, ...discardPool];
    closedDeck.sort(() => Math.random() - 0.5);
    
    openDeck = topOpenCard ? [topOpenCard] : [];
    discardPool = [];
    
    await db.ref(`rooms/${currentRoom}`).update({
       openDeck: openDeck,
       discardPool: null,
       closedDeck: closedDeck
    });
  }

  const card = closedDeck.pop();
  currentHandData.push(card);
  
  await db.ref(`rooms/${currentRoom}`).update({
    closedDeck: closedDeck,
    [`hands/${myPlayerId}`]: currentHandData
  });
});

document.getElementById('open-deck').addEventListener('click', async () => {
  if (!currentRoom) return;
  const snap = await db.ref(`rooms/${currentRoom}`).get();
  const data = snap.val();
  
  if (data.status !== 'playing') return;
  const turnPlayerId = data.playerOrder[data.turnIndex % data.playerOrder.length];
  if (turnPlayerId !== myPlayerId) return alert("Not your turn!");
  
  const myHand = data.hands[myPlayerId] || [];
  if (myHand.length >= 14) return alert("You already drew a card! Now you must discard one.");
  
  if (data.openDeck && data.openDeck.length > 0) {
    const card = data.openDeck.pop();
    myHand.push(card);
    await db.ref(`rooms/${currentRoom}`).update({
      openDeck: data.openDeck,
      [`hands/${myPlayerId}`]: myHand
    });
  }
});

// Attach ONE global event listener for Discarding so we don't get the infinite popup bug!
const openDeckDropZone = document.getElementById('open-deck');
openDeckDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  openDeckDropZone.style.background = 'rgba(255,255,255,0.1)';
});
openDeckDropZone.addEventListener('dragleave', (e) => {
  openDeckDropZone.style.background = 'rgba(0,0,0,0.3)';
});
openDeckDropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  openDeckDropZone.style.background = 'rgba(0,0,0,0.3)';
  const cardId = e.dataTransfer.getData('text/plain');
  if (cardId) await discardCard(cardId);
});

// === PHASE 5 SCOREBOARD LOGIC ===

async function dropHand() {
  if (!confirm("Are you sure you want to FOLD? You will take a guaranteed point penalty and your round will be over.")) return;
  const snap = await db.ref(`rooms/${currentRoom}`).get();
  const data = snap.val();
  const turnPlayerId = data.playerOrder[data.turnIndex % data.playerOrder.length];
  if (turnPlayerId !== myPlayerId) return alert("You can only fold on your turn!");
  
  if (currentHandData.length === 14) return alert("You cannot fold after drawing! You must discard.");
  
  const startIdx = data.roundStartTurnIndex || 0;
  const isFirstTurn = (data.turnIndex - startIdx) < data.playerOrder.length;
  const score = isFirstTurn ? 25 : 40;
  
  const myHand = data.hands[myPlayerId] || [];
  const discardPool = data.discardPool || [];
  discardPool.push(...myHand);
  
  await db.ref(`rooms/${currentRoom}`).update({
    [`players/${myPlayerId}/roundStatus`]: 'dropped',
    [`players/${myPlayerId}/penaltyScore`]: score,
    turnIndex: getNextValidTurnIndex(data, data.turnIndex),
    openDeck: data.openDeck || [],
    discardPool: discardPool,
    [`hands/${myPlayerId}`]: null
  });
}

// Attach ONE global listener for the Finish Slot
const finishDropZone = document.getElementById('finish-slot');
finishDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  finishDropZone.style.background = 'rgba(56,189,248,0.2)';
});
finishDropZone.addEventListener('dragleave', (e) => {
  finishDropZone.style.background = 'rgba(56,189,248,0.1)';
});
finishDropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  finishDropZone.style.background = 'rgba(56,189,248,0.1)';
  const cardId = e.dataTransfer.getData('text/plain');
  if (cardId) await declareRummyByDrop(cardId);
});

// === VOTING AND DECLARATION ===

async function declareRummyByDrop(cardId) {
  if (currentHandData.length < 14) return alert("You must draw a card before declaring!");
  
  const cardIndex = currentHandData.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return alert("Card not found in hand.");
  
  // Pluck the specific card to be the "Finish Card"
  const finishCard = currentHandData.splice(cardIndex, 1)[0];
  
  await db.ref(`rooms/${currentRoom}`).update({
    status: 'voting',
    declaredBy: myPlayerId,
    declaredHand: currentHandData,
    finishCard: finishCard,
    votes: null // reset old votes
  });
}

async function submitVote(voteType) {
  document.getElementById('voting-actions').style.display = 'none';
  await db.ref(`rooms/${currentRoom}/votes/${myPlayerId}`).set(voteType);
}

function renderVoting(data) {
  document.getElementById('play-board-section').classList.remove('hidden'); // allow seeing board behind
  document.getElementById('voting-modal').classList.remove('hidden');
  
  const modalTitle = document.getElementById('voting-title');
  const declName = data.players[data.declaredBy].name;
  
  if (data.declaredBy === myPlayerId) {
    modalTitle.textContent = "You declared Rummy!";
    document.getElementById('voting-actions').style.display = 'none';
  } else {
    modalTitle.textContent = `${declName} declared Rummy!`;
    const myVote = data.votes ? data.votes[myPlayerId] : null;
    const isFailed = data.players[myPlayerId] && (data.players[myPlayerId].roundStatus === 'failed' || data.players[myPlayerId].roundStatus === 'dropped');
    
    if (myVote || isFailed) {
      document.getElementById('voting-actions').style.display = 'none';
    } else {
      document.getElementById('voting-actions').style.display = 'flex';
    }
  }
  
  if (data.finishCard) {
    const finishEl = document.getElementById('voting-finish-card');
    finishEl.innerHTML = renderCardHTML(data.finishCard);
    finishEl.firstElementChild.draggable = false;
    finishEl.firstElementChild.style.margin = '0';
  }
  
  const handContainer = document.getElementById('voting-hand-display');
  handContainer.innerHTML = '';
  
  const groups = {};
  data.declaredHand.forEach(c => {
    if(!groups[c.groupId]) groups[c.groupId] = [];
    groups[c.groupId].push(c);
  });
  
  Object.keys(groups).forEach(gId => {
    let html = `<div style="display:flex; background: rgba(255,255,255,0.05); border: 2px dashed rgba(255,255,255,0.2); border-radius: 8px; padding: 0.5rem; padding-right: 40px;">`;
    groups[gId].forEach(card => {
       html += renderCardHTML(card);
    });
    html += `</div>`;
    handContainer.innerHTML += html;
  });
  
  handContainer.querySelectorAll('.playing-card').forEach(el => {
    el.draggable = false;
    el.style.cursor = 'default';
  });
  
  let valid = 0, invalid = 0;
  if(data.votes) {
    Object.values(data.votes).forEach(v => {
      if(v === 'valid') valid++;
      if(v === 'invalid') invalid++;
    });
  }
  document.getElementById('vote-valid-count').textContent = valid;
  document.getElementById('vote-invalid-count').textContent = invalid;
  
  // Resolution Engine (Host processes to prevent race conditions)
  if (data.host === myPlayerId) {
    let totalVoters = 0;
    Object.keys(data.players).forEach(pId => {
      const p = data.players[pId];
      if (pId !== data.declaredBy && p.roundStatus !== 'failed' && p.roundStatus !== 'dropped' && !p.isEliminated) {
        totalVoters++;
      }
    });
    
    if ((valid + invalid) >= totalVoters && totalVoters > 0) {
      if (valid >= invalid) {
        // Round ends: Valid! 
        setTimeout(async () => {
          await db.ref(`rooms/${currentRoom}`).update({ 
            status: 'showdown',
            [`players/${data.declaredBy}/penaltyScore`]: 0,
            [`players/${data.declaredBy}/roundStatus`]: 'winner'
          });
        }, 1000);
      } else {
        // Invalid! Penalize
        setTimeout(async () => {
          alert(`❌ Rejected! ${declName} suffers an 80 point penalty! (Game Resumes)`);
          
          const nextOpenDeck = data.openDeck || [];
          if (data.finishCard) nextOpenDeck.push(data.finishCard);
          
          const discardPool = data.discardPool || [];
          const failedHand = data.declaredHand || [];
          discardPool.push(...failedHand);
          
          await db.ref(`rooms/${currentRoom}`).update({ 
            status: 'playing', 
            turnIndex: getNextValidTurnIndex(data, data.turnIndex),
            openDeck: nextOpenDeck,
            discardPool: discardPool,
            [`hands/${data.declaredBy}`]: null, 
            finishCard: null,
            declaredHand: null,
            [`players/${data.declaredBy}/roundStatus`]: 'failed'
          });
        }, 1000);
      }
    }
  }
}

// === SHOWDOWN ===

window.updateClaim = async function(pId) {
  const val = document.getElementById(`claim-${pId}`).value;
  await db.ref(`rooms/${currentRoom}/claimedScores/${pId}`).set(parseInt(val, 10));
}

function renderShowdown(data) {
  document.getElementById('play-board-section').classList.add('hidden');
  document.getElementById('voting-modal').classList.add('hidden');
  document.getElementById('scoreboard-section').classList.add('hidden');
  document.getElementById('showdown-section').classList.remove('hidden');

  const container = document.getElementById('showdown-players-container');
  container.innerHTML = '';
  
  const dealerBtn = document.getElementById('btn-finalize-scores');
  if (data.host === myPlayerId) dealerBtn.classList.remove('hidden');
  else dealerBtn.classList.add('hidden');
  
  data.playerOrder.forEach(pId => {
    if(!data.players[pId] || data.players[pId].isEliminated) return;
    
    const p = data.players[pId];
    let content = '';
    
    if (p.roundStatus === 'winner') {
      content = `<span style="color:var(--success); font-weight:bold; font-size:1.5rem;">🏆 WINNER (0 Points)</span>`;
    } else if (p.roundStatus === 'failed') {
      content = `<span style="color:var(--danger); font-weight:bold; font-size:1.2rem;">❌ WRONG SHOW (80 Points)</span>`;
    } else if (p.roundStatus === 'dropped') {
      content = `<span style="color:var(--warning); font-weight:bold; font-size:1.2rem;">🏃 FOLDED (${p.penaltyScore} Points)</span>`;
    } else {
      const currentClaim = data.claimedScores && data.claimedScores[pId] !== undefined ? data.claimedScores[pId] : '';
      content = `
        <div style="display:flex; align-items:center; gap: 1rem;">
          ${ pId === myPlayerId ? `<button class="btn-outline" style="padding:0.25rem 0.5rem;" onclick="addGroup()">+ Group</button>` : ''}
          <input type="number" min="0" max="80" placeholder="Score" id="claim-${pId}" value="${currentClaim}" style="width: 80px; text-align:center; padding: 0.5rem; font-size: 1.2rem; background: rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.2); color:white; border-radius:4px;">
          <button class="btn-outline" onclick="updateClaim('${pId}')" style="padding:0.5rem;">Update Override</button>
        </div>
      `;
    }
    
    let handHtml = '';
    const h = data.hands && data.hands[pId] ? data.hands[pId] : [];
    
    // Visual grouping logic
    const groupsObj = {};
    h.forEach(c => {
      const gId = c.groupId || "0";
      if(!groupsObj[gId]) groupsObj[gId] = [];
      groupsObj[gId].push(c);
    });
    
    // Ensure active players see their empty groups to drag into
    if (pId === myPlayerId) {
      localGroups.forEach(gId => { if (!groupsObj[gId]) groupsObj[gId] = []; });
    }
    
    Object.keys(groupsObj).forEach(gId => {
       const isMe = (pId === myPlayerId);
       handHtml += `<div class="${isMe ? 'meld-group dropzone' : ''}" data-group="${gId}" style="display:flex; background: rgba(255,255,255,0.05); border: 2px dashed rgba(255,255,255,0.2); border-radius: 8px; padding: 0.5rem; padding-right: 40px; min-width:80px; min-height:100px;">`;
       groupsObj[gId].forEach(card => {
         handHtml += renderCardHTML(card);
       });
       handHtml += `</div>`;
    });
    
    container.innerHTML += `
      <div class="showdown-row" data-owner="${pId}" style="background:rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem; display:flex; flex-direction:column; gap:1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; color:#fff; font-size:1.5rem;">${p.name}</h3>
          ${content}
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; transform:scale(0.85); transform-origin:left;">
          ${handHtml}
        </div>
      </div>
    `;
  });
  
  // Strip interactivity from opponent cards
  container.querySelectorAll('.showdown-row').forEach(row => {
    if (row.getAttribute('data-owner') !== myPlayerId) {
      row.querySelectorAll('.playing-card').forEach(c => {
         c.draggable = false;
         c.style.cursor = 'default';
         c.classList.remove('playing-card'); // Prevent attachDragEvents from grabbing it
      });
    }
  });

  // Enable dragging on the Showdown screen for MY hand!
  currentHandData = data.hands && data.hands[myPlayerId] ? data.hands[myPlayerId] : [];
  attachDragEvents();
}

// === SCOREBOARD ===

async function finalizeScores() {
  const snap = await db.ref(`rooms/${currentRoom}`).get();
  const data = snap.val();
  
  // Validate that everyone has a score entered before proceeding
  let hasMissing = false;
  data.playerOrder.forEach(pId => {
     if(!data.players[pId] || data.players[pId].isEliminated) return;
     const p = data.players[pId];
     if (p.roundStatus !== 'winner' && p.roundStatus !== 'failed' && p.roundStatus !== 'dropped') {
        if (!data.claimedScores || data.claimedScores[pId] === undefined || data.claimedScores[pId] === '') {
           hasMissing = true;
        }
     }
  });
  if (hasMissing) {
    return alert("Halt! Not all players have declared a score. You cannot finalize until every Active player submits their Dead Points.");
  }
  
  data.playerOrder.forEach(pId => {
     if(!data.players[pId] || data.players[pId].isEliminated) return;
     const p = data.players[pId];
     let roundScore = 0;
     if (p.roundStatus === 'winner') roundScore = 0;
     else if (p.roundStatus === 'failed') roundScore = 80;
     else if (p.roundStatus === 'dropped') roundScore = p.penaltyScore || 40;
     else {
       roundScore = (data.claimedScores && data.claimedScores[pId] !== undefined) ? data.claimedScores[pId] : 80;
       if(roundScore > 80) roundScore = 80;
     }
     
     p.scoreHistory = p.scoreHistory || [];
     p.scoreHistory.push(roundScore);
     
     p.totalScore = (p.totalScore || 0) + roundScore;
     p.lastRoundScore = roundScore;
     
     if (p.totalScore >= 250) {
       p.isEliminated = true;
     }
  });
  
  await db.ref(`rooms/${currentRoom}`).update({
    players: data.players,
    status: 'scoreboard'
  });
}

function renderScoreboard(data) {
  document.getElementById('play-board-section').classList.add('hidden');
  document.getElementById('voting-modal').classList.add('hidden');
  document.getElementById('showdown-section').classList.add('hidden');
  document.getElementById('scoreboard-section').classList.remove('hidden');
  
  const container = document.getElementById('master-scoreboard-container');
  let maxRounds = 0;
  data.playerOrder.forEach(pId => {
    if (data.players[pId] && data.players[pId].scoreHistory) {
      maxRounds = Math.max(maxRounds, data.players[pId].scoreHistory.length);
    }
  });

  let tHtml = `
    <table style="width:100%; margin-top: 2rem; border-collapse: collapse; text-align: center; color:#fff; font-size: 1.1rem; min-width: 600px;">
      <thead>
        <tr style="border-bottom: 2px solid rgba(255,255,255,0.2); color:var(--primary);">
          <th style="padding: 1rem; text-align:left;">Round</th>
  `;
  data.playerOrder.forEach(pId => {
    if (!data.players[pId]) return;
    tHtml += `<th style="padding: 1rem;">${data.players[pId].name}</th>`;
  });
  tHtml += `</tr></thead><tbody>`;
  
  for (let r = 0; r < maxRounds; r++) {
     tHtml += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: #ccc;">
        <td style="padding: 1rem; text-align:left;">Round ${r+1}</td>`;
     data.playerOrder.forEach(pId => {
        if (!data.players[pId]) return;
        const hist = data.players[pId].scoreHistory || [];
        const s = hist[r] !== undefined ? hist[r] : '-';
        tHtml += `<td style="padding: 1rem;">${s}</td>`;
     });
     tHtml += `</tr>`;
  }
  
  tHtml += `<tr style="border-top: 2px solid rgba(255,255,255,0.4); font-weight:bold; font-size:1.3rem;">
        <td style="padding: 1rem; text-align:left;">TOTALS</td>`;
  data.playerOrder.forEach(pId => {
     if (!data.players[pId]) return;
     const p = data.players[pId];
     const isOut = p.totalScore >= 250 || p.hasQuit;
     let statusStr = '';
     if (p.hasQuit) statusStr = '🚪 QUIT';
     else if (p.totalScore >= 250) statusStr = '💀';
     tHtml += `<td style="padding: 1rem; color:${isOut ? 'var(--danger)' : '#fff'};">${p.totalScore || 0} <span style="font-size:0.8rem">${statusStr}</span></td>`;
  });
  tHtml += `</tr></tbody></table>`;
  
  if (container) container.innerHTML = tHtml;
  
  const nextBtn = document.getElementById('btn-next-round');
  if (data.host === myPlayerId) {
    let activeCt = 0;
    data.playerOrder.forEach(pId => { if (data.players[pId] && !data.players[pId].isEliminated) activeCt++; });
    
    nextBtn.classList.remove('hidden');
    if (activeCt <= 1) {
       nextBtn.textContent = "🏆 End Game (Winner Declared)";
       nextBtn.onclick = () => alert("Game is fully over!");
    } else {
       nextBtn.textContent = "Deal Next Round";
       nextBtn.onclick = startGame;
    }
  } else {
    nextBtn.classList.add('hidden');
  }
}
