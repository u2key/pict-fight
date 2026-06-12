const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Game Constants
const TICK_RATE = 60;
const TICK_TIME = 1000 / TICK_RATE;

const STAGE = {
  width: 1200,
  height: 800,
  mainPlatform: { x1: 300, x2: 900, y1: 500, y2: 530 },
  platforms: [
    { x1: 350, x2: 550, y: 390 }, // Left semi-solid platform
    { x1: 650, x2: 850, y: 390 }, // Right semi-solid platform
    { x1: 500, x2: 700, y: 280 }  // Top semi-solid platform
  ],
  blastZones: {
    left: -200,
    right: 1400,
    top: -300,
    bottom: 1000
  }
};

const SPAWN_POINTS = [
  { x: 450, y: 350 },
  { x: 750, y: 350 },
  { x: 600, y: 200 }
];

const COLORS = [
  '#3b82f6', // P1: Vibrant Blue
  '#ef4444', // P2: Vibrant Red
  '#10b981', // P3: Vibrant Green
  '#f59e0b', // P4: Amber/Orange
  '#ec4899', // P5: Pink
  '#8b5cf6'  // P6: Purple
];

let colorIndex = 0;

// Game State
const players = {};      // id -> player object
const clientInputs = {}; // id -> current inputs
const prevInputs = {};   // id -> inputs from the previous tick
let events = [];         // List of game events that happened in the current tick
let matchState = 'playing'; // 'playing' or 'ended'
let matchEndTimer = 0;      // Ticks remaining in the match end screen
let matchWinner = null;     // Winner details
let projectiles = [];       // Active projectiles list
let nextProjId = 0;         // ID index for projectiles

// Helper to get a random spawn point
function getRandomSpawnPoint() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

// Player initialization
function createPlayer(id, name) {
  const spawn = getRandomSpawnPoint();
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  const characterType = Math.random() < 0.5 ? 'striker' : 'blaster';
  const isStriker = characterType === 'striker';

  return {
    id,
    name: name || `Player ${colorIndex}`,
    color,
    characterType, // 'striker' or 'blaster'
    x: spawn.x,
    y: spawn.y,
    prevX: spawn.x,
    prevY: spawn.y,
    vx: 0,
    vy: 0,
    width: isStriker ? 38 : 30,
    height: isStriker ? 69 : 55,
    facing: 1, // 1 for right, -1 for left
    grounded: false,
    jumpCount: 0,
    damageRate: 0, // Starts at 0.0%
    stocks: 3,
    isEliminated: false,
    isShielding: false,
    shieldHealth: 100,
    shieldStun: 0, // Ticks of stun if shield is broken
    hitStun: 0,    // Ticks of stun when knocked back
    invulnerableTimer: 120, // Spawn invulnerability (2 seconds at 60Hz)
    respawnTimer: 0,       // Cooldown before returning to play after KO
    isAttacking: false,
    attackType: null, // 'normal' or 'strong'
    attackFrame: 0,
    attackCooldown: 0,
    isCharging: false,
    chargeTime: 0, // How long strong attack has been charged
    hitPlayers: [] // Array of player IDs hit in the current attack swing
  };
}

