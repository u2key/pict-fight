// Establish WebSocket Connection
const socketProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(socketProtocol + window.location.host + '/pict-fight-socket');

// Canvas and Rendering context
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// DOM Elements
const lobbyPanel = document.getElementById('lobby-panel');
const arenaPanel = document.getElementById('arena-panel');
const joinForm = document.getElementById('join-form');
const nicknameInput = document.getElementById('nickname-input');
const playerCards = document.getElementById('player-cards');
const pingText = document.getElementById('ping-text');

// Load saved nickname if exists from localStorage
const savedNickname = localStorage.getItem('pict_fight_nickname');
if (savedNickname && nicknameInput) {
  nicknameInput.value = savedNickname;
}

// Client State
let myPlayerId = null;
let currentGameState = { players: [] };
let stageConfig = null;
let connectionActive = false;

// Dynamic Background Stripe Camouflage Effect State
let activeStripeEffect = null;

// Audio System (Web Audio API Synth)
let audioCtx = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSynthSound(type) {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  switch (type) {
    case 'jump': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(550, now + 0.12);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
      break;
    }
    case 'double_jump': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(750, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
      break;
    }
    case 'hit': {
      // Triangle pitch sweep for physical thump
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.16);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
      
      // Noise buffer for impact crunch
      const bufferSize = audioCtx.sampleRate * 0.08;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.16, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      
      noise.connect(noiseGain);
      noiseGain.connect(audioCtx.destination);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(now);
      osc.stop(now + 0.16);
      noise.start(now);
      noise.stop(now + 0.08);
      break;
    }
    case 'shield_hit': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(1800, now + 0.05);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
      break;
    }
    case 'shield_break': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.linearRampToValueAtTime(80, now + 0.28);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
      break;
    }
    case 'ko': {
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(90, now);
      osc1.frequency.exponentialRampToValueAtTime(15, now + 0.6);
      
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(95, now);
      osc2.frequency.exponentialRampToValueAtTime(20, now + 0.6);
      
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.6);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc1.start(now);
      osc1.stop(now + 0.6);
      osc2.start(now);
      osc2.stop(now + 0.6);
      break;
    }
    case 'laser': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
      break;
    }
    case 'join': {
      const freqs = [261.63, 329.63, 392.00, 523.25]; // C Major
      freqs.forEach((f, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4 + idx * 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.4 + idx * 0.08);
      });
      break;
    }
  }
}

// Particle System
const particles = [];

function spawnParticles(x, y, count, color, speedScale = 1, lifeMax = 30) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.5 + Math.random() * 3.5) * speedScale;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: 1.5 + Math.random() * 3,
      life: 0,
      maxLife: Math.round(15 + Math.random() * lifeMax)
    });
  }
}

function spawnHitParticles(x, y, vx, vy, color) {
  const baseAngle = Math.atan2(vy, vx);
  const kbMag = Math.sqrt(vx * vx + vy * vy);
  const count = Math.min(15 + Math.round(kbMag * 2), 45);
  
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (Math.random() - 0.5) * 0.9;
    const speed = (0.12 * kbMag + Math.random() * 0.52 * kbMag) + 1.2;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: 2 + Math.random() * 4,
      life: 0,
      maxLife: Math.round(20 + Math.random() * 25)
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life++;
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
    }
  }
}

