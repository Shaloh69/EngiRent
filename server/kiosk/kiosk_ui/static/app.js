'use strict';

// ── Socket.io connection ───────────────────────────────────────────────────────
const socket = io();

// ── State constants ───────────────────────────────────────────────────────────
const S = {
  IDLE:    'idle',
  MAIN:    'main',
  QR:      'qr',
  CONFIRM: 'confirm',
  FACE:    'face',
  SUCCESS: 'success',
  ERROR:   'error',
};

// ── App state ─────────────────────────────────────────────────────────────────
let currentState  = S.IDLE;
let rentalId      = null;
let rentalInfo    = null;
let mode          = null;   // 'place' | 'retrieve'
let inactTimer    = null;
let faceBarTimer  = null;
let successTimer  = null;
let countSecs     = null;

const IDLE_MS   = 30_000;        // 30s on MAIN → IDLE
const RETURN_MS = 5 * 60_000;    // 5min on flow screens → MAIN

// ── Screen map ────────────────────────────────────────────────────────────────
const SCR = {
  [S.IDLE]:    document.getElementById('screen-idle'),
  [S.MAIN]:    document.getElementById('screen-main'),
  [S.QR]:      document.getElementById('screen-qr'),
  [S.CONFIRM]: document.getElementById('screen-confirm'),
  [S.FACE]:    document.getElementById('screen-face'),
  [S.SUCCESS]: document.getElementById('screen-success'),
  [S.ERROR]:   document.getElementById('screen-error'),
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const connBadge    = document.getElementById('conn-badge');
const clock        = document.getElementById('clock');
const qrCam        = document.getElementById('qr-cam');
const faceCam      = document.getElementById('face-cam');
const qrStatusText = document.getElementById('qr-status-text');
const qrTitle      = document.getElementById('qr-title');
const faceInstr    = document.getElementById('face-instr');
const faceBar      = document.getElementById('face-bar');
const faceLabel    = document.getElementById('face-label');
const successSub   = document.getElementById('success-sub');
const successInstr = document.getElementById('success-instr');
const countdownEl  = document.getElementById('countdown-secs');
const errorMsg     = document.getElementById('error-msg');
// Confirm screen
const confirmItem   = document.getElementById('confirm-item');
const confirmBadge  = document.getElementById('rental-status-badge');
const confirmLocker = document.getElementById('confirm-locker');
const confirmOwner  = document.getElementById('confirm-owner');
const confirmAction = document.getElementById('confirm-action');
const confirmRid    = document.getElementById('confirm-rid');
const confirmNotice = document.getElementById('confirm-notice');

// ── Screen transition ─────────────────────────────────────────────────────────
function goTo(next) {
  const prev = SCR[currentState];
  if (prev) {
    prev.classList.remove('active');
    prev.setAttribute('aria-hidden', 'true');
  }
  currentState = next;
  const el = SCR[currentState];
  if (el) {
    el.classList.add('active');
    el.setAttribute('aria-hidden', 'false');
  }
  _onEnter(currentState);
  _resetInactivity();
}

function _onEnter(s) {
  if (s === S.IDLE) {
    _startCollage();
    _stopCam();
  } else if (s === S.MAIN) {
    _stopCam();
    socket.emit('set_qr_mode', { active: false });
  } else if (s === S.QR) {
    _startCam('qr');
    socket.emit('set_qr_mode', { active: true });
    _setQrStatus('scanning');
  } else if (s === S.CONFIRM) {
    _stopCam();
    socket.emit('set_qr_mode', { active: false });
  } else if (s === S.FACE) {
    _startCam('face');
    _animFaceBar();
  } else if (s === S.SUCCESS) {
    _stopCam();
    _startCountdown();
  } else if (s === S.ERROR) {
    _stopCam();
    socket.emit('set_qr_mode', { active: false });
  }
}

// ── Inactivity timer ──────────────────────────────────────────────────────────
function _resetInactivity() {
  clearTimeout(inactTimer);
  if (currentState === S.IDLE) return;
  if (currentState === S.MAIN) {
    inactTimer = setTimeout(() => goTo(S.IDLE), IDLE_MS);
  } else {
    inactTimer = setTimeout(() => {
      goTo(S.MAIN);
      // Brief pause on MAIN, then go idle
      inactTimer = setTimeout(() => {
        if (currentState === S.MAIN) goTo(S.IDLE);
      }, 4000);
    }, RETURN_MS);
  }
}

// Reset timer on any touch / click / key
['touchstart', 'mousedown', 'keydown'].forEach(ev => {
  document.addEventListener(ev, () => {
    if (currentState !== S.IDLE) _resetInactivity();
  }, { passive: true });
});

// ── Button wiring ─────────────────────────────────────────────────────────────
SCR[S.IDLE].addEventListener('click', () => {
  if (currentState === S.IDLE) goTo(S.MAIN);
});

document.getElementById('btn-place').addEventListener('click', () => {
  mode = 'place';
  qrTitle.textContent = 'Scan QR Code – Placing Item';
  goTo(S.QR);
});

document.getElementById('btn-retrieve').addEventListener('click', () => {
  mode = 'retrieve';
  qrTitle.textContent = 'Scan QR Code – Retrieving Item';
  goTo(S.QR);
});

document.getElementById('qr-back').addEventListener('click', () => {
  socket.emit('set_qr_mode', { active: false });
  goTo(S.MAIN);
});

document.getElementById('confirm-back').addEventListener('click', () => {
  goTo(S.QR);
  socket.emit('set_qr_mode', { active: true });
});

document.getElementById('btn-proceed').addEventListener('click', () => {
  if (!rentalId) return;
  socket.emit('user_confirm', { rental_id: rentalId, mode });
  faceInstr.textContent = 'Preparing verification…';
  faceLabel.textContent = 'Please wait…';
  goTo(S.FACE);
});

document.getElementById('btn-cancel').addEventListener('click', () => goTo(S.MAIN));

document.getElementById('btn-retry').addEventListener('click', () => goTo(S.MAIN));
document.getElementById('btn-err-home').addEventListener('click', () => goTo(S.MAIN));

// ── Camera control ────────────────────────────────────────────────────────────
function _startCam(which) {
  const ts = Date.now();
  if (which === 'qr')   qrCam.src  = `/camera/face/stream?t=${ts}`;
  if (which === 'face') faceCam.src = `/camera/face/stream?t=${ts}`;
}

function _stopCam() {
  qrCam.src   = '';
  faceCam.src = '';
}

// ── QR status display ─────────────────────────────────────────────────────────
function _setQrStatus(type, text) {
  const statusEl = document.getElementById('qr-status');
  if (type === 'scanning') {
    statusEl.innerHTML = '<span class="spin-ring"></span><span id="qr-status-text">Looking for QR code…</span>';
  } else if (type === 'found') {
    statusEl.innerHTML = '<span style="color:var(--green);font-size:22px;line-height:1">✓</span><span id="qr-status-text">QR detected! Loading info…</span>';
  } else if (type === 'error') {
    statusEl.innerHTML = `<span style="color:var(--red)">⚠</span><span id="qr-status-text">${text || 'Error'}</span>`;
  }
}

// ── Idle collage ──────────────────────────────────────────────────────────────
let _slideIdx  = 0;
let _slideTimer = null;
const _slides  = Array.from(document.querySelectorAll('.slide'));
const _dots    = Array.from(document.querySelectorAll('.dot'));

function _startCollage() {
  _showSlide(0);
  clearInterval(_slideTimer);
  _slideTimer = setInterval(() => {
    _showSlide((_slideIdx + 1) % _slides.length);
  }, 4500);
}

function _showSlide(idx) {
  _slides.forEach((s, i) => s.classList.toggle('slide-active', i === idx));
  _dots.forEach((d, i) => d.classList.toggle('dot-active', i === idx));
  _slideIdx = idx;
}

// ── Success countdown ─────────────────────────────────────────────────────────
function _startCountdown() {
  clearTimeout(successTimer);
  clearInterval(countSecs);

  // Restart the CSS drain animation
  const fill = document.getElementById('countdown-fill');
  fill.style.animation = 'none';
  fill.offsetHeight;  // reflow
  fill.style.animation = '';

  let n = 5;
  if (countdownEl) countdownEl.textContent = n;

  countSecs = setInterval(() => {
    n--;
    if (countdownEl) countdownEl.textContent = n;
    if (n <= 0) clearInterval(countSecs);
  }, 1000);

  successTimer = setTimeout(() => {
    clearInterval(countSecs);
    goTo(S.MAIN);
  }, 5000);
}

// ── Face bar animation ────────────────────────────────────────────────────────
function _animFaceBar() {
  faceBar.style.width = '0%';
  clearInterval(faceBarTimer);
  let p = 0;
  faceBarTimer = setInterval(() => {
    p = Math.min(p + 1.2, 90);
    faceBar.style.width = p + '%';
    if (p >= 90) clearInterval(faceBarTimer);
  }, 90);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function _updateClock() {
  clock.textContent = new Date().toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
setInterval(_updateClock, 1000);
_updateClock();

// ── Socket.io ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  connBadge.className  = 'conn-badge badge-connect';
  connBadge.textContent = 'Connecting…';
});

socket.on('disconnect', () => {
  connBadge.className  = 'conn-badge badge-offline';
  connBadge.textContent = 'Offline';
});

socket.on('state_update', _applyState);

// QR scan result pushed by Python worker
socket.on('qr_scanned', (data) => {
  rentalId   = data.rental_id || '';
  rentalInfo = data.rental_info || {};

  _setQrStatus('found');
  _populateConfirm(rentalInfo, rentalId);

  // Brief visual pause then show confirm
  setTimeout(() => {
    if (currentState === S.QR) goTo(S.CONFIRM);
  }, 700);
});

// ── Populate confirm screen ───────────────────────────────────────────────────
function _populateConfirm(info, rid) {
  const item   = info.item   || {};
  const owner  = info.owner  || {};
  const status = (info.status || 'UNKNOWN').toUpperCase();

  confirmItem.textContent   = item.title || item.name || 'Unknown Item';
  confirmLocker.textContent = info.depositLockerId || '—';
  confirmOwner.textContent  =
    [owner.firstName, owner.lastName].filter(Boolean).join(' ') || '—';
  confirmRid.textContent    = rid ? rid.substring(0, 20) + '…' : '—';

  // Status badge
  confirmBadge.textContent = status.replace(/_/g, ' ');
  confirmBadge.className   = 'rental-badge';
  if (status === 'DEPOSITED') confirmBadge.classList.add('badge-deposited');
  else if (status === 'ACTIVE') confirmBadge.classList.add('badge-active');

  // Action & notice text
  const actionMap = {
    AWAITING_DEPOSIT: 'Deposit item into locker',
    DEPOSITED:        'Claim your rented item',
    ACTIVE:           'Return item to locker',
  };
  const noticeMap = {
    AWAITING_DEPOSIT: 'Identity will be verified, then the locker will open for you to deposit the item.',
    DEPOSITED:        'Identity will be verified, then the locker will open for you to collect the item.',
    ACTIVE:           'Identity will be verified, then the locker will open for you to return the item.',
  };
  confirmAction.textContent = actionMap[status]  || 'Proceed with action';
  confirmNotice.textContent = noticeMap[status]  || 'Identity verification is required before access is granted.';
}

// ── Apply server-side state ───────────────────────────────────────────────────
function _applyState(s) {
  if (!s) return;
  const { status, message, lockers, active_locker } = s;

  // Connection badge
  if (status === 'offline' || status === 'error') {
    connBadge.className  = 'conn-badge badge-offline';
    connBadge.textContent = 'Offline';
  } else {
    connBadge.className  = 'conn-badge badge-online';
    connBadge.textContent = 'Online';
  }

  // Locker pills
  if (lockers) {
    Object.entries(lockers).forEach(([id, doors]) => {
      const pill = document.getElementById(`lp-${id}`);
      if (!pill) return;
      const busy = doors.main === 'unlocked' || doors.bottom === 'unlocked';
      pill.classList.toggle('occupied', busy);
    });
  }

  // Server-driven state changes
  if (status === 'face_scan' && currentState !== S.FACE) {
    faceInstr.textContent = message || 'Look directly at the camera';
    goTo(S.FACE);
  } else if (status === 'face_scan' && currentState === S.FACE) {
    faceInstr.textContent = message || 'Look directly at the camera';
  } else if (status === 'verified') {
    clearInterval(faceBarTimer);
    faceBar.style.width = '100%';
    faceLabel.textContent = 'Verified ✓';

    const lockerNum = active_locker ? `Locker ${String(active_locker).padStart(2, '0')}` : 'Locker';
    successSub.textContent  = `${lockerNum} is now open`;
    successInstr.textContent = mode === 'place'
      ? 'Please deposit your item and close the door'
      : 'Please collect your item and close the door';

    setTimeout(() => goTo(S.SUCCESS), 600);
  } else if (status === 'error') {
    errorMsg.textContent = message || 'An error occurred. Please try again.';
    if (currentState !== S.ERROR) goTo(S.ERROR);
  }
}

// ── Fallback state poll every 2 s ─────────────────────────────────────────────
setInterval(() => {
  fetch('/api/state')
    .then(r => r.json())
    .then(_applyState)
    .catch(() => {});
}, 2000);

// ── Init ──────────────────────────────────────────────────────────────────────
goTo(S.IDLE);