// WebSocket Connection Handling
wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).substr(2, 9);
  console.log(`Client connected. Assigning ID: ${playerId}`);

  // Send a welcome packet with client ID and stage configuration
  ws.send(JSON.stringify({
    type: 'welcome',
    id: playerId,
    stage: STAGE
  }));

  // Setup empty inputs
  clientInputs[playerId] = {
    left: false,
    right: false,
    jump: false,
    down: false,
    attack: false,
    strongAttack: false,
    shield: false
  };
  prevInputs[playerId] = { ...clientInputs[playerId] };

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'join') {
        // Player joins the arena
        players[playerId] = createPlayer(playerId, data.name);
        events.push({
          type: 'join',
          name: players[playerId].name,
          color: players[playerId].color,
          x: players[playerId].x,
          y: players[playerId].y
        });
        console.log(`${players[playerId].name} joined the game.`);
      } else if (data.type === 'input') {
        // Update input buffer
        if (clientInputs[playerId]) {
          clientInputs[playerId] = {
            left: !!data.inputs.left,
            right: !!data.inputs.right,
            jump: !!data.inputs.jump,
            down: !!data.inputs.down,
            attack: !!data.inputs.attack,
            strongAttack: !!data.inputs.strongAttack,
            shield: !!data.inputs.shield
          };
        }
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${playerId}`);
    if (players[playerId]) {
      events.push({
        type: 'leave',
        name: players[playerId].name,
        color: players[playerId].color
      });
      delete players[playerId];
      checkMatchEnd(); // Check if match should end now
    }
    delete clientInputs[playerId];
    delete prevInputs[playerId];
  });
});

// Update single player physics
function updatePlayer(id) {
  const p = players[id];
  if (p.isEliminated) return;

  const inputs = clientInputs[id] || {};
  const prevIn = prevInputs[id] || {};

  // 1. Respawn State
  if (p.respawnTimer > 0) {
    p.respawnTimer--;
    if (p.respawnTimer === 0) {
      const spawn = getRandomSpawnPoint();
      p.x = spawn.x;
      p.y = spawn.y;
      p.vx = 0;
      p.vy = 0;
      p.damageRate = 0;
      p.invulnerableTimer = 120; // 2 seconds of invulnerability
      p.grounded = false;
      p.jumpCount = 0;
      p.isAttacking = false;
      p.isCharging = false;
      p.chargeTime = 0;
      p.hitStun = 0;
      p.shieldStun = 0;
      p.shieldHealth = 100;
      events.push({ type: 'respawn', id: p.id, x: p.x, y: p.y });
    }
    // Save previous inputs
    prevInputs[id] = { ...inputs };
    return;
  }

  // Invulnerability timer
  if (p.invulnerableTimer > 0) {
    p.invulnerableTimer--;
  }

  // Save current position as previous before applying movement
  p.prevX = p.x;
  p.prevY = p.y;

  // 2. Hitstun State (Fly away, restricted controls)
  if (p.hitStun > 0) {
    p.hitStun--;
    // Apply gravity
    p.vy += 0.4;
    p.vy = Math.min(p.vy, 15); // terminal velocity

    // Slow down gradually (calibrated tighter friction to prevent excessive floating)
    p.vx *= 0.95;
    p.vy *= 0.95;

    p.x += p.vx;
    p.y += p.vy;

    // Resolve platform collisions to prevent phasing through the stage floor
    p.grounded = false;
    resolveCollisions(p, inputs);

    // Check boundaries/KO
    checkKO(p);

    // Save previous inputs
    prevInputs[id] = { ...inputs };
    return;
  }

  // 3. Shield Stun State (dazed if shield is broken)
  if (p.shieldStun > 0) {
    p.shieldStun--;
    // Apply gravity
    p.vy += 0.4;
    p.vy = Math.min(p.vy, 15);
    p.vx *= 0.8; // High ground friction

    p.x += p.vx;
    p.y += p.vy;

    resolveCollisions(p, inputs);
    checkKO(p);

    prevInputs[id] = { ...inputs };
    return;
  }

  // 4. Shielding Action
  if (inputs.shield && p.grounded && !p.isAttacking && !p.isCharging) {
    p.isShielding = true;
    p.vx *= 0.7; // Brake quickly
    p.shieldHealth -= 0.2; // Drain shield
    if (p.shieldHealth <= 0) {
      p.shieldHealth = 0;
      p.isShielding = false;
      p.shieldStun = 180; // 3 seconds of daze
      events.push({ type: 'shield_break', id: p.id, x: p.x, y: p.y - p.height / 2 });
    }
  } else {
    p.isShielding = false;
    if (p.shieldHealth < 100) {
      p.shieldHealth = Math.min(100, p.shieldHealth + 0.3); // Regenerate shield
    }
  }

  const isStriker = p.characterType === 'striker';
  const isBlaster = p.characterType === 'blaster';

  // 5. Charging Action
  if (isStriker) {
    // Striker (Heavy Melee) uses strongAttack (X key) on ground
    if (inputs.strongAttack && p.grounded && !p.isAttacking && !p.isShielding) {
      p.isCharging = true;
      p.chargeTime = Math.min(p.chargeTime + 1, 60);
      p.vx *= 0.8;
    } else if (p.isCharging && !inputs.strongAttack) {
      // Release Striker Strong Attack!
      p.isCharging = false;
      p.isAttacking = true;
      p.attackType = 'strong';
      p.attackFrame = 20;
      p.attackCooldown = 45;
      p.hitPlayers = [];

      // Step-in for striker to close distance
      p.vx += p.facing * 3.5;

      const chargeRatio = p.chargeTime / 60.0;
      performAttack(p, 'strong', chargeRatio);
      p.chargeTime = 0;
    }
  } else if (isBlaster) {
    // Blaster (Ranged) uses attack (Z key) for charging, works in mid-air too!
    if (inputs.attack && !p.isAttacking && !p.isShielding) {
      p.isCharging = true;
      p.chargeTime = Math.min(p.chargeTime + 1, 60);
      if (p.grounded) {
        p.vx *= 0.8;
      }
    } else if (p.isCharging && !inputs.attack) {
      // Release Blaster Charge Attack!
      p.isCharging = false;
      p.isAttacking = true;
      p.attackType = p.chargeTime >= 20 ? 'strong' : 'normal'; // visually strong if charged a bit
      p.attackFrame = 10;
      p.attackCooldown = 0; // Cooldown disabled for normal/charged attack
      p.hitPlayers = [];

      const chargeRatio = p.chargeTime / 60.0;
      performAttack(p, 'normal', chargeRatio);
      p.chargeTime = 0;
    }
  }

  // 6. Normal Movement and Normal Attacks (if not shielding/charging)
  if (!p.isShielding && !p.isCharging) {
    const isStriker = p.characterType === 'striker';
    // Horizontal acceleration (heavy striker is slower but moves with inertia)
    const accel = p.grounded ? (isStriker ? 0.6 : 0.8) : (isStriker ? 0.3 : 0.4);
    const maxSpeed = p.grounded ? (isStriker ? 6.5 : 8) : (isStriker ? 5.0 : 6);

    if (inputs.left) {
      p.vx = Math.max(-maxSpeed, p.vx - accel);
      p.facing = -1;
    } else if (inputs.right) {
      p.vx = Math.min(maxSpeed, p.vx + accel);
      p.facing = 1;
    } else {
      // Apply deceleration/friction
      const friction = p.grounded ? 0.75 : 0.95;
      p.vx *= friction;
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
    }

    // Gravity
    p.vy += 0.4;
    p.vy = Math.min(p.vy, 15); // Terminal velocity

    // Jumping (needs trigger check: pressed now, not pressed last tick)
    const jumpPressed = inputs.jump && !prevIn.jump;
    if (jumpPressed) {
      if (p.grounded) {
        p.vy = isStriker ? -10.0 : -11;
        p.grounded = false;
        p.jumpCount = 1;
        events.push({ type: 'jump', x: p.x, y: p.y, double: false });
      } else if (p.jumpCount < 2) {
        p.vy = isStriker ? -9.5 : -10.5;
        p.jumpCount = 2;
        events.push({ type: 'jump', x: p.x, y: p.y, double: true });
      }
    }

    // Drop down platform
    if (inputs.down && p.grounded) {
      // Check if standing on one of the pass-through platforms
      const standOnPassThrough = STAGE.platforms.some(plat => {
        const px1 = p.x - p.width / 2;
        const px2 = p.x + p.width / 2;
        return Math.abs(p.y - plat.y) < 1.0 && px1 < plat.x2 && px2 > plat.x1;
      });
      if (standOnPassThrough) {
        p.y += 5; // force drop down
        p.grounded = false;
      }
    }

    // Cooldown decrement
    if (p.attackCooldown > 0) p.attackCooldown--;

    // Execute Normal Attack (Striker only. Blaster attack is handled on release)
    if (isStriker && inputs.attack && !prevIn.attack && p.attackCooldown === 0 && !p.isAttacking) {
      p.isAttacking = true;
      p.attackType = 'normal';
      p.attackFrame = 12;
      p.attackCooldown = 0; // Cooldown disabled for normal attack
      p.hitPlayers = [];

      // Step-in for striker to close distance
      p.vx += p.facing * 2.0;

      performAttack(p, 'normal', 0);
    }
  }

  // Update attack frame animation
  if (p.isAttacking) {
    p.attackFrame--;
    if (p.attackFrame <= 0) {
      p.isAttacking = false;
      p.attackType = null;
    }
  }

  // Apply final velocity to position
  p.x += p.vx;
  p.y += p.vy;

  // Resolve collisions
  p.grounded = false; // reset grounded flag, let resolver set it
  resolveCollisions(p, inputs);

  // Check blast zones/KO
  checkKO(p);

  // Save inputs for transition checks
  prevInputs[id] = { ...inputs };
}

// Perform attack hitbox checks
function performAttack(attacker, type, chargeRatio) {
  if (attacker.characterType === 'blaster') {
    // Blaster Character: Spawn Projectile instead of Melee check
    // Now normal attack ('normal') triggers charge behavior based on chargeRatio
    const size = 10 + chargeRatio * 25; // 10 to 35
    const speed = 12 + chargeRatio * 2; // 12 to 14 (fast & heavy)
    const dmg = 3.5 + chargeRatio * 14.5; // 3.5 to 18.0
    const baseKb = 0.8 + chargeRatio * 5.2; // 0.8 to 6.0
    const scaleKb = 0.01 + chargeRatio * 0.14; // 0.01 to 0.15
    const life = 90 + Math.round(chargeRatio * 60); // 90 to 150

    // Broadcast attack swing event for visual client effects (visualize as strong attack if charged)
    events.push({
      type: 'attack_swing',
      id: attacker.id,
      attackType: chargeRatio >= 0.33 ? 'strong' : 'normal',
      chargeRatio,
      facing: attacker.facing,
      x: attacker.x,
      y: attacker.y - attacker.height / 2
    });

    const proj = {
      id: 'proj_' + nextProjId++,
      ownerId: attacker.id,
      x: attacker.x + attacker.facing * 25,
      y: attacker.y - attacker.height / 2,
      vx: attacker.facing * speed,
      vy: 0,
      size: size,
      damage: dmg,
      baseKb: baseKb,
      scaleKb: scaleKb,
      color: attacker.color,
      life: life
    };
    projectiles.push(proj);
    return;
  }

  // Striker Character: Perform normal Melee check
  const aw = type === 'strong' ? 110 : 85;
  const ah = type === 'strong' ? 60 : 55;
  const ox = attacker.facing * (type === 'strong' ? 55 : 45);

  const ax1 = attacker.x + ox - aw / 2;
  const ax2 = attacker.x + ox + aw / 2;
  const ay1 = attacker.y - attacker.height / 2 - ah / 2;
  const ay2 = attacker.y - attacker.height / 2 + ah / 2;

  // Broadcast attack swing event for visual client effects
  events.push({
    type: 'attack_swing',
    id: attacker.id,
    attackType: type,
    chargeRatio,
    facing: attacker.facing,
    x: attacker.x,
    y: attacker.y - attacker.height / 2
  });

  // Check all potential targets
  for (const id in players) {
    if (id === attacker.id) continue;
    const target = players[id];

    // Ignore invulnerable or respawning targets
    if (target.respawnTimer > 0 || target.invulnerableTimer > 0) continue;

    const tx1 = target.x - target.width / 2;
    const tx2 = target.x + target.width / 2;
    const ty1 = target.y - target.height;
    const ty2 = target.y;

    // AABB intersection check
    const overlap = ax1 < tx2 && ax2 > tx1 && ay1 < ty2 && ay2 > ty1;
    if (overlap && !attacker.hitPlayers.includes(target.id)) {
      attacker.hitPlayers.push(target.id);

      // Handle target shielding
      if (target.isShielding) {
        const shieldDmg = type === 'strong' ? 25 * (1 + chargeRatio) : 12;
        target.shieldHealth -= shieldDmg;

        // Knockback on shield disabled

        events.push({
          type: 'shield_hit',
          targetId: target.id,
          x: target.x,
          y: target.y - target.height / 2
        });

        // Trigger shield break if shield broke
        if (target.shieldHealth <= 0) {
          target.shieldHealth = 0;
          target.isShielding = false;
          target.shieldStun = 180;
          events.push({ type: 'shield_break', id: target.id, x: target.x, y: target.y - target.height / 2 });
        }
      } else {
        // Normal hit connection
        const dmg = type === 'strong' ? (18 + chargeRatio * 12) : 11.0;
        target.damageRate += dmg;

        // Knockback physics formula (calibrated to prevent single-hit KOs at low damage)
        const baseKb = type === 'strong' ? (7.5 + chargeRatio * 4.5) : 4.2;
        const scaleKb = type === 'strong' ? 0.18 : 0.08;
        const kbMagnitude = baseKb + (target.damageRate * scaleKb);

        // Vector direction: angled slightly upwards
        let dirX = Math.sign(target.x - attacker.x) || attacker.facing;
        let dirY = -0.55;

        // Normalize vector
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        dirX /= len;
        dirY /= len;

        // Apply knockback velocities (striker has heavier weight and resists 25% knockback)
        const weightMitigation = target.characterType === 'striker' ? 0.75 : 1.0;
        target.vx = kbMagnitude * dirX * weightMitigation;
        target.vy = kbMagnitude * dirY * weightMitigation;
        target.grounded = false;

        // Hitstun is proportional to knockback
        target.hitStun = Math.round(kbMagnitude * 2.5);

        events.push({
          type: 'hit',
          attackerId: attacker.id,
          targetId: target.id,
          damage: dmg,
          damageRate: target.damageRate,
          knockback: kbMagnitude,
          x: target.x,
          y: target.y - target.height / 2
        });
      }
    }
  }
}

// Resolve collisions with stage platforms
function resolveCollisions(p, inputs) {
  // 1. Solid Main Platform Collision
  const rx1 = STAGE.mainPlatform.x1;
  const rx2 = STAGE.mainPlatform.x2;
  const ry1 = STAGE.mainPlatform.y1;
  const ry2 = STAGE.mainPlatform.y2;

  const px1 = p.x - p.width / 2;
  const px2 = p.x + p.width / 2;
  const py1 = p.y - p.height;
  const py2 = p.y;

  const mainOverlap = px1 < rx2 && px2 > rx1 && py1 < ry2 && py2 > ry1;
  if (mainOverlap) {
    // Check previous positions to determine entry direction
    const prev_px1 = p.prevX - p.width / 2;
    const prev_px2 = p.prevX + p.width / 2;
    const prev_py1 = p.prevY - p.height;
    const prev_py2 = p.prevY;

    if (prev_py2 <= ry1) {
      // Landed on platform top
      p.y = ry1;
      p.vy = 0;
      p.grounded = true;
      p.jumpCount = 0;
    } else if (prev_py1 >= ry2) {
      // Bumped platform bottom
      p.y = ry2 + p.height;
      p.vy = 0;
    } else if (prev_px2 <= rx1) {
      // Collided with left wall
      p.x = rx1 - p.width / 2;
      p.vx = 0;
    } else if (prev_px1 >= rx2) {
      // Collided with right wall
      p.x = rx2 + p.width / 2;
      p.vx = 0;
    }
  }

  // 2. Semi-Solid Platforms Collision (pass-through platforms)
  // Disable dropping down via down key during hitstun or shieldstun
  const canDrop = inputs.down && p.hitStun === 0 && p.shieldStun === 0;
  if (p.vy >= 0 && !canDrop) {
    for (const plat of STAGE.platforms) {
      const px1 = p.x - p.width / 2;
      const px2 = p.x + p.width / 2;
      const py2 = p.y;
      const prev_py2 = p.prevY;

      // Check if crossing from above to below
      if (prev_py2 <= plat.y && py2 >= plat.y) {
        if (px1 < plat.x2 && px2 > plat.x1) {
          p.y = plat.y;
          p.vy = 0;
          p.grounded = true;
          p.jumpCount = 0;
          break; // Stop checking other platforms
        }
      }
    }
  }
}

// Check blast zone boundaries for KOs
function checkKO(p) {
  if (p.isEliminated) return;

  const b = STAGE.blastZones;
  if (p.x < b.left || p.x > b.right || p.y < b.top || p.y > b.bottom) {
    // Player is KO'd!
    p.stocks--;
    p.vx = 0;
    p.vy = 0;

    events.push({
      type: 'ko',
      id: p.id,
      name: p.name,
      color: p.color,
      stocks: p.stocks,
      x: Math.max(Math.min(p.x, STAGE.width), 0),
      y: Math.max(Math.min(p.y, STAGE.height), 0)
    });

    console.log(`${p.name} was KO'd! Remaining stocks: ${p.stocks}`);

    if (p.stocks <= 0) {
      p.stocks = 0;
      p.isEliminated = true;
      p.respawnTimer = 0; // Do not respawn
      events.push({
        type: 'eliminated',
        id: p.id,
        name: p.name,
        color: p.color
      });
      checkMatchEnd();
    } else {
      p.respawnTimer = 90; // Wait 1.5 seconds to respawn
    }
  }
}

