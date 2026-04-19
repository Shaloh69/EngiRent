'use strict';

const socket = io();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const badge       = document.getElementById('connection-badge');
const statusCard  = document.getElementById('status-card');
const statusMsg   = document.getElementById('status-message');
const faceOverlay = document.getElementById('face-overlay');
const faceInstr   = document.getElementById('face-instruction');
const faceBar     = document.getElementById('face-bar');
const successOv   = document.getElementById('success-overlay');
const successMsg  = document.getElementById('success-message');
const clock       = document.getElementById('clock');

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  clock.textContent = new Date().toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
setInterval(updateClock, 1000);
updateClock();

// ── Socket.io ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  badge.className = 'badge badge-connecting';
  badge.textContent = 'Connecting…';
});

socket.on('state_update', applyState);

socket.on('disconnect', () => {
  badge.className = 'badge badge-offline';
  badge.textContent = 'Offline';
});

// Poll state every 2 s as fallback
setInterval(() => {
  fetch('/api/state')
    .then(r => r.json())
    .then(applyState)
    .catch(() => {});
}, 2000);

// ── State rendering ───────────────────────────────────────────────────────────
function applyState(state) {
  if (!state) return;

  const { status, message, active_locker, lockers } = state;

  // Connection badge
  if (status === 'offline' || status === 'error') {
    badge.className = 'badge badge-offline';
    badge.textContent = 'Offline';
  } else {
    badge.className = 'badge badge-online';
    badge.textContent = 'Online';
  }

  // Status card
  statusCard.className = `status-card status-${status}`;
  statusMsg.textContent = message || '';

  // Active locker highlight
  [1, 2, 3, 4].forEach(id => {
    const card = document.getElementById(`locker-${id}`);
    if (!card) return;
    if (active_locker && Number(active_locker) === id) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

  // Door pills
  if (lockers) {
    Object.entries(lockers).forEach(([lockerId, doors]) => {
      const id = lockerId;
      updateDoor(id, 'main', doors.main);
      updateDoor(id, 'trap', doors.trapdoor);
      updateDoor(id, 'bot',  doors.bottom);
    });
  }

  // Overlays
  if (status === 'face_scan') {
    faceOverlay.classList.remove('hidden');
    successOv.classList.add('hidden');
    faceInstr.textContent = message || 'Look directly at the camera';
    animateFaceBar();
  } else {
    faceOverlay.classList.add('hidden');
  }

  if (status === 'verified') {
    successOv.classList.remove('hidden');
    successMsg.textContent = message || 'Identity Verified ✓';
    setTimeout(() => successOv.classList.add('hidden'), 3000);
  }
}

function updateDoor(lockerId, doorKey, state) {
  const el = document.getElementById(`l${lockerId}-${doorKey}`);
  if (!el) return;
  el.className = `door-pill ${state === 'unlocked' ? 'unlocked' : 'locked'}`;
}

// Animate the face scan progress bar
let _faceBarInterval = null;
function animateFaceBar() {
  let pct = 0;
  if (_faceBarInterval) clearInterval(_faceBarInterval);
  _faceBarInterval = setInterval(() => {
    pct = Math.min(pct + 2, 95);
    faceBar.style.width = pct + '%';
    if (pct >= 95) clearInterval(_faceBarInterval);
  }, 120);
}
