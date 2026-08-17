(function () {
  "use strict";

  var canvas = document.getElementById("gameCanvas");
  var ctx = canvas.getContext("2d");

  var pageDescription = document.getElementById("pageDescription");
  var gameTitleElement = document.getElementById("gameTitle");
  var scoreElement = document.getElementById("score");
  var bestScoreElement = document.getElementById("bestScore");
  var gameOverOverlay = document.getElementById("gameOverOverlay");
  var gameOverMessage = document.getElementById("gameOverMessage");
  var finalScoreElement = document.getElementById("finalScore");
  var highestItemImage = document.getElementById("highestItemImage");
  var newRecordElement = document.getElementById("newRecord");
  var againButton = document.getElementById("againButton");
  var soundButton = document.getElementById("soundButton");
  var soundIcon = document.getElementById("soundIcon");
  var restartButton = document.getElementById("restartButton");
  var restartConfirmOverlay = document.getElementById("restartConfirmOverlay");
  var restartCancelButton = document.getElementById("restartCancelButton");
  var restartConfirmButton = document.getElementById("restartConfirmButton");

  var WORLD_WIDTH = 400;
  var WORLD_HEIGHT = 620;
  var MIN_CANVAS_WIDTH = 1024;
  var LEFT_WALL = 0;
  var RIGHT_WALL = WORLD_WIDTH;
  var FLOOR = WORLD_HEIGHT;
  var DANGER_LINE = 90;
  var DANGER_PROXIMITY = 80;
  var SPAWN_Y = DANGER_LINE / 2;
  var MAX_ITEM_RADIUS = (RIGHT_WALL - LEFT_WALL) / 2 - 1;
  var MAX_SCORE = Number.MAX_SAFE_INTEGER;

  var FIXED_STEP = 1 / 120;
  var MAX_STEPS = 8;
  var GRAVITY = 1480;
  var SOLVER_ITERATIONS = 7;
  var AIR_DAMPING = 0.998;
  var GROUND_DRAG = 4.4;
  var CIRCLE_RESTITUTION = 0.06;
  var WALL_RESTITUTION = 0.035;
  var FRICTION = 0.13;
  var MAX_SPEED = 1700;
  var DANGER_DELAY = 1.35;
  var HIGHEST_CELEBRATION_DURATION = 3.2;
  var FAILURE_SWEEP_DURATION = 1.25;
  var FAILURE_SETTLE_DURATION = 0.76;

  var DEFAULT_RADII = [13, 17, 22, 28, 35, 43, 51, 60, 70, 80, 91];
  var DEFAULT_COLORS = ["#e84d5b", "#f26b73", "#8f6ccf", "#ff9f43", "#f3cc30", "#79b94f", "#df4b3f", "#f38ba7", "#e5ab33", "#a77757", "#39ad65"];
  var CELEBRATION_COLORS = ["#fff27a", "#ff9eb5", "#8ce7ff", "#c5a3ff", "#ffffff", "#ffbd57"];
  var CELEBRATION_BURST_TIMES = [0.5, 0.94, 1.4, 1.9];
  var DEFAULT_SPAWN_LEVEL_COUNT = 5;
  var CONFIG = normalizeConfig(window.MERGE_GAME_CONFIG);
  var LEVELS = CONFIG.levels;
  var LEVEL_ASSETS = preloadLevelAssets();

  var items = [];
  var particles = [];
  var celebrationParticles = [];
  var failureBlasts = [];
  var floaters = [];
  var highestCelebration = null;
  var failureSequence = null;
  var mode = "loading";
  var score = 0;
  var bestScore = loadBestScore();
  var bestBeforeGame;
  var maxLevelReached = 0;
  var hasMergedHighestLevel = false;
  var currentLevel = 0;
  var aimX = WORLD_WIDTH / 2;
  var readyToDrop = false;
  var dropCooldown = 0;
  var activePointer = null;
  var nextItemId = 1;
  var dangerTimer = 0;
  var dangerIsNear = false;
  var dangerIsCrossed = false;
  var shake = 0;
  var accumulator = 0;
  var lastFrameTime = performance.now();
  var dpr = 1;
  var canvasScaleX = 1;
  var canvasScaleY = 1;
  var soundEnabled = true;
  var audioContext = null;
  var reducedMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function prefersReducedMotion() {
    return Boolean(reducedMotionQuery && reducedMotionQuery.matches);
  }

  function textOr(value, fallback) {
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  function defaultLevels() {
    return DEFAULT_RADII.map(function (radius, index) {
      return {
        radius: radius,
        score: index === 0 ? 0 : Math.pow(2, index),
        color: DEFAULT_COLORS[index],
        image: ""
      };
    });
  }

  function normalizeImage(rawImage) {
    return typeof rawImage === "string" ? rawImage.trim() : "";
  }

  function normalizeConfig(input) {
    var source = input && typeof input === "object" ? input : {};
    var hasCustomLevels = Array.isArray(source.levels) && source.levels.length >= 2;
    var rawLevels = (hasCustomLevels ? source.levels : defaultLevels()).slice();
    var previousConfiguredRadius = 0;
    var validRadii = rawLevels.length <= 32 && rawLevels.every(function (rawLevel) {
      var radius = rawLevel && rawLevel.radius;
      var valid = Number.isFinite(radius) && radius >= 6 && radius > previousConfiguredRadius && radius <= MAX_ITEM_RADIUS;
      previousConfiguredRadius = radius;
      return valid;
    });
    if (!validRadii) {
      if (hasCustomLevels && window.console && console.warn) {
        console.warn("等级半径配置无效，已回退到默认圆形主题。半径须严格递增且不能超过画板宽度。");
      }
      rawLevels = defaultLevels();
    }
    var levels = rawLevels.map(function (rawLevel, index) {
      return {
        radius: rawLevel.radius,
        score: Number.isFinite(rawLevel.score) && rawLevel.score >= 0 ? Math.min(MAX_SCORE, Math.round(rawLevel.score)) : (index === 0 ? 0 : Math.min(MAX_SCORE, Math.pow(2, index))),
        color: textOr(rawLevel.color, DEFAULT_COLORS[index % DEFAULT_COLORS.length]),
        image: normalizeImage(rawLevel.image)
      };
    });

    var rawUi = source.ui && typeof source.ui === "object" ? source.ui : {};
    var assetBase = textOr(source.assetBase, "");
    if (assetBase && !/[\\/]$/.test(assetBase)) {
      assetBase += "/";
    }
    var configId = textOr(source.id, "default");
    var requestedSpawnLevelCount = Number.isFinite(source.spawnLevelCount)
      ? Math.floor(source.spawnLevelCount)
      : DEFAULT_SPAWN_LEVEL_COUNT;

    return {
      storageKey: textOr(source.storageKey, "merge-game:" + configId + ":best:v1"),
      assetBase: assetBase,
      levels: levels,
      spawnLevelCount: clamp(requestedSpawnLevelCount, 1, levels.length),
      ui: {
        title: textOr(rawUi.title, "合成游戏"),
        description: textOr(rawUi.description, "无需安装，打开即玩的纯 JavaScript 合成小游戏。")
      }
    };
  }

  function resolveAssetUrl(source) {
    if (!source) {
      return "";
    }
    try {
      if (/^(?:data:|blob:|https?:|\/)/i.test(source)) {
        return new URL(source, document.baseURI).href;
      }
      return new URL(CONFIG.assetBase + source, document.baseURI).href;
    } catch (error) {
      return "";
    }
  }

  function preloadLevelAssets() {
    return LEVELS.map(function (level) {
      var image = new Image();
      if ("decoding" in image) {
        image.decoding = "async";
      }
      var source = resolveAssetUrl(level.image);
      if (source) {
        image.src = source;
      }
      return image;
    });
  }

  function applyUiConfig() {
    document.title = CONFIG.ui.title;
    pageDescription.setAttribute("content", CONFIG.ui.description);
    gameTitleElement.textContent = CONFIG.ui.title;
  }

  function loadBestScore() {
    try {
      var value = Number.parseInt(window.localStorage.getItem(CONFIG.storageKey), 10);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function saveBestScore() {
    try {
      window.localStorage.setItem(CONFIG.storageKey, String(bestScore));
    } catch (error) {
      // Storage can be unavailable in private browsing. The game still works.
    }
  }

  function takeRandomLevel() {
    return Math.floor(Math.random() * CONFIG.spawnLevelCount);
  }

  function makeItem(level, x, y, vx, vy, source) {
    var radius = LEVELS[level].radius;
    var mass = radius * radius;
    return {
      id: nextItemId++,
      level: level,
      radius: radius,
      mass: mass,
      invMass: 1 / mass,
      x: x,
      y: y,
      vx: vx || 0,
      vy: vy || 0,
      age: 0,
      dangerGrace: source === "drop" ? 0.72 : 0.16,
      popTime: source === "merge" ? 0.18 : 0
    };
  }

  function syncCanvasResolution() {
    dpr = clamp(window.devicePixelRatio || 1, 1, 4);
    var rectangle = canvas.getBoundingClientRect();
    var cssWidth = rectangle.width || WORLD_WIDTH;
    var cssHeight = rectangle.height || WORLD_HEIGHT;
    var renderScale = Math.max(
      MIN_CANVAS_WIDTH / WORLD_WIDTH,
      cssWidth * dpr / WORLD_WIDTH,
      cssHeight * dpr / WORLD_HEIGHT
    );
    var nextWidth = Math.round(WORLD_WIDTH * renderScale);
    var nextHeight = Math.round(WORLD_HEIGHT * renderScale);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    canvasScaleX = canvas.width / WORLD_WIDTH;
    canvasScaleY = canvas.height / WORLD_HEIGHT;
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) {
      ctx.imageSmoothingQuality = "high";
    }
  }

  function updateControls() {
    restartButton.disabled = mode !== "playing";
  }

  function updateSoundControl() {
    soundIcon.classList.toggle("is-muted", !soundEnabled);
    soundButton.setAttribute("aria-label", soundEnabled ? "关闭声音" : "开启声音");
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
  }

  function updateScoreDisplay(animate) {
    scoreElement.textContent = String(score);
    bestScoreElement.textContent = String(bestScore);
    if (animate && !prefersReducedMotion() && typeof scoreElement.animate === "function") {
      scoreElement.animate(
        [
          { transform: "scale(1)", color: "#6650b7" },
          { transform: "scale(1.22)", color: "#df4d5d" },
          { transform: "scale(1)", color: "#6650b7" }
        ],
        { duration: 220, easing: "ease-out" }
      );
    }
  }

  function showHighestItem(levelIndex) {
    highestItemImage.src = LEVEL_ASSETS[levelIndex].src;
  }

  function focusCanvas() {
    try {
      canvas.focus({ preventScroll: true });
    } catch (error) {
      canvas.focus();
    }
  }

  function startGame(shouldFocusCanvas) {
    items = [];
    particles = [];
    celebrationParticles = [];
    failureBlasts = [];
    floaters = [];
    highestCelebration = null;
    failureSequence = null;
    score = 0;
    bestBeforeGame = bestScore;
    maxLevelReached = 0;
    hasMergedHighestLevel = false;
    nextItemId = 1;
    dangerTimer = 0;
    dangerIsNear = false;
    dangerIsCrossed = false;
    shake = 0;
    resetFrameClock();
    currentLevel = takeRandomLevel();
    aimX = WORLD_WIDTH / 2;
    readyToDrop = true;
    dropCooldown = 0;
    mode = "playing";

    gameOverOverlay.hidden = true;
    restartConfirmOverlay.hidden = true;
    canvas.tabIndex = 0;
    newRecordElement.hidden = true;
    updateScoreDisplay(false);
    updateControls();
    if (shouldFocusCanvas) {
      focusCanvas();
    }
  }

  function startFailureExplosion() {
    if (mode !== "playing") {
      return;
    }

    var queue = items.slice().sort(function (a, b) {
      return (a.y - a.radius) - (b.y - b.radius) || a.x - b.x || a.id - b.id;
    });
    var firstTop = queue.length > 0 ? queue[0].y - queue[0].radius : 0;
    var lastTop = queue.length > 0 ? queue[queue.length - 1].y - queue[queue.length - 1].radius : firstTop;
    var verticalSpan = Math.max(1, lastTop - firstTop);

    queue = queue.map(function (body, index) {
      var verticalProgress = (body.y - body.radius - firstTop) / verticalSpan;
      return {
        body: body,
        explodeAt: 0.06 + verticalProgress * FAILURE_SWEEP_DURATION + index * 0.008
      };
    });

    mode = "ending";
    readyToDrop = false;
    activePointer = null;
    highestCelebration = null;
    celebrationParticles = [];
    failureBlasts = [];
    failureSequence = {
      age: 0,
      nextIndex: 0,
      queue: queue,
      firstTop: firstTop,
      lastTop: lastTop,
      finishAt: (queue.length > 0 ? queue[queue.length - 1].explodeAt : 0) + FAILURE_SETTLE_DURATION
    };
    canvas.tabIndex = -1;
    updateControls();
  }

  function finishGame() {
    if (mode !== "ending") {
      return;
    }

    mode = "gameover";
    failureSequence = null;
    var madeRecord = score > bestBeforeGame && score > 0;

    finalScoreElement.textContent = String(score);
    showHighestItem(maxLevelReached);
    gameOverMessage.textContent = hasMergedHighestLevel ? "已合成最高等级！" : "差一点就更大了";
    newRecordElement.hidden = !madeRecord;
    gameOverOverlay.hidden = false;
    playGameOverSound();
    window.setTimeout(function () {
      againButton.focus();
    }, 0);
  }

  function limitAimX(value) {
    var radius = LEVELS[currentLevel].radius;
    return clamp(value, LEFT_WALL + radius, RIGHT_WALL - radius);
  }

  function eventToWorldX(event) {
    var rectangle = canvas.getBoundingClientRect();
    if (rectangle.width <= 0) {
      return WORLD_WIDTH / 2;
    }
    return (event.clientX - rectangle.left) * WORLD_WIDTH / rectangle.width;
  }

  function moveAimFromEvent(event) {
    if (mode !== "playing" || !readyToDrop) {
      return;
    }
    aimX = limitAimX(eventToWorldX(event));
  }

  function dropCurrentItem() {
    if (mode !== "playing" || !readyToDrop) {
      return;
    }

    aimX = limitAimX(aimX);
    items.push(makeItem(currentLevel, aimX, SPAWN_Y, 0, 20, "drop"));
    maxLevelReached = Math.max(maxLevelReached, currentLevel);
    readyToDrop = false;
    dropCooldown = 0.42;
    playDropSound(currentLevel);
  }

  function prepareNextItem() {
    currentLevel = takeRandomLevel();
    aimX = limitAimX(aimX);
    readyToDrop = true;
  }

  function getContact(a, b, extra) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var limit = a.radius + b.radius + (extra || 0);
    var distanceSquared = dx * dx + dy * dy;

    if (distanceSquared > limit * limit) {
      return null;
    }

    var distance;
    var nx;
    var ny;
    if (distanceSquared < 0.000001) {
      nx = a.id < b.id ? 1 : -1;
      ny = 0;
      distance = 0.001;
    } else {
      distance = Math.sqrt(distanceSquared);
      nx = dx / distance;
      ny = dy / distance;
    }

    return {
      nx: nx,
      ny: ny,
      penetration: a.radius + b.radius - distance
    };
  }

  function projectBoundary(body, nx, ny, penetration, grounded) {
    body.x += nx * penetration;
    body.y += ny * penetration;

    var normalVelocity = body.vx * nx + body.vy * ny;
    if (normalVelocity < 0) {
      var restitution = -normalVelocity < 70 ? 0 : WALL_RESTITUTION;
      body.vx -= (1 + restitution) * normalVelocity * nx;
      body.vy -= (1 + restitution) * normalVelocity * ny;
    }

    if (ny < 0) {
      grounded.add(body.id);
    }
  }

  function solveBounds(body, grounded) {
    var penetration;

    if (body.x - body.radius < LEFT_WALL) {
      penetration = LEFT_WALL - (body.x - body.radius);
      projectBoundary(body, 1, 0, penetration, grounded);
    }
    if (body.x + body.radius > RIGHT_WALL) {
      penetration = body.x + body.radius - RIGHT_WALL;
      projectBoundary(body, -1, 0, penetration, grounded);
    }
    if (body.y + body.radius > FLOOR) {
      penetration = body.y + body.radius - FLOOR;
      projectBoundary(body, 0, -1, penetration, grounded);
    }
  }

  function solveCircleCollision(a, b, contact) {
    if (!contact || contact.penetration <= 0) {
      return;
    }

    var inverseMassSum = a.invMass + b.invMass;
    var correctionDepth = Math.max(contact.penetration - 0.12, 0);
    var correction = correctionDepth * 0.72 / inverseMassSum;

    a.x -= contact.nx * correction * a.invMass;
    a.y -= contact.ny * correction * a.invMass;
    b.x += contact.nx * correction * b.invMass;
    b.y += contact.ny * correction * b.invMass;

    var relativeX = b.vx - a.vx;
    var relativeY = b.vy - a.vy;
    var normalSpeed = relativeX * contact.nx + relativeY * contact.ny;
    if (normalSpeed >= 0) {
      return;
    }

    var restitution = -normalSpeed < 70 ? 0 : CIRCLE_RESTITUTION;
    var impulse = -(1 + restitution) * normalSpeed / inverseMassSum;
    var impulseX = contact.nx * impulse;
    var impulseY = contact.ny * impulse;

    a.vx -= impulseX * a.invMass;
    a.vy -= impulseY * a.invMass;
    b.vx += impulseX * b.invMass;
    b.vy += impulseY * b.invMass;

    relativeX = b.vx - a.vx;
    relativeY = b.vy - a.vy;
    var tangentX = relativeX - (relativeX * contact.nx + relativeY * contact.ny) * contact.nx;
    var tangentY = relativeY - (relativeX * contact.nx + relativeY * contact.ny) * contact.ny;
    var tangentLength = Math.hypot(tangentX, tangentY);

    if (tangentLength > 0.000001) {
      tangentX /= tangentLength;
      tangentY /= tangentLength;
      var frictionImpulse = -(relativeX * tangentX + relativeY * tangentY) / inverseMassSum;
      var frictionLimit = FRICTION * Math.abs(impulse);
      frictionImpulse = clamp(frictionImpulse, -frictionLimit, frictionLimit);

      a.vx -= tangentX * frictionImpulse * a.invMass;
      a.vy -= tangentY * frictionImpulse * a.invMass;
      b.vx += tangentX * frictionImpulse * b.invMass;
      b.vy += tangentY * frictionImpulse * b.invMass;
    }
  }

  function collectMergeCandidate(a, b, candidates, contact) {
    if (a.level !== b.level) {
      return;
    }
    if (a.level === LEVELS.length - 1) {
      return;
    }

    contact = contact || getContact(a, b, 0.12);
    if (!contact) {
      return;
    }

    var firstId = Math.min(a.id, b.id);
    var secondId = Math.max(a.id, b.id);
    var key = firstId + ":" + secondId;
    var depth = contact.penetration;
    var existing = candidates.get(key);

    if (!existing || depth > existing.depth) {
      candidates.set(key, {
        firstId: firstId,
        secondId: secondId,
        depth: depth
      });
    }
  }

  function addMergeScore(level, x, y) {
    var points = LEVELS[level].score;
    var previousScore = score;
    score = Math.min(MAX_SCORE, score + points);
    var awardedPoints = score - previousScore;

    if (score > bestScore) {
      bestScore = score;
      saveBestScore();
    }

    floaters.push({
      x: x,
      y: y,
      text: "+" + awardedPoints,
      life: 0.72,
      maxLife: 0.72
    });
    updateScoreDisplay(true);
  }

  function addBurst(x, y, color, level) {
    if (prefersReducedMotion()) {
      return;
    }
    var count = Math.min(7 + level, 15);
    for (var i = 0; i < count; i += 1) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 45 + Math.random() * (75 + level * 7);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 28,
        radius: 2 + Math.random() * 3.5,
        color: color,
        life: 0.42 + Math.random() * 0.25,
        maxLife: 0.67
      });
    }

    if (particles.length > 180) {
      particles.splice(0, particles.length - 180);
    }
  }

  function addCelebrationBurst(x, y, count, minimumSpeed, speedRange) {
    for (var i = 0; i < count; i += 1) {
      var angle = Math.PI * 2 * i / count + (Math.random() - 0.5) * 0.16;
      var speed = minimumSpeed + Math.random() * speedRange;
      var life = 1.35 + Math.random() * 0.95;
      celebrationParticles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 90,
        gravity: 220 + Math.random() * 150,
        width: 4 + Math.random() * 6,
        height: 8 + Math.random() * 13,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 12,
        shape: i % 3,
        color: CELEBRATION_COLORS[i % CELEBRATION_COLORS.length],
        life: life,
        maxLife: life
      });
    }
  }

  function startHighestCelebration(body) {
    var reduced = prefersReducedMotion();
    highestCelebration = {
      bodyId: body.id,
      x: body.x,
      y: body.y,
      age: 0,
      duration: reduced ? 0.7 : HIGHEST_CELEBRATION_DURATION,
      burstIndex: 0,
      reduced: reduced
    };
    celebrationParticles = [];
    playHighestCelebrationSound();

    if (reduced) {
      return;
    }

    shake = Math.max(shake, 16);
    addCelebrationBurst(body.x, body.y, 108, 180, 330);
  }

  function applyMerges(candidates) {
    if (candidates.size === 0) {
      return;
    }

    var orderedCandidates = Array.from(candidates.values());
    orderedCandidates.sort(function (a, b) {
      return b.depth - a.depth || a.firstId - b.firstId || a.secondId - b.secondId;
    });

    var byId = new Map();
    var consumed = new Set();
    var created = [];

    items.forEach(function (body) {
      byId.set(body.id, body);
    });

    orderedCandidates.forEach(function (candidate) {
      var a = byId.get(candidate.firstId);
      var b = byId.get(candidate.secondId);
      if (!a || !b || consumed.has(a.id) || consumed.has(b.id) || a.level !== b.level) {
        return;
      }

      consumed.add(a.id);
      consumed.add(b.id);

      var totalMass = a.mass + b.mass;
      var x = (a.x * a.mass + b.x * b.mass) / totalMass;
      var y = (a.y * a.mass + b.y * b.mass) / totalMass;
      var vx = (a.vx * a.mass + b.vx * b.mass) / totalMass;
      var vy = (a.vy * a.mass + b.vy * b.mass) / totalMass;
      var newLevel = a.level + 1;

      addMergeScore(newLevel, x, y);
      addBurst(x, y, LEVELS[a.level].color, a.level);
      playMergeSound(newLevel);
      if (!prefersReducedMotion()) {
        shake = Math.max(shake, Math.min(1.5 + newLevel * 0.42, 5.5));
      }

      var radius = LEVELS[newLevel].radius;
      x = clamp(x, LEFT_WALL + radius, RIGHT_WALL - radius);
      y = Math.min(y, FLOOR - radius);
      var mergedBody = makeItem(newLevel, x, y, vx, vy, "merge");
      created.push(mergedBody);
      if (newLevel === LEVELS.length - 1) {
        if (!hasMergedHighestLevel) {
          startHighestCelebration(mergedBody);
        }
        hasMergedHighestLevel = true;
      }
      maxLevelReached = Math.max(maxLevelReached, newLevel);
    });

    if (consumed.size > 0) {
      items = items.filter(function (body) {
        return !consumed.has(body.id);
      });
      Array.prototype.push.apply(items, created);
    }
  }

  function triggerFailureBlast(body) {
    var color = LEVELS[body.level].color;
    failureBlasts.push({
      x: body.x,
      y: body.y,
      radius: body.radius,
      level: body.level,
      color: color,
      age: 0,
      duration: 0.4 + Math.min(body.radius / 800, 0.12)
    });
    if (failureBlasts.length > 12) {
      failureBlasts.splice(0, failureBlasts.length - 12);
    }

    if (!prefersReducedMotion()) {
      var sparkCount = Math.min(10 + body.level, 20);
      for (var i = 0; i < sparkCount; i += 1) {
        var angle = Math.PI * 2 * i / sparkCount + Math.random() * 0.18;
        var speed = 105 + Math.random() * (135 + body.radius * 1.2);
        var life = 0.42 + Math.random() * 0.38;
        particles.push({
          x: body.x,
          y: body.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 35,
          radius: 2 + Math.random() * 2.7,
          color: i % 4 === 0 ? "#ffffff" : color,
          life: life,
          maxLife: life
        });
      }
      if (particles.length > 150) {
        particles.splice(0, particles.length - 150);
      }
    }

    shake = Math.max(shake, Math.min(3.5 + body.radius * 0.038, 7));
  }

  function updateFailureExplosion(dt) {
    if (!failureSequence) {
      return;
    }

    failureSequence.age += dt;
    var explodedIds = new Set();
    var soundLevel = -1;

    while (
      failureSequence.nextIndex < failureSequence.queue.length &&
      failureSequence.age >= failureSequence.queue[failureSequence.nextIndex].explodeAt
    ) {
      var entry = failureSequence.queue[failureSequence.nextIndex];
      triggerFailureBlast(entry.body);
      explodedIds.add(entry.body.id);
      soundLevel = Math.max(soundLevel, entry.body.level);
      failureSequence.nextIndex += 1;
    }

    if (explodedIds.size > 0) {
      items = items.filter(function (body) {
        return !explodedIds.has(body.id);
      });
      playFailureExplosionSound(soundLevel);
    }

    if (failureSequence.age >= failureSequence.finishAt) {
      finishGame();
    }
  }

  function updateEffects(dt) {
    for (var i = particles.length - 1; i >= 0; i -= 1) {
      var particle = particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      particle.vy += 280 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }

    for (var j = floaters.length - 1; j >= 0; j -= 1) {
      var floater = floaters[j];
      floater.life -= dt;
      floater.y -= 34 * dt;
      if (floater.life <= 0) {
        floaters.splice(j, 1);
      }
    }

    if (highestCelebration) {
      for (var celebrationBodyIndex = 0; celebrationBodyIndex < items.length; celebrationBodyIndex += 1) {
        if (items[celebrationBodyIndex].id === highestCelebration.bodyId) {
          highestCelebration.x = items[celebrationBodyIndex].x;
          highestCelebration.y = items[celebrationBodyIndex].y;
          break;
        }
      }
      highestCelebration.age += dt;
      while (
        highestCelebration.burstIndex < CELEBRATION_BURST_TIMES.length &&
        highestCelebration.age >= CELEBRATION_BURST_TIMES[highestCelebration.burstIndex]
      ) {
        var burstIndex = highestCelebration.burstIndex;
        var burstAngle = -2.35 + burstIndex * 1.72;
        var burstDistance = 115 + burstIndex % 2 * 42;
        var burstX = clamp(highestCelebration.x + Math.cos(burstAngle) * burstDistance, 42, WORLD_WIDTH - 42);
        var burstY = clamp(highestCelebration.y + Math.sin(burstAngle) * burstDistance, 72, WORLD_HEIGHT - 62);
        addCelebrationBurst(burstX, burstY, 36, 125, 235);
        shake = Math.max(shake, 8.5);
        highestCelebration.burstIndex += 1;
      }
      if (highestCelebration.age >= highestCelebration.duration) {
        highestCelebration = null;
      }
    }

    for (var k = celebrationParticles.length - 1; k >= 0; k -= 1) {
      var celebrationParticle = celebrationParticles[k];
      celebrationParticle.life -= dt;
      if (celebrationParticle.life <= 0) {
        celebrationParticles.splice(k, 1);
        continue;
      }
      celebrationParticle.vy += celebrationParticle.gravity * dt;
      celebrationParticle.vx *= Math.pow(0.985, dt * 60);
      celebrationParticle.x += celebrationParticle.vx * dt;
      celebrationParticle.y += celebrationParticle.vy * dt;
      celebrationParticle.rotation += celebrationParticle.spin * dt;
    }

    for (var blastIndex = failureBlasts.length - 1; blastIndex >= 0; blastIndex -= 1) {
      failureBlasts[blastIndex].age += dt;
      if (failureBlasts[blastIndex].age >= failureBlasts[blastIndex].duration) {
        failureBlasts.splice(blastIndex, 1);
      }
    }
  }

  function updateDanger(dt) {
    dangerIsNear = false;
    dangerIsCrossed = false;
    items.forEach(function (body) {
      if (body.age < body.dangerGrace) {
        return;
      }
      var itemTop = body.y - body.radius;
      if (itemTop <= DANGER_LINE + DANGER_PROXIMITY) {
        dangerIsNear = true;
      }
      if (itemTop < DANGER_LINE) {
        dangerIsCrossed = true;
      }
    });

    if (dangerIsCrossed) {
      dangerTimer += dt;
    } else {
      dangerTimer = Math.max(0, dangerTimer - dt * 2.8);
    }

    if (dangerTimer >= DANGER_DELAY) {
      startFailureExplosion();
    }
  }

  function physicsStep(dt) {
    if (mode === "ending") {
      updateFailureExplosion(dt);
      updateEffects(dt);
      return;
    }
    if (mode !== "playing") {
      return;
    }

    if (!readyToDrop) {
      dropCooldown -= dt;
      if (dropCooldown <= 0) {
        prepareNextItem();
      }
    }

    var damping = Math.pow(AIR_DAMPING, dt * 60);
    items.forEach(function (body) {
      body.age += dt;
      body.popTime = Math.max(0, body.popTime - dt);
      body.vy += GRAVITY * dt;
      body.vx *= damping;

      var speed = Math.hypot(body.vx, body.vy);
      if (speed > MAX_SPEED) {
        var factor = MAX_SPEED / speed;
        body.vx *= factor;
        body.vy *= factor;
      }

      body.x += body.vx * dt;
      body.y += body.vy * dt;
    });

    var candidates = new Map();
    var grounded = new Set();

    for (var iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
      items.forEach(function (body) {
        solveBounds(body, grounded);
      });

      for (var i = 0; i < items.length; i += 1) {
        for (var j = i + 1; j < items.length; j += 1) {
          var a = items[i];
          var b = items[j];
          var contact = getContact(a, b, 0);
          collectMergeCandidate(a, b, candidates, contact);
          solveCircleCollision(a, b, contact);
        }
      }

      items.forEach(function (body) {
        solveBounds(body, grounded);
      });
    }

    for (var first = 0; first < items.length; first += 1) {
      for (var second = first + 1; second < items.length; second += 1) {
        collectMergeCandidate(items[first], items[second], candidates);
      }
    }

    var groundFactor = Math.exp(-GROUND_DRAG * dt);
    items.forEach(function (body) {
      if (grounded.has(body.id)) {
        body.vx *= groundFactor;
        if (Math.abs(body.vy) < 9) {
          body.vy = 0;
        }
      }
    });

    applyMerges(candidates);
    updateEffects(dt);
    updateDanger(dt);
  }

  function drawDangerLine(now) {
    var pulse = (Math.sin(now / 90) + 1) / 2;
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash(dangerIsCrossed ? [10, 4] : [7, 7]);
    ctx.lineDashOffset = dangerIsCrossed ? -(now / 24) % 14 : 0;
    ctx.beginPath();
    ctx.moveTo(LEFT_WALL + 10, DANGER_LINE);
    ctx.lineTo(RIGHT_WALL - 10, DANGER_LINE);

    if (dangerIsCrossed) {
      ctx.shadowColor = "rgba(220, 63, 76, 0.88)";
      ctx.shadowBlur = 12 + pulse * 8;
      ctx.lineWidth = 9 + pulse * 4;
      ctx.strokeStyle = "rgba(220, 63, 76, " + (0.16 + pulse * 0.14) + ")";
      ctx.stroke();

      ctx.shadowBlur = 5 + pulse * 5;
      ctx.lineWidth = 3.4 + pulse * 1.4;
      ctx.strokeStyle = "rgba(220, 63, 76, " + (0.84 + pulse * 0.16) + ")";
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = dangerIsNear ? "rgba(220, 63, 76, 0.62)" : "rgba(174, 159, 140, 0.55)";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAimGuide() {
    if (mode !== "playing" || !readyToDrop) {
      return;
    }

    var radius = LEVELS[currentLevel].radius;
    ctx.save();
    ctx.strokeStyle = "rgba(111, 85, 198, 0.26)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(aimX, SPAWN_Y + radius + 7);
    ctx.lineTo(aimX, FLOOR - 8);
    ctx.stroke();
    ctx.restore();
  }

  function drawLevelImage(levelIndex, radius) {
    var image = LEVEL_ASSETS[levelIndex];
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return;
    }

    var box = radius * 2;
    var fitScale = Math.min(box / image.naturalWidth, box / image.naturalHeight);
    var width = image.naturalWidth * fitScale;
    var height = image.naturalHeight * fitScale;

    ctx.drawImage(image, -width / 2, -height / 2, width, height);
  }

  function drawItemBackground(radius) {
    var angle = 120 * Math.PI / 180;
    var reach = radius * Math.SQRT2;
    var dx = Math.sin(angle) * reach;
    var dy = -Math.cos(angle) * reach;
    var gradient = ctx.createLinearGradient(-dx, -dy, dx, dy);
    gradient.addColorStop(0, "#fdfbfb");
    gradient.addColorStop(1, "#ebedee");
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  function drawItem(body, alpha, preview) {
    var radius = body.radius;
    var scale = 1;
    if (body.popTime > 0) {
      var progress = 1 - body.popTime / 0.18;
      scale = 1 + Math.sin(progress * Math.PI) * 0.13;
    }
    if (highestCelebration && body.id === highestCelebration.bodyId && !highestCelebration.reduced) {
      var celebrationProgress = clamp(highestCelebration.age / highestCelebration.duration, 0, 1);
      var iconPopProgress = clamp(celebrationProgress / 0.3, 0, 1);
      scale *= 1 + Math.sin(iconPopProgress * Math.PI) * 0.52 * (1 - iconPopProgress * 0.28);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(body.x, body.y);
    ctx.scale(scale, scale);

    if (!preview) {
      ctx.shadowColor = "rgba(54, 45, 35, 0.16)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
    }

    drawItemBackground(radius);
    ctx.shadowColor = "transparent";
    drawLevelImage(body.level, radius);
    ctx.restore();
  }

  function drawFailureSweep() {
    if (!failureSequence || failureSequence.queue.length === 0) {
      return;
    }

    var progress = clamp((failureSequence.age - 0.06) / FAILURE_SWEEP_DURATION, 0, 1);
    var sweepY = failureSequence.firstTop + (failureSequence.lastTop - failureSequence.firstTop) * progress;
    var sweepFade = 1 - clamp((failureSequence.age - 0.06 - FAILURE_SWEEP_DURATION) / 0.28, 0, 1);
    var band = ctx.createLinearGradient(0, sweepY - 38, 0, sweepY + 38);
    band.addColorStop(0, "rgba(255, 102, 122, 0)");
    band.addColorStop(0.38, "rgba(255, 93, 126, 0.12)");
    band.addColorStop(0.5, "rgba(255, 245, 176, 0.42)");
    band.addColorStop(0.62, "rgba(255, 143, 91, 0.18)");
    band.addColorStop(1, "rgba(255, 143, 91, 0)");

    ctx.save();
    ctx.globalAlpha = sweepFade;
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = band;
    ctx.fillRect(LEFT_WALL, sweepY - 38, RIGHT_WALL - LEFT_WALL, 76);
    ctx.restore();
  }

  function drawFailureBlasts() {
    var reduced = prefersReducedMotion();

    failureBlasts.forEach(function (blast) {
      var progress = clamp(blast.age / blast.duration, 0, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var alpha = Math.pow(1 - progress, 0.72);
      var glowRadius = blast.radius * (0.9 + eased * 1.75);

      ctx.save();
      ctx.translate(blast.x, blast.y);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha * 0.44;
      ctx.fillStyle = progress < 0.45 ? "#fff4bd" : blast.color;
      ctx.beginPath();
      ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = "#fff3a5";
      ctx.lineWidth = Math.max(2.5, blast.radius * 0.085 * (1 - progress));
      ctx.beginPath();
      ctx.arc(0, 0, blast.radius * (0.82 + eased * 1.85), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.55;
      ctx.strokeStyle = blast.color;
      ctx.lineWidth = Math.max(1.8, blast.radius * 0.045);
      ctx.beginPath();
      ctx.arc(0, 0, blast.radius * (0.65 + eased * 1.25), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(blast.x, blast.y);
      if (reduced) {
        ctx.globalAlpha = alpha;
        ctx.scale(1 + eased * 0.18, 1 + eased * 0.18);
        drawItemBackground(blast.radius);
        drawLevelImage(blast.level, blast.radius);
      } else {
        var shardCount = 4;
        for (var shard = 0; shard < shardCount; shard += 1) {
          var startAngle = Math.PI * 2 * shard / shardCount - 0.06;
          var endAngle = Math.PI * 2 * (shard + 1) / shardCount + 0.06;
          var middleAngle = (startAngle + endAngle) / 2;
          var shardDistance = eased * blast.radius * (0.62 + shard % 2 * 0.2);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, blast.radius * 1.12, startAngle, endAngle);
          ctx.closePath();
          ctx.clip();
          ctx.translate(Math.cos(middleAngle) * shardDistance, Math.sin(middleAngle) * shardDistance);
          ctx.rotate((shard % 2 === 0 ? 1 : -1) * eased * (0.18 + shard * 0.012));
          ctx.globalAlpha = alpha;
          drawItemBackground(blast.radius);
          drawLevelImage(blast.level, blast.radius);
          ctx.restore();
        }
      }
      ctx.restore();
    });
  }

  function drawParticles() {
    ctx.save();
    particles.forEach(function (particle) {
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    floaters.forEach(function (floater) {
      ctx.save();
      ctx.globalAlpha = clamp(floater.life / floater.maxLife, 0, 1);
      ctx.fillStyle = "#4e3c88";
      ctx.font = "800 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(floater.text, floater.x, floater.y);
      ctx.restore();
    });
  }

  function drawHighestCelebrationBackdrop() {
    if (!highestCelebration) {
      return;
    }

    var age = highestCelebration.age;
    var progress = clamp(age / highestCelebration.duration, 0, 1);
    var expansion = 1 - Math.pow(1 - progress, 3);
    var fade = 1 - clamp((progress - 0.66) / 0.34, 0, 1);
    var glowRadius = 95 + expansion * 285;

    ctx.save();
    var vignette = ctx.createRadialGradient(
      highestCelebration.x,
      highestCelebration.y,
      42,
      highestCelebration.x,
      highestCelebration.y,
      430
    );
    vignette.addColorStop(0, "rgba(63, 32, 123, 0)");
    vignette.addColorStop(0.5, "rgba(63, 32, 123, " + (0.12 * fade) + ")");
    vignette.addColorStop(1, "rgba(37, 17, 88, " + (0.38 * fade) + ")");
    ctx.fillStyle = vignette;
    ctx.fillRect(LEFT_WALL, 0, RIGHT_WALL - LEFT_WALL, FLOOR);

    ctx.globalCompositeOperation = "lighter";
    var verticalBeam = ctx.createLinearGradient(
      highestCelebration.x - 115,
      0,
      highestCelebration.x + 115,
      0
    );
    verticalBeam.addColorStop(0, "rgba(165, 110, 255, 0)");
    verticalBeam.addColorStop(0.42, "rgba(203, 172, 255, " + (0.2 * fade) + ")");
    verticalBeam.addColorStop(0.5, "rgba(255, 255, 255, " + (0.58 * fade) + ")");
    verticalBeam.addColorStop(0.58, "rgba(255, 226, 91, " + (0.26 * fade) + ")");
    verticalBeam.addColorStop(1, "rgba(255, 226, 91, 0)");
    ctx.fillStyle = verticalBeam;
    ctx.fillRect(highestCelebration.x - 115, 0, 230, FLOOR);

    var horizontalBeam = ctx.createLinearGradient(
      0,
      highestCelebration.y - 54,
      0,
      highestCelebration.y + 54
    );
    horizontalBeam.addColorStop(0, "rgba(140, 231, 255, 0)");
    horizontalBeam.addColorStop(0.5, "rgba(255, 255, 255, " + (0.34 * fade) + ")");
    horizontalBeam.addColorStop(1, "rgba(197, 163, 255, 0)");
    ctx.fillStyle = horizontalBeam;
    ctx.fillRect(LEFT_WALL, highestCelebration.y - 54, RIGHT_WALL - LEFT_WALL, 108);

    ctx.translate(highestCelebration.x, highestCelebration.y);

    var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    glow.addColorStop(0, "rgba(255, 255, 255, " + fade + ")");
    glow.addColorStop(0.18, "rgba(255, 244, 113, " + (0.92 * fade) + ")");
    glow.addColorStop(0.5, "rgba(174, 123, 255, " + (0.58 * fade) + ")");
    glow.addColorStop(1, "rgba(177, 139, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-glowRadius, -glowRadius, glowRadius * 2, glowRadius * 2);

    if (!highestCelebration.reduced) {
      for (var echoIndex = 0; echoIndex < 3; echoIndex += 1) {
        var echoProgress = clamp((age - echoIndex * 0.17) / 1.05, 0, 1);
        if (echoProgress <= 0 || echoProgress >= 1) {
          continue;
        }
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = Math.sin(echoProgress * Math.PI) * (0.34 - echoIndex * 0.065);
        ctx.rotate((echoIndex - 1) * 0.045);
        drawLevelImage(LEVELS.length - 1, 112 + echoProgress * (150 + echoIndex * 28));
        ctx.restore();
      }

      ctx.rotate(progress * Math.PI * 1.15);
      for (var i = 0; i < 24; i += 1) {
        var rayLength = 135 + expansion * (95 + i % 3 * 22);
        var rayWidth = 4 + i % 2 * 3;
        ctx.fillStyle = i % 2
          ? "rgba(255, 255, 255, " + (0.66 * fade) + ")"
          : "rgba(255, 219, 65, " + (0.58 * fade) + ")";
        ctx.beginPath();
        ctx.moveTo(34, -rayWidth);
        ctx.lineTo(rayLength, 0);
        ctx.lineTo(34, rayWidth);
        ctx.closePath();
        ctx.fill();
        ctx.rotate(Math.PI * 2 / 24);
      }
    }

    ctx.restore();
  }

  function drawHighestCelebrationForeground() {
    celebrationParticles.forEach(function (particle) {
      var lifeRatio = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = Math.min(0.78, lifeRatio * 1.35);
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = Math.max(1.2, particle.width * 0.38);
      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - particle.vx * 0.045, particle.y - particle.vy * 0.045);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = Math.min(1, lifeRatio * 1.8);
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillStyle = particle.color;
      if (particle.shape === 0) {
        ctx.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
      } else if (particle.shape === 1) {
        ctx.beginPath();
        ctx.moveTo(0, -particle.height / 2);
        ctx.lineTo(particle.width / 2, 0);
        ctx.lineTo(0, particle.height / 2);
        ctx.lineTo(-particle.width / 2, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -particle.height / 2);
        ctx.lineTo(particle.width * 0.22, -particle.width * 0.22);
        ctx.lineTo(particle.width / 2, 0);
        ctx.lineTo(particle.width * 0.22, particle.width * 0.22);
        ctx.lineTo(0, particle.height / 2);
        ctx.lineTo(-particle.width * 0.22, particle.width * 0.22);
        ctx.lineTo(-particle.width / 2, 0);
        ctx.lineTo(-particle.width * 0.22, -particle.width * 0.22);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });

    if (!highestCelebration) {
      return;
    }

    var age = highestCelebration.age;
    var progress = clamp(age / highestCelebration.duration, 0, 1);
    var fade = 1 - clamp((progress - 0.78) / 0.22, 0, 1);

    ctx.save();
    ctx.translate(highestCelebration.x, highestCelebration.y);
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < 7; i += 1) {
      var ringProgress = clamp((age - i * 0.12) / 1.35, 0, 1);
      if (ringProgress <= 0) {
        continue;
      }
      ctx.globalAlpha = (1 - ringProgress) * fade;
      ctx.strokeStyle = CELEBRATION_COLORS[i % CELEBRATION_COLORS.length];
      ctx.lineWidth = Math.max(3, 12 - i);
      ctx.beginPath();
      ctx.arc(0, 0, 50 + ringProgress * (275 + i * 20), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!highestCelebration.reduced) {
      for (var starIndex = 0; starIndex < 14; starIndex += 1) {
        var starAngle = age * (1.8 + starIndex % 3 * 0.22) + starIndex * Math.PI * 2 / 14;
        var starOrbit = 118 + starIndex % 4 * 28 + Math.sin(age * 4 + starIndex) * 10;
        var starSize = 4 + starIndex % 3 * 2.2;
        ctx.save();
        ctx.globalAlpha = fade * (0.55 + 0.35 * Math.sin(age * 8 + starIndex));
        ctx.translate(Math.cos(starAngle) * starOrbit, Math.sin(starAngle) * starOrbit);
        ctx.rotate(starAngle);
        ctx.fillStyle = CELEBRATION_COLORS[starIndex % CELEBRATION_COLORS.length];
        ctx.beginPath();
        ctx.moveTo(0, -starSize * 2.2);
        ctx.lineTo(starSize * 0.55, -starSize * 0.55);
        ctx.lineTo(starSize * 2.2, 0);
        ctx.lineTo(starSize * 0.55, starSize * 0.55);
        ctx.lineTo(0, starSize * 2.2);
        ctx.lineTo(-starSize * 0.55, starSize * 0.55);
        ctx.lineTo(-starSize * 2.2, 0);
        ctx.lineTo(-starSize * 0.55, -starSize * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    if (!highestCelebration.reduced && age < 1.38) {
      var firstFlash = Math.max(0, 1 - age / 0.18);
      var secondFlash = Math.max(0, 1 - Math.abs(age - 0.56) / 0.12);
      var thirdFlash = Math.max(0, 1 - Math.abs(age - 1.18) / 0.14);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255, 255, 255, " + Math.min(0.78, firstFlash * 0.74 + secondFlash * 0.38 + thirdFlash * 0.3) + ")";
      ctx.fillRect(LEFT_WALL, 0, RIGHT_WALL - LEFT_WALL, FLOOR);
      if (secondFlash > 0 || thirdFlash > 0) {
        ctx.fillStyle = "rgba(194, 112, 255, " + (secondFlash * 0.16 + thirdFlash * 0.12) + ")";
        ctx.fillRect(LEFT_WALL, 0, RIGHT_WALL - LEFT_WALL, FLOOR);
      }
      ctx.restore();
    }
  }

  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvasScaleX, 0, 0, canvasScaleY, 0, 0);
    ctx.save();

    if (highestCelebration && !highestCelebration.reduced) {
      var cameraAge = highestCelebration.age;
      var firstZoom = cameraAge < 0.9 ? Math.sin(cameraAge / 0.9 * Math.PI) : 0;
      var secondZoom = cameraAge >= 0.9 && cameraAge < 1.7
        ? Math.sin((cameraAge - 0.9) / 0.8 * Math.PI)
        : 0;
      var cameraScale = 1 + firstZoom * 0.09 + secondZoom * 0.035;
      ctx.translate(highestCelebration.x, highestCelebration.y);
      ctx.scale(cameraScale, cameraScale);
      ctx.translate(-highestCelebration.x, -highestCelebration.y);
    }

    if (shake > 0.08) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= 0.87;
    } else {
      shake = 0;
    }

    drawDangerLine(now);
    drawAimGuide();
    drawHighestCelebrationBackdrop();
    drawFailureSweep();

    items.forEach(function (body) {
      drawItem(body, 1, false);
    });

    drawFailureBlasts();

    if (mode === "playing" && readyToDrop) {
      drawItem({
        level: currentLevel,
        radius: LEVELS[currentLevel].radius,
        x: aimX,
        y: SPAWN_Y,
        popTime: 0
      }, 0.76, true);
    }

    drawParticles();
    drawHighestCelebrationForeground();
    ctx.restore();
  }

  function animationFrame(now) {
    var nextDpr = clamp(window.devicePixelRatio || 1, 1, 4);
    if (nextDpr !== dpr) {
      syncCanvasResolution();
    }
    var elapsed = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;

    if ((mode === "playing" || mode === "ending") && !document.hidden) {
      accumulator += elapsed;
      var steps = 0;
      while (accumulator >= FIXED_STEP && steps < MAX_STEPS) {
        physicsStep(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === MAX_STEPS) {
        accumulator = Math.min(accumulator, FIXED_STEP);
      }
    }

    render(now);
    window.requestAnimationFrame(animationFrame);
  }

  function ensureAudio() {
    if (!soundEnabled) {
      return;
    }
    try {
      var AudioConstructor = window.AudioContext || window.webkitAudioContext;
      if (!audioContext && AudioConstructor) {
        audioContext = new AudioConstructor();
      }
      if (audioContext && audioContext.state === "suspended") {
        var resumeResult = audioContext.resume();
        if (resumeResult && typeof resumeResult.catch === "function") {
          resumeResult.catch(function () {});
        }
      }
    } catch (error) {
      audioContext = null;
    }
  }

  function playTone(frequency, duration, volume, type, delay) {
    if (!soundEnabled) {
      return;
    }
    ensureAudio();
    if (!audioContext) {
      return;
    }

    try {
      var startAt = audioContext.currentTime + (delay || 0);
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);
    } catch (error) {
      // Audio feedback is optional.
    }
  }

  function playDropSound(level) {
    playTone(185 + level * 20, 0.08, 0.035, "sine", 0);
  }

  function playMergeSound(level) {
    var frequency = 285 * Math.pow(1.115, Math.min(level, 10));
    playTone(frequency, 0.13, 0.055, "sine", 0);
    playTone(frequency * 1.5, 0.1, 0.032, "triangle", 0.055);
  }

  function playHighestCelebrationSound() {
    playTone(523.25, 0.28, 0.052, "triangle", 0.02);
    playTone(659.25, 0.3, 0.05, "triangle", 0.12);
    playTone(783.99, 0.34, 0.048, "sine", 0.23);
    playTone(1046.5, 0.55, 0.055, "sine", 0.36);
  }

  function playFailureExplosionSound(level) {
    var frequency = 105 + Math.min(level, 10) * 13;
    playTone(frequency, 0.11, 0.036, "square", 0);
    playTone(frequency * 0.56, 0.16, 0.028, "triangle", 0.025);
  }

  function playGameOverSound() {
    playTone(245, 0.2, 0.045, "sine", 0);
    playTone(185, 0.28, 0.04, "sine", 0.16);
  }

  againButton.addEventListener("click", function () {
    startGame(true);
  });

  function resetFrameClock() {
    lastFrameTime = performance.now();
    accumulator = 0;
    activePointer = null;
  }

  function closeRestartConfirm(shouldRestart) {
    if (mode !== "confirming") {
      return;
    }
    restartConfirmOverlay.hidden = true;
    if (shouldRestart) {
      startGame(true);
      return;
    }
    resetFrameClock();
    mode = "playing";
    canvas.tabIndex = 0;
    updateControls();
    focusCanvas();
  }

  restartButton.addEventListener("click", function () {
    if (mode !== "playing") {
      return;
    }
    mode = "confirming";
    resetFrameClock();
    canvas.tabIndex = -1;
    updateControls();
    restartConfirmOverlay.hidden = false;
    window.setTimeout(function () {
      restartCancelButton.focus();
    }, 0);
  });

  restartCancelButton.addEventListener("click", function () {
    closeRestartConfirm(false);
  });

  restartConfirmButton.addEventListener("click", function () {
    closeRestartConfirm(true);
  });

  document.addEventListener("keydown", function (event) {
    if (mode === "confirming" && event.key === "Escape") {
      closeRestartConfirm(false);
      event.preventDefault();
    }
  });

  soundButton.addEventListener("click", function () {
    soundEnabled = !soundEnabled;
    updateSoundControl();
    if (soundEnabled) {
      playTone(440, 0.08, 0.035, "sine", 0);
    }
  });

  function finishPointerGesture(event, shouldDrop) {
    if (event.pointerId !== activePointer) {
      return;
    }

    if (shouldDrop) {
      moveAimFromEvent(event);
    }
    activePointer = null;

    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      // The browser may already have released capture.
    }

    if (shouldDrop) {
      dropCurrentItem();
    }
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  canvas.addEventListener("pointerdown", function (event) {
    if (mode !== "playing" || !readyToDrop || activePointer !== null) {
      return;
    }
    activePointer = event.pointerId;
    moveAimFromEvent(event);
    try {
      if (canvas.setPointerCapture) {
        canvas.setPointerCapture(event.pointerId);
      }
    } catch (error) {
      // Window-level pointer listeners provide the fallback.
    }
    ensureAudio();
    if (event.cancelable) {
      event.preventDefault();
    }
  });

  canvas.addEventListener("pointermove", function (event) {
    if (event.pointerId === activePointer || (activePointer === null && event.pointerType === "mouse")) {
      moveAimFromEvent(event);
      if (event.cancelable) {
        event.preventDefault();
      }
    }
  });

  canvas.addEventListener("pointerup", function (event) {
    finishPointerGesture(event, true);
  });

  canvas.addEventListener("pointercancel", function (event) {
    finishPointerGesture(event, false);
  });

  canvas.addEventListener("lostpointercapture", function (event) {
    if (event.pointerId === activePointer) {
      activePointer = null;
    }
  });

  window.addEventListener("pointermove", function (event) {
    if (event.pointerId === activePointer && event.target !== canvas) {
      moveAimFromEvent(event);
      if (event.cancelable) {
        event.preventDefault();
      }
    }
  }, { passive: false });

  window.addEventListener("pointerup", function (event) {
    finishPointerGesture(event, true);
  }, { passive: false });

  window.addEventListener("pointercancel", function (event) {
    finishPointerGesture(event, false);
  }, { passive: false });

  canvas.addEventListener("keydown", function (event) {
    if (mode !== "playing") {
      return;
    }

    ensureAudio();

    if ((event.key === "ArrowLeft" || event.key === "a" || event.key === "A") && readyToDrop) {
      aimX = limitAimX(aimX - 15);
      event.preventDefault();
    } else if ((event.key === "ArrowRight" || event.key === "d" || event.key === "D") && readyToDrop) {
      aimX = limitAimX(aimX + 15);
      event.preventDefault();
    } else if (event.key === " " || event.key === "Enter" || event.key === "ArrowDown") {
      dropCurrentItem();
      event.preventDefault();
    }
  });

  document.addEventListener("visibilitychange", resetFrameClock);

  window.addEventListener("blur", function () {
    activePointer = null;
  });

  window.addEventListener("resize", syncCanvasResolution, { passive: true });
  window.addEventListener("pageshow", function () {
    syncCanvasResolution();
    resetFrameClock();
  });
  window.addEventListener("pagehide", resetFrameClock);

  applyUiConfig();
  syncCanvasResolution();
  updateSoundControl();
  startGame(false);
  window.requestAnimationFrame(animationFrame);
}());