// Check if match is finished (only one player remains with stocks > 0)
function checkMatchEnd() {
  if (matchState !== 'playing') return;

  const activePlayers = Object.values(players).filter(p => !p.isEliminated);
  const totalPlayersCount = Object.keys(players).length;

  if (totalPlayersCount === 1) {
    // Single player practice mode - if they die, show Game Over and restart after 3 seconds
    const p = activePlayers[0];
    if (!p) {
      matchState = 'ended';
      matchEndTimer = 180; // 3 seconds
      matchWinner = null;
      events.push({
        type: 'match_end',
        winnerName: '',
        winnerColor: '#ffffff'
      });
    }
  } else if (totalPlayersCount > 1) {
    // Multiplayer mode
    if (activePlayers.length === 1) {
      matchState = 'ended';
      matchEndTimer = 300; // 5 seconds victory screen
      matchWinner = activePlayers[0];
      events.push({
        type: 'match_end',
        winnerId: matchWinner.id,
        winnerName: matchWinner.name,
        winnerColor: matchWinner.color
      });
    } else if (activePlayers.length === 0) {
      matchState = 'ended';
      matchEndTimer = 300; // 5 seconds
      matchWinner = null;
      events.push({
        type: 'match_end',
        winnerName: 'DRAW',
        winnerColor: '#9ca3af'
      });
    }
  }
}