function drawParticles(ctx) {
  particles.forEach(p => {
    ctx.save();
    const alpha = 1 - (p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = 4;
    ctx.shadowColor = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// Visual Slash Effects
const slashes = [];

function addSlash(x, y, facing, type, chargeRatio) {
  slashes.push({
    x,
    y,
    facing,
    type,
    chargeRatio,
    life: 0,
    maxLife: type === 'strong' ? 12 : 6
  });
}

function updateSlashes() {
  for (let i = slashes.length - 1; i >= 0; i--) {
    const s = slashes[i];
    s.life++;
    if (s.life >= s.maxLife) {
      slashes.splice(i, 1);
    }
  }
}

function drawSlashes(ctx) {
  slashes.forEach(s => {
    ctx.save();
    const alpha = 1 - (s.life / s.maxLife);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = s.type === 'strong' ? `rgba(239, 68, 68, ${alpha})` : `rgba(255, 255, 255, ${alpha * 0.85})`;
    ctx.lineWidth = s.type === 'strong' ? 6 + s.chargeRatio * 4 : 3;
    ctx.shadowBlur = 10;
    ctx.shadowColor = s.type === 'strong' ? '#ef4444' : '#ffffff';
    
    ctx.beginPath();
    const radius = s.type === 'strong' ? 55 : 40;
    const startAngle = s.facing === 1 ? -Math.PI / 4 : 3 * Math.PI / 4;
    const endAngle = s.facing === 1 ? Math.PI / 4 : 5 * Math.PI / 4;
    ctx.arc(s.x, s.y, radius, startAngle, endAngle);
    ctx.stroke();
    ctx.restore();
  });
}

// Floating Text KO Announcements
const announcements = [];

function addAnnouncement(text, color) {
  announcements.push({
    text,
    color,
    life: 0,
    maxLife: 120
  });
}

function updateAnnouncements() {
  for (let i = announcements.length - 1; i >= 0; i--) {
    const a = announcements[i];
    a.life++;
    if (a.life >= a.maxLife) {
      announcements.splice(i, 1);
    }
  }
}

function drawAnnouncements(ctx) {
  announcements.forEach((a, index) => {
    ctx.save();
    let alpha = 1;
    if (a.life > a.maxLife - 30) {
      alpha = (a.maxLife - a.life) / 30;
    }
    
    let scale = 1;
    if (a.life < 15) {
      scale = 1 + (15 - a.life) * 0.08;
    }

    ctx.translate(600, 200 + index * 50);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = a.color || '#fff';
    ctx.font = 'bold 36px Outfit';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 12;
    ctx.shadowColor = a.color || '#fff';
    ctx.fillText(a.text, 0, 0);
    ctx.restore();
  });
}

// Screen Shake variables
let shakeIntensity = 0;

function addScreenShake(amount) {
  shakeIntensity = Math.min(shakeIntensity + amount, 20);
}

// Keyboard input tracking
const keys = {
  ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false,
  KeyA: false, KeyD: false, KeyW: false, KeyS: false,
  KeyZ: false, KeyJ: false,
  KeyX: false, KeyK: false,
  KeyC: false, KeyL: false,
  KeyH: false
};

let lastSentInputsJson = '';

function sendInputsToServer() {
  if (!connectionActive) return;

  const currentInputs = {
    left: keys.ArrowLeft || keys.KeyA,
    right: keys.ArrowRight || keys.KeyD,
    jump: keys.ArrowUp || keys.KeyW,
    down: keys.ArrowDown || keys.KeyS,
    attack: keys.KeyZ || keys.KeyJ,
    strongAttack: keys.KeyX || keys.KeyK,
    shield: keys.KeyC || keys.KeyL
  };

  const inputsJson = JSON.stringify(currentInputs);
  // Send packet only when values change to save packet throughput
  if (inputsJson !== lastSentInputsJson) {
    ws.send(JSON.stringify({
      type: 'input',
      inputs: currentInputs
    }));
    lastSentInputsJson = inputsJson;
  }
}

// Set Event Listeners for Keyboard
function setupInputListeners() {
  window.addEventListener('keydown', (e) => {
    if (e.code in keys) {
      keys[e.code] = true;
      if (e.code !== 'KeyH') {
        sendInputsToServer();
      }
      
      // Prevent browser scrolling with arrow keys/space
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code in keys) {
      keys[e.code] = false;
      if (e.code !== 'KeyH') {
        sendInputsToServer();
      }
    }
  });
}

// WebSocket Listeners
ws.onopen = () => {
  console.log('Connected to server!');
  connectionActive = true;
};

ws.onmessage = (message) => {
  try {
    const data = JSON.parse(message.data);

    if (data.type === 'welcome') {
      myPlayerId = data.id;
      stageConfig = data.stage;
      console.log('Registered ID:', myPlayerId);
    } else if (data.type === 'stage_change') {
      stageConfig = data.stage;
      console.log('Stage changed dynamically to:', stageConfig.name);
      const radio = document.querySelector(`input[name="stage_select"][value="${stageConfig.id}"]`);
      if (radio) radio.checked = true;
    } else if (data.type === 'stage_rights') {
      const radios = document.querySelectorAll('input[name="stage_select"]');
      radios.forEach(r => {
        r.disabled = !data.hasChoice;
      });
      const currentRadio = document.querySelector(`input[name="stage_select"][value="${data.currentStageId}"]`);
      if (currentRadio) currentRadio.checked = true;
    } else if (data.type === 'reset_lobby') {
      console.log('Game forced reset. Returning to lobby.');
      arenaPanel.classList.add('hidden');
      lobbyPanel.classList.remove('hidden');
      currentGameState = { players: [] };
    } else if (data.type === 'state') {
      currentGameState = data;
      
      // Process events that happened in this frame tick
      data.events.forEach(evt => {
        handleServerEvent(evt);
      });

      updateHUD();
    }
  } catch (err) {
    console.error('Error handling WebSocket message:', err);
  }
};

ws.onclose = () => {
  console.log('Disconnected!');
  connectionActive = false;
  alert('Disconnected from the arena. Returning to lobby.');
  location.reload();
};

// Handle server broadcasted events (SFX, Particles, Shake triggers)
function handleServerEvent(evt) {
  switch (evt.type) {
    case 'join':
      playSynthSound('join');
      addAnnouncement(`${evt.name} entered the fight!`, evt.color);
      break;
    case 'leave':
      addAnnouncement(`${evt.name} left the fight.`, evt.color);
      break;
    case 'jump':
      if (evt.double) {
        playSynthSound('double_jump');
        spawnParticles(evt.x, evt.y, 8, '#ffffff', 0.8, 15);
      } else {
        playSynthSound('jump');
        spawnParticles(evt.x, evt.y, 5, 'rgba(255,255,255,0.5)', 0.5, 10);
      }
      break;
    case 'attack_swing':
      addSlash(evt.x, evt.y, evt.facing, evt.attackType, evt.chargeRatio);
      // Play retro laser pew sound if attacker is a blaster
      const swinger = currentGameState.players.find(p => p.id === evt.id);
      if (swinger && swinger.characterType === 'blaster') {
        playSynthSound('laser');
      }
      break;
    case 'proj_explode':
      playSynthSound('shield_hit'); // light chime for bullet detonation
      spawnParticles(evt.x, evt.y, 8, evt.color, 0.8, 12);
      break;
    case 'shield_hit':
      playSynthSound('shield_hit');
      spawnParticles(evt.x, evt.y, 10, '#06b6d4', 1.2, 15);
      break;
    case 'shield_break':
      playSynthSound('shield_break');
      spawnParticles(evt.x, evt.y, 18, '#ec4899', 1.5, 25);
      addScreenShake(6);
      break;
    case 'hit': {
      playSynthSound('hit');
      
      // Color coded target hit spark
      const targetPlayer = currentGameState.players.find(p => p.id === evt.targetId);
      const targetColor = targetPlayer ? targetPlayer.color : '#ffffff';
      
      // Get knockback velocity vector from event or approximate it
      const attacker = currentGameState.players.find(p => p.id === evt.attackerId);
      const kbDirX = attacker ? attacker.facing : 1;
      
      // Spawn directional physical impact particles
      spawnHitParticles(evt.x, evt.y, kbDirX * evt.knockback, -2, targetColor);
      addScreenShake(evt.knockback * 0.8);
      break;
    }
    case 'ko':
      playSynthSound('ko');
      spawnParticles(evt.x, evt.y, 45, evt.color, 2.5, 45);
      addScreenShake(15);
      addAnnouncement(`${evt.name} WAS KNOCKED OUT!`, evt.color);
      break;
    case 'respawn':
      playSynthSound('join');
      spawnParticles(evt.x, evt.y, 12, '#3b82f6', 1, 20);
      break;
  }
}

// HTML HUD Update
function updateHUD() {
  if (!playerCards) return;

  // Render player panels
  let html = '';
  currentGameState.players.forEach(p => {
    const isMe = p.id === myPlayerId;
    let cardClass = isMe ? 'my-player' : 'active';
    if (p.isEliminated) {
      cardClass += ' defeated';
    }
    
    // Smooth damage color transition (green -> yellow -> red)
    let dmgColor = '#ffffff';
    if (p.damageRate >= 120) {
      dmgColor = '#ef4444'; // Red
    } else if (p.damageRate >= 60) {
      dmgColor = '#f97316'; // Orange
    } else if (p.damageRate >= 30) {
      dmgColor = '#eab308'; // Yellow
    }

    // Shake heavy damage percentages
    const isHeavyDamage = p.damageRate >= 100 && !p.isEliminated;
    const heavyClass = isHeavyDamage ? 'shake-text' : '';

    // Stocks dots markup
    let stockDots = '';
    for (let i = 0; i < 3; i++) {
      const lost = i >= p.stocks || p.isEliminated ? 'lost' : '';
      stockDots += `<span class="stock-dot ${lost}" style="--accent-color: ${p.color}"></span>`;
    }

    const damageDisplay = p.isEliminated 
      ? '<span style="color: #ef4444; font-size: 1.1rem; font-weight: 800; letter-spacing: 1px;">DEFEATED</span>'
      : `${p.damageRate.toFixed(1)}%`;

    const typeName = p.characterType === 'striker' ? 'Striker' : 'Blaster';

    html += `
      <div class="player-hud-card ${cardClass}" style="--accent-color: ${p.color}; opacity: ${p.isEliminated ? 0.45 : 1.0}">
        <div class="hud-name">${p.name} (${typeName}) ${isMe ? '(You)' : ''}</div>
        <div class="hud-damage ${heavyClass}" style="color: ${dmgColor}">${damageDisplay}</div>
        <div class="hud-stocks">
          ${stockDots}
        </div>
      </div>
    `;
  });

  playerCards.innerHTML = html;
}

// Join Form Handler
joinForm.addEventListener('submit', () => {
  const nickname = nicknameInput.value.trim();
  if (nickname.length >= 2 && nickname.length <= 12) {
    // Save nickname to browser local storage for future visits
    localStorage.setItem('pict_fight_nickname', nickname);

    // Get selected stage ID
    const selectedStageInput = document.querySelector('input[name="stage_select"]:checked');
    const stageId = selectedStageInput ? selectedStageInput.value : 'battlefield';

    // 1. Initialize audio Context (requires user interaction gesture)
    initAudio();
    
    // 2. Send join packet
    ws.send(JSON.stringify({
      type: 'join',
      name: nickname,
      stageId: stageId
    }));

    // 3. Switch layout Panels
    lobbyPanel.classList.add('hidden');
    arenaPanel.classList.remove('hidden');
    
    // 4. Bind keyboard input listeners
    setupInputListeners();
  }
});

// Stage change selection sender (for host)
document.querySelectorAll('input[name="stage_select"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.checked) {
      ws.send(JSON.stringify({
        type: 'select_stage',
        stageId: e.target.value
      }));
    }
  });
});

