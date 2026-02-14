(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');

  const W = canvas.width, H = canvas.height;
  const lanesY = [H*0.28, H*0.72];

  let state = {};

  function reset() {
    state = {
      running: false,
      playerLane: 1,
      player: {x: 120, w: 48, h: 68},
      obstacles: [],
      spawnTimer: 0,
      spawnInterval: 1200,
      baseSpeed: 300,
      maxSpeed: 1200,
      speed: 300,
      lastObstacleLane: null,
      lastObstacleRepeatCount: 0,
      // power-up timers (ms)
      powerups: { slowTimer: 0, shieldTimer: 0, scoreTimer: 0, slowFactor: 0.55 },
      lastPowerupKinds: [], // track last 2 power-up kinds to prevent repeats
      score: 0,
      popup: { text: '', timer: 0 },
      lastTs: performance.now(),
      gameOver: false
    };
    
  }

  function start() {
    reset();
    state.running = true;
    state.lastTs = performance.now();
    loop(state.lastTs);
  }

  function toggleLane(to) {
    if (state.gameOver) return;
    if (to === undefined) state.playerLane = 1 - state.playerLane;
    else state.playerLane = to;
  }

  function spawnObstacle() {
    // choose lane with bias to avoid long same-lane runs
    let lane;
    if (state.lastObstacleLane === null) {
      lane = Math.random() < 0.5 ? 0 : 1;
    } else {
      const baseRepeatChance = 0.35; // chance to repeat same lane
      const penalty = Math.min(0.25, 0.08 * state.lastObstacleRepeatCount);
      const repeatChance = Math.max(0.05, baseRepeatChance - penalty);
      lane = (Math.random() < repeatChance) ? state.lastObstacleLane : 1 - state.lastObstacleLane;
    }

    const h = 46 + Math.random()*40;
    const w = 28 + Math.random()*36;

    // small chance to spawn a power-up instead of an obstacle
    const r = Math.random();
    if (r < 0.12) {
      // power-up kinds: slow (only after score 30), shield, score
      let kinds = ['shield','score'];
      if (state.score >= 30) kinds.push('slow');
      // avoid same power-up appearing more than twice in a row
      if (state.lastPowerupKinds.length >= 2 && state.lastPowerupKinds[0] === state.lastPowerupKinds[1]) {
        const repeated = state.lastPowerupKinds[0];
        kinds = kinds.filter(k => k !== repeated);
        if (kinds.length === 0) kinds = ['shield','score'];
      }
      const kind = kinds[Math.floor(Math.random()*kinds.length)];
      state.obstacles.push({x: W + 40, lane, w: 32, h: 32, passed:false, powerup: true, kind, collected:false});
      // track for repeat prevention
      state.lastPowerupKinds.unshift(kind);
      if (state.lastPowerupKinds.length > 2) state.lastPowerupKinds.pop();
    } else {
      state.obstacles.push({x: W + 40, lane, w, h, passed:false, powerup:false});
    }
    // gradually increase difficulty by tightening spawn interval
    state.spawnInterval = Math.max(520, state.spawnInterval * 0.995);
    // update last-lane tracking
    if (state.lastObstacleLane === lane) state.lastObstacleRepeatCount++;
    else { state.lastObstacleLane = lane; state.lastObstacleRepeatCount = 1 }
  }

  function update(dt) {
    if (!state.running) return;
    state.spawnTimer += dt;
    if (state.spawnTimer > state.spawnInterval) {
      spawnObstacle();
      state.spawnTimer = 0;
    }

    // smaller discrete speed increase per 10 score: score 10 -> x1.3, score 20 -> x1.3^2, etc.
    const tens = Math.floor(state.score / 10);
    const perTenMultiplier = 1.3;
    const multiplier = Math.pow(perTenMultiplier, Math.max(0, tens));
    state.speed = Math.min(state.maxSpeed, state.baseSpeed * multiplier);
    // power-up timers update
    const pu = state.powerups;
    if (pu.slowTimer > 0) pu.slowTimer = Math.max(0, pu.slowTimer - dt);
    if (pu.shieldTimer > 0) pu.shieldTimer = Math.max(0, pu.shieldTimer - dt);
    if (pu.scoreTimer > 0) pu.scoreTimer = Math.max(0, pu.scoreTimer - dt);

    // compute effective speed (slowed when powerup active)
    const effectiveSpeed = state.speed * (pu.slowTimer > 0 ? pu.slowFactor : 1);

    // move obstacles and power-ups
    for (const o of state.obstacles) {
      o.x -= effectiveSpeed * dt/1000;
      // scoring (power-ups aren't scored when passed)
      if (!o.passed && !o.powerup && o.x + o.w < state.player.x) { o.passed = true; state.score += (pu.scoreTimer>0?2:1) }
    }
    // remove offscreen non-powerups and collected powerups
    state.obstacles = state.obstacles.filter(o => (o.x + o.w > -40) && !(o.powerup && o.collected));

    // collision
    // tighten player's collision box a bit for fairness
    const inset = 8;
    const p = {x: state.player.x + inset, y: lanesY[state.playerLane] - state.player.h/2 + inset, w: state.player.w - inset*2, h: state.player.h - inset*2};
    for (const o of state.obstacles) {
      if (o.lane !== state.playerLane) continue;
      const ox = o.x, oy = lanesY[o.lane] - o.h/2;
      if (o.powerup) {
        // collision with power-up
        if (rectsIntersect(p.x,p.y,p.w,p.h, ox,oy,o.w,o.h) && !o.collected) {
          o.collected = true;
          // apply effect (durations in ms)
          if (o.kind === 'slow') { state.powerups.slowTimer = 3500; state.popup = {text: 'Slowed!', timer: 1400} }
          if (o.kind === 'shield') { state.powerups.shieldTimer = 3500; state.popup = {text: 'Invincible!', timer: 1400} }
          if (o.kind === 'score') { state.powerups.scoreTimer = 3500; state.popup = {text: 'Score x2!', timer: 1400} }
        }
      } else {
        if (rectsIntersect(p.x,p.y,p.w,p.h, ox,oy,o.w,o.h)) {
          // if shield active, ignore collision
          if (state.powerups.shieldTimer > 0) { /* ignore collision */ }
          else { state.gameOver = true; state.running = false }
        }
      }
    }

    // popup timer
    if (state.popup && state.popup.timer > 0) state.popup.timer = Math.max(0, state.popup.timer - dt);

    // increase score over time
    state.score += dt/1000 * 0.2;
  }

  function rectsIntersect(x1,y1,w1,h1,x2,y2,w2,h2){
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  function draw() {
    // clear
    ctx.clearRect(0,0,W,H);
    // background lanes
    ctx.fillStyle = '#071526';
    ctx.fillRect(0,0,W,H);
    // lane stripes
    ctx.fillStyle = '#0d2a45';
    ctx.fillRect(0, lanesY[0]-6, W, 12);
    ctx.fillRect(0, lanesY[1]-6, W, 12);

    // ground subtle
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (let i=0;i<40;i++){ ctx.fillRect((i*90 + (Date.now()/10)%90)-90, lanesY[1]+36, 60, 3) }

    // player (square) with power-up color effects
    const py = lanesY[state.playerLane] - state.player.h/2;
    let playerColor = '#4CAF50';
    if (state.powerups.shieldTimer > 0) playerColor = '#4ee6a0';
    else if (state.powerups.scoreTimer > 0) playerColor = '#ffd166';
    else if (state.powerups.slowTimer > 0) playerColor = '#39a9ff';
    if (state.powerups.shieldTimer > 0) {
      ctx.save(); ctx.shadowColor = 'rgba(78,230,160,0.9)'; ctx.shadowBlur = 18; ctx.fillStyle = playerColor;
      ctx.fillRect(state.player.x, py, state.player.w, state.player.h); ctx.restore();
    } else if (state.powerups.scoreTimer > 0) {
      ctx.save(); ctx.globalAlpha = 0.95; ctx.fillStyle = playerColor; ctx.fillRect(state.player.x, py, state.player.w, state.player.h); ctx.restore();
    } else if (state.powerups.slowTimer > 0) {
      ctx.save(); ctx.fillStyle = playerColor; ctx.fillRect(state.player.x, py, state.player.w, state.player.h);
      // subtle outline
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2; ctx.strokeRect(state.player.x+1, py+1, state.player.w-2, state.player.h-2);
      ctx.restore();
    } else {
      ctx.fillStyle = playerColor; ctx.fillRect(state.player.x, py, state.player.w, state.player.h);
    }

    // obstacles (spikes) and power-ups
    for (const o of state.obstacles){
      const ox = o.x;
      const oy = lanesY[o.lane] - o.h/2;
      const invert = o.lane === 0; // top-lane spikes hang downwards
      if (o.powerup) drawPowerUp(ox, oy, o.w, o.h, o.kind);
      else drawSpikes(ox, oy, o.w, o.h, '#ef476f', invert);
    }

    // HUD
    scoreEl.textContent = 'Score: ' + Math.floor(state.score);

    // draw popup text when present (large and centered)
    if (state.popup && state.popup.timer > 0) {
      const alpha = Math.max(0, Math.min(1, state.popup.timer / 1400));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(W/2-200, H/2-60, 400, 120);
      ctx.fillStyle = '#e6eef8'; ctx.font = 'bold 56px system-ui,Segoe UI,Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(state.popup.text, W/2, H/2);
      ctx.restore();
    }

    if (!state.running && !state.gameOver) {
      drawOverlay('Tap or press Space to start', 'Ready?');
    }
    if (state.gameOver) {
      drawOverlay('Game Over', 'Press Space or Tap to retry');
    }
  }

  function drawOverlay(sub, title){
    ctx.fillStyle = 'rgba(3,8,14,0.65)';
    ctx.fillRect(W/2-220, H/2-64, 440, 128);
    ctx.fillStyle = '#e6eef8';
    ctx.font = '28px system-ui,Segoe UI,Arial'; ctx.textAlign='center';
    ctx.fillText(sub, W/2, H/2-6);
    ctx.font = '16px system-ui,Segoe UI,Arial'; ctx.fillText(title, W/2, H/2+28);
  }

  function roundRect(ctx,x,y,w,h,r,fill,stroke){
    if (typeof r === 'undefined') r=5;
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
    if(fill) ctx.fill();
    if(stroke) ctx.stroke();
  }

  

  function drawSpikes(x, y, w, h, color, invert=false){
    // draw a row of triangular spikes across the rect area
    // invert=true draws spikes pointing downwards (for top lane)
    const spikeCount = Math.max(2, Math.round(w / 18));
    const spikeW = w / spikeCount;
    ctx.fillStyle = color;
    for (let i=0;i<spikeCount;i++){
      const sx = x + i*spikeW;
      ctx.beginPath();
      if (!invert) {
        ctx.moveTo(sx, y + h);
        ctx.lineTo(sx + spikeW*0.5, y);
        ctx.lineTo(sx + spikeW, y + h);
      } else {
        ctx.moveTo(sx, y);
        ctx.lineTo(sx + spikeW*0.5, y + h);
        ctx.lineTo(sx + spikeW, y);
      }
      ctx.closePath();
      ctx.fill();
      // dark base
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      if (!invert) ctx.fillRect(sx, y + h - 6, spikeW, 6);
      else ctx.fillRect(sx, y, spikeW, 6);
      ctx.fillStyle = color;
    }
  }

  function drawPowerUp(x,y,w,h,kind){
    // simple circular power-up with color per kind and letter
    const cx = x + w/2, cy = y + h/2;
    let color = '#39a9ff', label = 'S';
    if (kind === 'slow') { color = '#39a9ff'; label = 'S' }
    if (kind === 'shield') { color = '#4ee6a0'; label = 'O' }
    if (kind === 'score') { color = '#ffd166'; label = '★' }
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, Math.min(w,h)/2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(cx - w/2, cy + h/2 - 6, w, 6);
    ctx.fillStyle = '#072017'; ctx.font = '18px system-ui,Segoe UI,Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  function loop(ts) {
    const dt = ts - state.lastTs; state.lastTs = ts;
    update(dt); draw();
    requestAnimationFrame(loop);
  }

  // Input
  window.addEventListener('keydown', e => {
    if (e.code === 'ArrowUp') toggleLane(0);
    if (e.code === 'ArrowDown') toggleLane(1);
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.running) toggleLane();
      else start();
    }
  });

  // mouse / touch: tap top half -> top lane, bottom half -> bottom lane
  canvas.addEventListener('pointerdown', e => {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const half = canvas.height/2;
    if (!state.running) { if (state.gameOver) start(); else start(); return }
    toggleLane(y < half ? 0 : 1);
  });

  // initial
  reset();
  // start paused; game starts on first tap/space
  draw();

  // expose for debugging
  window.runner = {start, reset, state};
})();