// Restart match state for next round
function restartMatch() {
  matchState = 'playing';
  matchWinner = null;
  projectiles = []; // Clear active projectiles

  for (const id in players) {
    const p = players[id];
    const spawn = getRandomSpawnPoint();
    p.characterType = Math.random() < 0.5 ? 'striker' : 'blaster'; // Re-roll character class
    const isStriker = p.characterType === 'striker';
    p.width = isStriker ? 38 : 30;
    p.height = isStriker ? 69 : 55;
    p.x = spawn.x;
    p.y = spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.damageRate = 0;
    p.stocks = 3;
    p.isEliminated = false;
    p.respawnTimer = 0;
    p.invulnerableTimer = 120;
    p.grounded = false;
    p.jumpCount = 0;
    p.isAttacking = false;
    p.isCharging = false;
    p.chargeTime = 0;
    p.hitStun = 0;
    p.shieldStun = 0;
    p.shieldHealth = 100;
  }

  events.push({ type: 'match_start' });
  console.log('Match restarted.');
}

// Update all active projectiles
function updateProjectiles() {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.life--;

    let destroyed = false;

    // 1. Check out of bounds (blast zones)
    const b = STAGE.blastZones;
    if (proj.x < b.left || proj.x > b.right || proj.y < b.top || proj.y > b.bottom || proj.life <= 0) {
      destroyed = true;
    }

    // 2. Check collision with solid main platform
    if (!destroyed) {
      const rx1 = STAGE.mainPlatform.x1;
      const rx2 = STAGE.mainPlatform.x2;
      const ry1 = STAGE.mainPlatform.y1;
      const ry2 = STAGE.mainPlatform.y2;
      
      const px = proj.x;
      const py = proj.y;
      const r = proj.size / 2;
      
      if (px + r > rx1 && px - r < rx2 && py + r > ry1 && py - r < ry2) {
        destroyed = true;
        events.push({ type: 'proj_explode', x: proj.x, y: proj.y, color: proj.color });
      }
    }

    // 3. Check collision with other players
    if (!destroyed) {
      for (const id in players) {
        if (id === proj.ownerId) continue;
        const target = players[id];

        if (target.respawnTimer > 0 || target.invulnerableTimer > 0 || target.isEliminated) continue;

        const tx1 = target.x - target.width / 2;
        const tx2 = target.x + target.width / 2;
        const ty1 = target.y - target.height;
        const ty2 = target.y;

        const px = proj.x;
        const py = proj.y;
        const r = proj.size / 2;

        const overlap = px + r > tx1 && px - r < tx2 && py + r > ty1 && py - r < ty2;
        if (overlap) {
          destroyed = true;

          if (target.isShielding) {
            const shieldDmg = proj.damage * 1.5;
            target.shieldHealth -= shieldDmg;

            // Knockback on shield disabled

            events.push({
              type: 'shield_hit',
              targetId: target.id,
              x: proj.x,
              y: proj.y
            });

            if (target.shieldHealth <= 0) {
              target.shieldHealth = 0;
              target.isShielding = false;
              target.shieldStun = 180;
              events.push({ type: 'shield_break', id: target.id, x: target.x, y: target.y - target.height / 2 });
            }
          } else {
            target.damageRate += proj.damage;
            
            const kbMagnitude = proj.baseKb + (target.damageRate * proj.scaleKb);
            let dirX = Math.sign(proj.vx) || 1;
            let dirY = -0.4;

            const len = Math.sqrt(dirX * dirX + dirY * dirY);
            dirX /= len;
            dirY /= len;

            // Apply knockback velocities (striker resists 25% knockback due to weight)
            const weightMitigation = target.characterType === 'striker' ? 0.75 : 1.0;
            target.vx = kbMagnitude * dirX * weightMitigation;
            target.vy = kbMagnitude * dirY * weightMitigation;
            target.grounded = false;
            target.hitStun = Math.round(kbMagnitude * 2.5);

            events.push({
              type: 'hit',
              attackerId: proj.ownerId,
              targetId: target.id,
              damage: proj.damage,
              damageRate: target.damageRate,
              knockback: kbMagnitude,
              x: proj.x,
              y: proj.y
            });
          }
          break;
        }
      }
    }

    if (destroyed) {
      projectiles.splice(i, 1);
    }
  }
}