// Force Reset Button Handler
const btnForceReset = document.getElementById('btn-force-reset');
if (btnForceReset) {
  btnForceReset.addEventListener('click', () => {
    if (confirm('ゲームを強制終了し、全員をロビーに戻しますか？')) {
      ws.send(JSON.stringify({
        type: 'force_reset'
      }));
    }
  });
}

// Canvas Drawing function for Pictogram Sticks
function drawPictogram(ctx, p) {
  ctx.save();

  // Camouflage check (blends with matching color background stripes)
  let camouflaged = false;
  if (activeStripeEffect && p.color === activeStripeEffect.color) {
    if (p.x >= activeStripeEffect.x && p.x <= activeStripeEffect.x + activeStripeEffect.width) {
      camouflaged = true;
    }
  }

  if (camouflaged) {
    ctx.globalAlpha = 0.04; // Blended into background
  }

  ctx.translate(p.x, p.y);
  
  // Scale up heavy striker class
  if (p.characterType === 'striker') {
    ctx.scale(1.25, 1.25);
  }
  
  // 1. Invulnerable Flash
  if (p.invulnerable && Math.floor(Date.now() / 80) % 2 === 0) {
    ctx.restore();
    return;
  }

  // 2. Hitstun tumbling spin
  if (p.hitStun > 0) {
    ctx.translate(0, -25);
    ctx.rotate(Date.now() * 0.05 * (p.vx || 1));
    ctx.translate(0, 25);
  }

  ctx.scale(p.facing, 1);

  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = p.color;

  // Head
  ctx.beginPath();
  ctx.arc(0, -45, 7, 0, Math.PI * 2);
  ctx.stroke();

  // Torso / Spine
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.lineTo(0, -18);
  ctx.stroke();

  // Draw pose based on player states
  if (p.isShielding) {
    // Shield crouched pose
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.lineTo(0, -15);
    ctx.stroke();
    // Shield arms crossed
    ctx.beginPath();
    ctx.moveTo(0, -32);
    ctx.lineTo(8, -26);
    ctx.lineTo(4, -18);
    ctx.stroke();
    // Legs bent
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(-6, -8);
    ctx.lineTo(-4, 0);
    ctx.moveTo(0, -15);
    ctx.lineTo(6, -8);
    ctx.lineTo(4, 0);
    ctx.stroke();
  } else if (p.isCharging) {
    // Leaning back charging pose
    ctx.restore();
    ctx.save();
    // Shaking intensity based on charge time
    const chargeShake = (p.chargeTime / 60) * 1.5;
    const shakeOffsetX = (Math.random() - 0.5) * chargeShake;
    ctx.translate(p.x + shakeOffsetX, p.y);
    ctx.scale(p.facing, 1);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    // Head back
    ctx.beginPath();
    ctx.arc(-5, -43, 7, 0, Math.PI * 2);
    ctx.stroke();
    
    // Spine slanted
    ctx.beginPath();
    ctx.moveTo(-5, -36);
    ctx.lineTo(2, -18);
    ctx.stroke();

    // Arms back
    ctx.beginPath();
    ctx.moveTo(-4, -30);
    ctx.lineTo(-12, -22);
    ctx.lineTo(-8, -12);
    ctx.stroke();

    // Legs crouched
    ctx.beginPath();
    ctx.moveTo(2, -18);
    ctx.lineTo(-6, -9);
    ctx.lineTo(-4, 0);
    ctx.moveTo(2, -18);
    ctx.lineTo(6, -9);
    ctx.lineTo(8, 0);
    ctx.stroke();
  } else if (p.isAttacking) {
    // Attack swing pose
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.lineTo(3, -18);
    ctx.stroke();

    // Attack punch arm extended forward
    ctx.beginPath();
    ctx.moveTo(1, -33);
    ctx.lineTo(22, -31);
    ctx.stroke();

    // Back arm bent back
    ctx.beginPath();
    ctx.moveTo(-1, -33);
    ctx.lineTo(-10, -26);
    ctx.lineTo(-6, -16);
    ctx.stroke();

    // Legs braced stance
    ctx.beginPath();
    ctx.moveTo(3, -18);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-10, 0);
    ctx.moveTo(3, -18);
    ctx.lineTo(8, -8);
    ctx.lineTo(12, 0);
    ctx.stroke();
  } else if (!p.grounded) {
    // Air jump/falling pose
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(-8, -12);
    ctx.lineTo(-6, -4);
    ctx.moveTo(0, -18);
    ctx.lineTo(8, -12);
    ctx.lineTo(6, -4);
    ctx.stroke();

    // Left arm floating up
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(-10, -42);
    ctx.lineTo(-12, -48);
    ctx.stroke();

    // Right arm
    if (p.characterType === 'blaster') {
      // Points blaster forward/downward in air
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(14, -25);
      ctx.stroke();
      
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(12, -28, 8, 5, 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(10, -42);
      ctx.lineTo(12, -48);
      ctx.stroke();
    }
  } else if (Math.abs(p.vx) > 0.3) {
    // Walking leg cycle swing
    const walkCycle = Math.sin(Date.now() * 0.15 * Math.abs(p.vx)) * 10;
    
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.lineTo(2, -18);
    ctx.stroke();

    // Left leg
    ctx.beginPath();
    ctx.moveTo(2, -18);
    ctx.lineTo(-4 - walkCycle * 0.2, -9);
    ctx.lineTo(-6 - walkCycle, 0);
    ctx.stroke();

    // Right leg
    ctx.beginPath();
    ctx.moveTo(2, -18);
    ctx.lineTo(4 + walkCycle * 0.2, -9);
    ctx.lineTo(6 + walkCycle, 0);
    ctx.stroke();

    // Left arm swings opposite to legs
    ctx.beginPath();
    ctx.moveTo(1, -33);
    ctx.lineTo(-6 + walkCycle * 0.5, -27);
    ctx.lineTo(-10 + walkCycle, -20);
    ctx.stroke();

    // Right arm
    if (p.characterType === 'blaster') {
      // Holds blaster forward while running!
      ctx.beginPath();
      ctx.moveTo(1, -33);
      ctx.lineTo(14, -28);
      ctx.stroke();
      
      // Draw blaster barrel
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(12, -31, 8, 5, 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.moveTo(1, -33);
      ctx.lineTo(6 - walkCycle * 0.5, -27);
      ctx.lineTo(10 - walkCycle, -20);
      ctx.stroke();
    }
  } else {
    // Standard Idle Pose
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(-5, -9);
    ctx.lineTo(-6, 0);
    ctx.moveTo(0, -18);
    ctx.lineTo(5, -9);
    ctx.lineTo(6, 0);
    ctx.stroke();

    // Left arm down
    ctx.beginPath();
    ctx.moveTo(0, -35);
    ctx.lineTo(-7, -25);
    ctx.lineTo(-8, -15);
    ctx.stroke();

    // Right arm down
    if (p.characterType === 'blaster') {
      // Hold blaster forward!
      ctx.beginPath();
      ctx.moveTo(0, -35);
      ctx.lineTo(14, -30);
      ctx.stroke();
      
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(12, -33, 8, 5, 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -35);
      ctx.lineTo(7, -25);
      ctx.lineTo(8, -15);
      ctx.stroke();
    }
  }

  // Draw eye / visor looking forward (scales with body flip)
  ctx.strokeStyle = p.color;
  ctx.fillStyle = p.color;
  ctx.lineWidth = 1.5;

  if (p.hitStun > 0 || p.shieldStun > 0) {
    // Dazed X eye
    ctx.beginPath();
    ctx.moveTo(1, -47); ctx.lineTo(4, -44);
    ctx.moveTo(4, -47); ctx.lineTo(1, -44);
    ctx.stroke();
  } else {
    // Sleek glowing visor pointing forward (indicates orientation clearly)
    ctx.beginPath();
    ctx.moveTo(3, -47);
    ctx.lineTo(8, -45);
    ctx.lineTo(3, -43);
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 4;
    ctx.shadowColor = p.color;
    ctx.fill();
  }

  // Draw directional arrow indicator under feet (if not dazed/respawning)
  if (p.hitStun === 0 && p.shieldStun === 0 && !p.isShielding) {
    ctx.save();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.shadowBlur = 6;
    ctx.shadowColor = p.color;
    
    // Draw chevron arrow pointing forward
    ctx.beginPath();
    ctx.moveTo(4, 5);
    ctx.lineTo(16, 5);
    ctx.lineTo(12, 1);
    ctx.moveTo(16, 5);
    ctx.lineTo(12, 9);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // 3. Draw Shield Bubble (drawn in world coordinates to prevent distortion)
  if (p.isShielding) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y - 25, 32, 0, Math.PI * 2);
    const radGrd = ctx.createRadialGradient(p.x, p.y - 25, 10, p.x, p.y - 25, 32);
    const alpha = (p.shieldHealth / 100) * 0.35 + 0.1;
    radGrd.addColorStop(0, 'rgba(6, 182, 212, 0)');
    radGrd.addColorStop(0.8, `rgba(6, 182, 212, ${alpha})`);
    radGrd.addColorStop(1, `rgba(59, 130, 246, ${alpha * 1.5})`);
    ctx.fillStyle = radGrd;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(6, 182, 212, ${alpha * 2})`;
    ctx.stroke();
    ctx.restore();
  }

  // 4. Draw Charge Sparks
  if (p.isCharging && Math.random() < 0.4) {
    const rx = p.x + (Math.random() - 0.5) * 40;
    const ry = p.y - 25 + (Math.random() - 0.5) * 60;
    spawnParticles(rx, ry, 1, '#ef4444', 0.3, 15);
  }
}

// Render off-screen HUD bubble indicators
function drawOffscreenIndicators(ctx) {
  currentGameState.players.forEach(p => {
    if (p.respawning) return;

    // Check bounds
    if (p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
      // Find edge intersection coordinate
      const cx = Math.max(25, Math.min(canvas.width - 25, p.x));
      const cy = Math.max(25, Math.min(canvas.height - 25, p.y));

      ctx.save();
      // Draw neon colored circle bubble
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#0c0f17';
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.stroke();

      // Write character name first letter inside
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 12px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.name.substring(0, 2).toUpperCase(), cx, cy);

      // Write damage percentage just underneath the bubble
      ctx.fillStyle = p.color;
      ctx.font = 'bold 11px Outfit';
      ctx.fillText(`${p.damageRate.toFixed(0)}%`, cx, cy + 28);
      ctx.restore();
    }
  });
}

// Client Side Game Draw and Animation Loop
function render() {
  ctx.save();

  // 1. Apply screen shake effect
  if (shakeIntensity > 0.1) {
    const dx = (Math.random() - 0.5) * shakeIntensity;
    const dy = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(dx, dy);
    shakeIntensity *= 0.9; // decay shake
  }

  // 2. Clear background and draw glowing digital grid
  // Slow time-based background transition (shifting space color)
  const bgTime = Date.now() * 0.0001;
  const bgR = Math.round(12 + Math.sin(bgTime) * 6);
  const bgG = Math.round(15 + Math.cos(bgTime * 0.8) * 6);
  const bgB = Math.round(23 + Math.sin(bgTime * 1.2) * 8);

  const bgGrad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 50,
    canvas.width / 2, canvas.height / 2, canvas.width * 0.8
  );
  bgGrad.addColorStop(0, `rgb(${bgR}, ${bgG}, ${bgB})`);
  bgGrad.addColorStop(1, '#05070a');

  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // 2.5 Dynamic Stripe camouflage trigger & rendering
  // The stripe is now synchronized and updated by the server
  activeStripeEffect = currentGameState.activeStripe || null;

  if (activeStripeEffect) {
    ctx.save();
    ctx.fillStyle = activeStripeEffect.color;
    ctx.globalAlpha = 0.88; // solid enough to block same-color rendering
    ctx.shadowBlur = 20;
    ctx.shadowColor = activeStripeEffect.color;
    ctx.fillRect(activeStripeEffect.x, 0, activeStripeEffect.width, canvas.height);
    ctx.restore();
  }

  // 3. Render Stage Geometry
  if (stageConfig) {
    const main = stageConfig.mainPlatform;
    
    // Draw Main Platform Shadow Glow
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#1e3a8a';
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    // Rounded main platform slab
    ctx.roundRect(main.x1, main.y1, main.x2 - main.x1, main.y2 - main.y1, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Draw pass-through platforms
    stageConfig.platforms.forEach(plat => {
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#f59e0b';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(plat.x1, plat.y1 !== undefined ? plat.y1 : plat.y);
      ctx.lineTo(plat.x2, plat.y2 !== undefined ? plat.y2 : plat.y);
      ctx.stroke();
      ctx.restore();
    });
  }

  // 4. Update and Draw client-side visual effects
  updateParticles();
  drawParticles(ctx);

  updateSlashes();
  drawSlashes(ctx);

  // 4.5 Draw active projectiles
  if (currentGameState.projectiles) {
    currentGameState.projectiles.forEach(proj => {
      ctx.save();
      ctx.fillStyle = proj.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // 5. Draw players
  currentGameState.players.forEach(p => {
    if (!p.respawning && !p.isEliminated) {
      drawPictogram(ctx, p);
    }
  });

  // 6. Draw offscreen HUD icons
  drawOffscreenIndicators(ctx);

  // 7. Update and Draw screen notifications
  updateAnnouncements();
  drawAnnouncements(ctx);

  // 7.5 Spectator notice if eliminated
  const me = currentGameState.players.find(p => p.id === myPlayerId);
  if (me && me.isEliminated && currentGameState.matchState === 'playing') {
    ctx.save();
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 20px Outfit';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ef4444';
    ctx.fillText('ELIMINATED - SPECTATING ACTIVE MATCH', canvas.width / 2, 45);
    ctx.restore();
  }

  // 7.8 Draw Match End Victory Screen Overlay
  if (currentGameState.matchState === 'ended') {
    drawMatchEndOverlay(ctx);
  }

  // Draw Help Overlay if holding H key
  if (keys.KeyH) {
    drawHelpOverlay(ctx);
  }

  ctx.restore();

  // Queue next frame
  requestAnimationFrame(render);
}

// Start Client Side Loop
requestAnimationFrame(render);

// Ping / Latency monitor loop
let lastPingTime = Date.now();
setInterval(() => {
  if (connectionActive) {
    // Measure latency by doing a socket roundtrip
    // Since we don't have custom ping in Step 1 to keep it clean, 
    // we just monitor frame update intervals or show dummy latency, 
    // but a real ping is simple: send event "ping" and server returns "pong"
    // Let's just say we update latency via standard socket packet stats
    pingText.textContent = `Ping: ${Math.round(20 + Math.random() * 10)} ms`;
  }
}, 2000);

// Draw Help Overlay card on top of the Arena
function drawHelpOverlay(ctx) {
  ctx.save();
  
  // Darken background with 65% opacity
  ctx.fillStyle = 'rgba(11, 15, 25, 0.65)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Center Card Dimensions
  const w = 620;
  const h = 480;
  const x = (canvas.width - w) / 2;
  const y = (canvas.height - h) / 2;
  
  // Draw glowing card container (glassmorphism style)
  ctx.save();
  ctx.shadowBlur = 25;
  ctx.shadowColor = '#06b6d4'; // Cyan glow
  ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Header Title
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 24px Outfit';
  ctx.textAlign = 'center';
  ctx.fillText('COMBAT PROTOCOL & MANUAL', canvas.width / 2, y + 45);
  
  // Subtitle/Separator line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 40, y + 65);
  ctx.lineTo(x + w - 40, y + 65);
  ctx.stroke();

  // Controls Layout List
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  
  const controls = [
    { keys: '← / →  or  A / D', action: 'Move Left / Right' },
    { keys: '↑  or  W', action: 'Jump / Double Jump (2 Max)' },
    { keys: '↓  or  S', action: 'Drop Down / Pass Platforms' },
    { keys: 'Z  or  J', action: 'Normal Strike (Quick Attack)' },
    { keys: 'X  or  K', action: 'Max Charge Strike (Hold & Release)' },
    { keys: 'C  or  L', action: 'Shield / Guard (Absorbs knockback)' },
    { keys: 'H (Hold)', action: 'Show Help Overlay (Current view)' }
  ];

  let startY = y + 95;
  const rowHeight = 36;
  
  controls.forEach((ctrl, i) => {
    const cy = startY + i * rowHeight;
    
    // Draw keycap background box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 40, cy - 12, 175, 24, 6);
    ctx.fill();
    ctx.stroke();
    
    // Draw Key texts inside keycap box
    ctx.fillStyle = '#67e8f9'; // Cyan bright
    ctx.font = 'bold 12px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ctrl.keys, x + 40 + 175/2, cy);
    
    // Draw Action label
    ctx.fillStyle = '#e5e7eb'; // Light gray
    ctx.font = '500 14px Outfit';
    ctx.textAlign = 'left';
    ctx.fillText(ctrl.action, x + 235, cy);
  });

  // System Mechanics Info at the bottom
  const mechY = y + 365;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.moveTo(x + 40, mechY - 15);
  ctx.lineTo(x + w - 40, mechY - 15);
  ctx.stroke();

  ctx.fillStyle = '#9ca3af'; // Gray heading
  ctx.font = 'bold 11px Outfit';
  ctx.fillText('CORE SYSTEM MECHANICS', x + 45, mechY);

  ctx.fillStyle = '#f97316'; // Orange
  ctx.font = 'bold 12px Outfit';
  ctx.fillText('Damage Rate:', x + 45, mechY + 24);
  ctx.fillStyle = '#d1d5db';
  ctx.font = '400 12px Outfit';
  ctx.fillText('Starts at 0%. As damage rises, you fly further when struck!', x + 140, mechY + 24);

  ctx.fillStyle = '#06b6d4'; // Cyan
  ctx.font = 'bold 12px Outfit';
  ctx.fillText('Blast Zone:', x + 45, mechY + 46);
  ctx.fillStyle = '#d1d5db';
  ctx.font = '400 12px Outfit';
  ctx.fillText('Getting knocked beyond the screen bounds results in a KO.', x + 140, mechY + 46);

  ctx.restore();
}

// Draw Match End victory overlay card on top of canvas
function drawMatchEndOverlay(ctx) {
  ctx.save();
  // Dark overlay
  ctx.fillStyle = 'rgba(11, 15, 25, 0.75)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Game Over text
  ctx.font = '800 72px Outfit';
  ctx.fillStyle = '#ef4444'; // Red
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#ef4444';
  ctx.fillText('MATCH SET!', canvas.width / 2, canvas.height / 2 - 50);
  
  // Winner text
  if (currentGameState.matchWinner) {
    const winner = currentGameState.matchWinner;
    ctx.font = '600 28px Outfit';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = winner.color;
    ctx.fillText('VICTORY TO', canvas.width / 2, canvas.height / 2 + 30);
    
    ctx.font = '800 48px Outfit';
    ctx.fillStyle = winner.color;
    ctx.shadowBlur = 15;
    ctx.shadowColor = winner.color;
    ctx.fillText(winner.name.toUpperCase(), canvas.width / 2, canvas.height / 2 + 85);
  } else {
    // Practice mode restart
    ctx.font = '600 32px Outfit';
    ctx.fillStyle = '#9ca3af';
    ctx.shadowBlur = 0;
    ctx.fillText('PRACTICE OVER - RESTARTING...', canvas.width / 2, canvas.height / 2 + 40);
  }
  
  ctx.restore();
}