// Core Game Loop
let lastTime = Date.now();
function gameLoop() {
  const now = Date.now();
  const dt = now - lastTime;

  if (dt >= TICK_TIME) {
    // 1. If match is ended, decrement timer
    if (matchState === 'ended') {
      matchEndTimer--;
      if (matchEndTimer <= 0) {
        restartMatch();
      }
    }

    // 2. Update all players
    for (const id in players) {
      updatePlayer(id);
    }

    // Update projectiles physics
    updateProjectiles();

    // 3. Broadcast game state to all players
    const statePacket = {
      type: 'state',
      matchState: matchState,
      matchWinner: matchWinner ? { name: matchWinner.name, color: matchWinner.color } : null,
      players: Object.keys(players).map(id => {
        const p = players[id];
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          characterType: p.characterType,
          x: Math.round(p.x),
          y: Math.round(p.y),
          width: p.width,
          height: p.height,
          vx: Math.round(p.vx * 10) / 10,
          vy: Math.round(p.vy * 10) / 10,
          facing: p.facing,
          damageRate: p.damageRate,
          stocks: p.stocks,
          isEliminated: p.isEliminated,
          isShielding: p.isShielding,
          shieldHealth: Math.round(p.shieldHealth),
          isAttacking: p.isAttacking,
          attackType: p.attackType,
          attackFrame: p.attackFrame,
          isCharging: p.isCharging,
          chargeTime: p.chargeTime,
          hitStun: p.hitStun,
          shieldStun: p.shieldStun,
          invulnerable: p.invulnerableTimer > 0 || p.respawnTimer > 0,
          respawning: p.respawnTimer > 0
        };
      }),
      projectiles: projectiles.map(proj => ({
        id: proj.id,
        x: Math.round(proj.x),
        y: Math.round(proj.y),
        size: proj.size,
        color: proj.color
      })),
      events: [...events]
    };

    // Broadcast statePacket as JSON to everyone
    const jsonStr = JSON.stringify(statePacket);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(jsonStr);
      }
    });

    // Clear accumulated events
    events = [];

    // Account for frame rate lag
    lastTime = now - (dt % TICK_TIME);
  }

  // Queue next update tick
  setTimeout(gameLoop, 1);
}

// Start game loop
gameLoop();

// Start serving on Port 25564
const PORT = process.env.PORT || 25564;
server.listen(PORT, () => {
  console.log(`Pict-Fight Server running on port ${PORT}`);
});
