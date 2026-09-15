(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const game = $("#game");
  const playerElement = $("#player");
  const objects = $("#world-objects");
  const basket = $("#basket");
  const progress = $("#berry-progress");
  const destination = $("#destination");
  const picnicButton = $("#picnic-button");
  const helpDialog = $("#help-dialog");
  const winDialog = $("#win-dialog");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const WIDTH = 1000;
  const HEIGHT = 570;
  const SPEED = 185;
  const PICKUP_RADIUS = 28;
  const BASKET = { x: 640, y: 400 };
  const START = { x: 340, y: 387 };
  const BERRIES = [
    { x: 220, y: 285 },
    { x: 475, y: 255 },
    { x: 800, y: 315 },
    { x: 170, y: 481 },
    { x: 440, y: 487 },
    { x: 843, y: 486 },
  ];
  const FRIENDS = [
    {
      name: "Hazel",
      type: "hedgehog",
      x: 532,
      y: 392,
      lines: [
        "Hazel: “I brought my favorite leaf. It’s a very good leaf.”",
        "Hazel: “Being prickly doesn’t mean I don’t love hugs.”",
        "Hazel: “I saved you the sunny spot.”",
      ],
    },
    {
      name: "Marmalade",
      type: "cat",
      x: 726,
      y: 367,
      lines: [
        "Marmalade: “I wasn’t napping. I was practicing being cozy.”",
        "Marmalade: “You, me, and absolutely no plans.”",
        "Marmalade: “This is my favorite kind of purr-ty.”",
      ],
    },
    {
      name: "Puddles",
      type: "duck",
      x: 716,
      y: 491,
      lines: [
        "Puddles: “I brought absolutely nothing. Except enthusiasm.”",
        "Puddles: “You’re my favorite little land duck.”",
        "Puddles: “A picnic! With snacks! And you!”",
      ],
    },
  ];
  const pickupNotes = [
    "One for the basket. A little joy for the road.",
    "This one looks like a tiny heart.",
    "Half a basket, and a whole lot of happy.",
    "Hazel says this is very important berry business.",
    "Almost there. Puddles can hardly contain himself.",
    "Six sweet berries! Bring them to the picnic basket.",
  ];

  const LEVELS = [
    {
      name: "The strawberry picnic",
      item: "strawberry",
      plural: "strawberries",
      sprite: "berry",
      points: BERRIES,
      start: START,
      goal: BASKET,
      objective: "A picnic for everyone",
      instruction: "Find 6 sweet strawberries",
      readyTitle: "The sweetest little haul!",
      readyCopy: "Bring your berries to the basket",
      goalLabel: "Picnic basket. Gather six strawberries first.",
      readyLabel: "Share all six strawberries at the picnic basket",
      action: "Bring berries to the picnic",
      prompt: "Picnic time!",
      welcome: "Little paws. Big picnic plans.",
      notes: pickupNotes,
      intro: "A few strawberries. A few friends. A lovely little afternoon.",
      weather: "a very good day",
      weatherIcon: "icon-sun",
      help: "Help Clover gather <strong>6 strawberries</strong>, then bring them to the picnic basket.",
      finishedTitle: "Good things are for sharing",
      finishedCopy: "A full basket & happy hearts",
      finishedLabel: "A full picnic basket. Share a happy moment.",
      finishedNote: "And just like that, an ordinary day became a lovely one.",
      winEyebrow: "LEVEL 1 COMPLETE. MORE MAGIC AWAITS.",
      winTitle: "A little kindness.<br>A lovely little picnic.",
      winCopy:
        "You brought the strawberries.<br>They brought the very best company.",
      winMessage: "“There’s one more little adventure before bedtime.”",
      afterLine: "Puddles: “Same time tomorrow? And the day after that?”",
    },
    {
      name: "A little starlight",
      item: "fallen star",
      plural: "fallen stars",
      sprite: "star",
      points: [
        { x: 200, y: 366 },
        { x: 385, y: 250 },
        { x: 645, y: 255 },
        { x: 855, y: 388 },
        { x: 474, y: 491 },
        { x: 142, y: 496 },
      ],
      start: { x: 354, y: 420 },
      goal: BASKET,
      objective: "A little light for everyone",
      instruction: "Find 6 sleepy fallen stars",
      readyTitle: "A pocket full of starlight!",
      readyCopy: "Bring your stars to the lantern",
      goalLabel: "Unlit lantern. Gather six fallen stars first.",
      readyLabel: "Light the lantern with all six fallen stars",
      action: "Bring stars to the lantern",
      prompt: "Let’s glow!",
      welcome: "The sun is tucked in. Let’s find a little starlight.",
      notes: [
        "A sleepy little star. It’s warm as a hug.",
        "This one fell right into a patch of clover.",
        "Three tiny stars. Half a pocket of magic.",
        "Puddles is making a very important wish.",
        "Just one more little light to find.",
        "Six tiny stars! Bring them to the lantern.",
      ],
      intro:
        "The sun has tucked itself in. There’s a little magic left to find.",
      weather: "a very cozy evening",
      weatherIcon: "icon-moon",
      help: "Help Clover gather <strong>6 fallen stars</strong>, then bring them to the lantern to light up the picnic.",
      finishedTitle: "You made the meadow glow",
      finishedCopy: "Six stars & four cozy friends",
      finishedLabel: "A glowing lantern. Share a cozy moment.",
      finishedNote: "A little light, a little company. Everything we need.",
      winEyebrow: "TWO LITTLE ADVENTURES. FOUR HAPPY HEARTS.",
      winTitle: "A little light.<br>A whole lot of lovely.",
      winCopy:
        "Six tiny stars. One cozy lantern.<br>And nowhere else you need to be.",
      winMessage: "“Even the smallest light is lovelier together.”",
      afterLine: "Puddles: “I wished for more days with you.”",
      friendLines: [
        [
          "Hazel: “I’m keeping a little starlight in my favorite leaf.”",
          "Hazel: “I’m not afraid of the dark when we’re together.”",
        ],
        [
          "Marmalade: “I’m very good at counting stars. One… zzz.”",
          "Marmalade: “The moon looks like a very cozy pillow.”",
        ],
        [
          "Puddles: “Do you think stars say twack instead of quack?”",
          "Puddles: “My wish? More afternoons just like this one.”",
        ],
      ],
    },
  ];
  const basketArtwork = basket.querySelector("svg").outerHTML;
  let levelIndex = 0;
  let level = LEVELS[levelIndex];
  let position = { ...START };
  let target = null;
  let berries = [];
  let count = 0;
  let complete = false;
  let round = 0;
  let lastTime = null;
  let audioContext;
  let soundEnabled = false;
  let greetingTimers = new Map();
  const keys = new Set();
  const movementKeys = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "w",
    "a",
    "s",
    "d",
  ]);

  function sprite(id, className = "") {
    const viewBox = document.getElementById(id).getAttribute("viewBox");
    return `<svg class="${className}" viewBox="${viewBox}" aria-hidden="true"><use href="#${id}"/></svg>`;
  }

  function place(element, x, y) {
    element.style.left = `${(x / WIDTH) * 100}%`;
    element.style.top = `${(y / HEIGHT) * 100}%`;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function announce(text) {
    $("#announcer").textContent = text;
  }

  function note(text, speak = false) {
    $("#field-note-text").textContent = text;
    if (speak) announce(text);
  }

  // A seeded meadow: the flowers never move around between visits.
  function plantMeadow() {
    let seed = 73;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const flowerBed = $("#scattered-flowers");
    for (let i = 0; i < 112; i++) {
      const x = 28 + random() * 944;
      const y = 223 + random() * 322;
      // Keep the picnic and the little path legible.
      if (
        (x > 505 && x < 796 && y > 337 && y < 490) ||
        (x > 293 && x < 406 && y < 380)
      )
        continue;
      const type =
        i % 4 === 0 ? "pink-flower" : i % 3 === 0 ? "flower" : "grass";
      const size = type === "grass" ? 12 + random() * 8 : 13 + random() * 10;
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", `#${type}`);
      use.setAttribute("x", x.toFixed(1));
      use.setAttribute("y", y.toFixed(1));
      use.setAttribute("width", size.toFixed(1));
      use.setAttribute("height", (size * 1.3).toFixed(1));
      if (type !== "grass") {
        use.classList.add("meadow-flower");
        use.style.setProperty("--delay", `${-random() * 5}s`);
      }
      flowerBed.append(use);
    }
  }

  function chime(kind = "berry") {
    if (!soundEnabled || !audioContext) return;
    if (audioContext.state === "suspended")
      void audioContext.resume().catch(() => {});
    const melodies = {
      berry: [523.25, 659.25, 783.99],
      star: [659.25, 880, 1046.5],
      friend: [392, 523.25],
      finish: [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5],
      hello: [392, 523.25, 659.25],
    };
    const notes = melodies[kind];
    const start = audioContext.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const time = start + index * 0.105;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.07, time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.36);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.4);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }

  function burst(x, y, amount = 7) {
    if (reducedMotion.matches) return;
    for (let i = 0; i < amount; i++) {
      const particle = document.createElement("span");
      particle.className = "particle";
      particle.textContent = i % 3 === 0 ? "♡" : i % 2 === 0 ? "✧" : "·";
      place(particle, x, y - 25);
      particle.style.setProperty("--dx", `${(Math.random() - 0.5) * 100}px`);
      particle.style.setProperty("--dy", `${-35 - Math.random() * 65}px`);
      particle.style.setProperty(
        "--rotation",
        `${(Math.random() - 0.5) * 60}deg`,
      );
      particle.style.setProperty(
        "--particle-color",
        ["#d88f7f", "#fffbe0", "#b99d58"][i % 3],
      );
      $("#particles").append(particle);
      particle.addEventListener("animationend", () => particle.remove(), {
        once: true,
      });
      // Also clean up if the motion preference changes during the animation.
      setTimeout(() => particle.remove(), 1200);
    }
  }

  function stopWalking() {
    target = null;
    keys.clear();
    destination.classList.remove("active");
    playerElement.classList.remove("walking");
  }

  function walkTo(x, y) {
    if (helpDialog.open || winDialog.open) return;
    game.focus({ preventScroll: true });
    keys.clear();
    target = {
      x: Math.max(70, Math.min(942, x)),
      y: Math.max(220, Math.min(526, y)),
    };
    place(destination, target.x, target.y);
    destination.classList.add("active");
  }

  function updateProgress() {
    $("#counter").innerHTML = `${count}<span> / 6</span>`;
    progress.setAttribute("aria-valuenow", String(count));
    progress.setAttribute(
      "aria-valuetext",
      `${count} of 6 ${level.plural} gathered`,
    );
    [...progress.children].forEach((dot, i) =>
      dot.classList.toggle("filled", i < count),
    );
  }

  function collect(berry) {
    if (berry.collected) return;
    berry.collected = true;
    count++;
    berry.element.classList.add("collected");
    berry.element.disabled = true;
    berry.element.setAttribute("aria-hidden", "true");
    setTimeout(() => berry.element.remove(), 410);
    updateProgress();
    burst(berry.x, berry.y);
    chime(levelIndex === 0 ? "berry" : "star");
    note(level.notes[count - 1]);
    announce(
      `${count} of 6 ${level.plural} gathered. ${level.notes[count - 1]}`,
    );
    if (count === 6) {
      game.classList.add("ready");
      $("#objective-title").textContent = level.readyTitle;
      $("#objective-copy").textContent = level.readyCopy;
      basket.setAttribute("aria-label", level.readyLabel);
      picnicButton.disabled = false;
    }
  }

  function greet(friend, element) {
    friend.visits = (friend.visits || 0) + 1;
    note(friend.lines[(friend.visits - 1) % friend.lines.length], true);
    element.classList.remove("happy");
    void element.offsetWidth;
    element.classList.add("happy");
    clearTimeout(greetingTimers.get(element));
    greetingTimers.set(
      element,
      setTimeout(() => {
        element.classList.remove("happy");
        greetingTimers.delete(element);
      }, 1500),
    );
    burst(friend.x, friend.y - 40, 3);
    chime("friend");
  }

  function finish() {
    if (complete) return;
    complete = true;
    stopWalking();
    game.classList.remove("ready");
    game.classList.add("completed");
    $("#objective-title").textContent = level.finishedTitle;
    $("#objective-copy").textContent = level.finishedCopy;
    basket.setAttribute("aria-label", level.finishedLabel);
    const hasNextLevel = levelIndex < LEVELS.length - 1;
    picnicButton.innerHTML = hasNextLevel
      ? "Level 2: a little starlight <span>↗</span>"
      : "Play both levels again <span>↻</span>";
    $("#level-next").textContent = hasNextLevel
      ? "A little starlight awaits ✧"
      : "Two lovely adventures complete ♡";
    $("#win-eyebrow").textContent = level.winEyebrow;
    $("#win-title").innerHTML = level.winTitle;
    $("#win-copy").innerHTML = level.winCopy;
    $(".win-message").textContent = level.winMessage;
    $("#next-level-button").hidden = !hasNextLevel;
    $("#stay-button").className = hasNextLevel
      ? "text-button"
      : "primary-button";
    $("#replay-button").textContent = hasNextLevel
      ? "Replay the picnic ↻"
      : "Play both levels again ↻";
    $(".player-name").innerHTML = "happy Clover <span>♡</span>";
    note(level.finishedNote, true);
    document
      .querySelectorAll(".friend")
      .forEach((element) => element.classList.add("party"));
    burst(level.goal.x, level.goal.y - 30, 22);
    chime("finish");
    const finishedRound = round;
    setTimeout(
      () => {
        const showCelebration = () => {
          if (round !== finishedRound || !complete) return;
          stopWalking();
          winDialog.showModal();
        };
        if (helpDialog.open)
          helpDialog.addEventListener("close", showCelebration, { once: true });
        else showCelebration();
      },
      reducedMotion.matches ? 100 : 700,
    );
  }

  function reset(nextLevel = 0) {
    levelIndex = nextLevel;
    level = LEVELS[levelIndex];
    round++;
    stopWalking();
    greetingTimers.forEach(clearTimeout);
    greetingTimers = new Map();
    count = 0;
    complete = false;
    position = { ...level.start };
    game.classList.remove("ready", "completed");
    game.classList.toggle("twilight", levelIndex === 1);
    winDialog.classList.toggle("twilight", levelIndex === 1);
    game.dataset.level = String(levelIndex + 1);
    game.setAttribute(
      "aria-label",
      `Level ${levelIndex + 1} of 2: ${level.name}. Use arrow keys or W A S D to move Clover, or tap a ${level.item} to walk to it.`,
    );
    $("#level-count").textContent = `LEVEL ${levelIndex + 1} OF 2`;
    $("#level-name").textContent = level.name;
    $("#level-next").textContent =
      levelIndex === 0
        ? "Up next: a little starlight ✧"
        : "One last lovely thing before bedtime";
    $("#intro-copy").textContent = level.intro;
    $(".weather").innerHTML =
      `${sprite(level.weatherIcon)}<span>${level.weather}</span>`;
    $(".objective-icon").innerHTML = sprite(level.sprite);
    $("#help-objective").innerHTML = level.help;
    $("#toolbar-note").textContent =
      levelIndex === 0
        ? "Take your time. The berries won’t mind."
        : "Take your time. The stars will wait.";
    $("footer > span").innerHTML =
      levelIndex === 0
        ? `no scores, just strawberries ${sprite("berry")}`
        : `no scores, just starlight ${sprite("star")}`;
    basket.innerHTML = `${levelIndex === 0 ? basketArtwork : sprite("lantern")}<span class="basket-prompt">${level.prompt} <span>↓</span></span>`;
    place(basket, level.goal.x, level.goal.y);
    progress.setAttribute(
      "aria-label",
      levelIndex === 0 ? "Strawberries gathered" : "Fallen stars gathered",
    );
    $("#next-level-button").hidden = true;
    playerElement.classList.remove("facing-left");
    $(".player-name").innerHTML = "Clover <span>♡</span>";
    place(playerElement, position.x, position.y);
    objects.replaceChildren();
    $("#particles").replaceChildren();
    progress.innerHTML =
      '<span class="progress-dot" aria-hidden="true"></span>'.repeat(6);
    updateProgress();
    $("#objective-title").textContent = level.objective;
    $("#objective-copy").textContent = level.instruction;
    basket.setAttribute("aria-label", level.goalLabel);
    picnicButton.innerHTML = `${level.action} <span>↗</span>`;
    picnicButton.disabled = true;
    note(level.welcome);
    berries = level.points.map((point, i) => {
      const element = document.createElement("button");
      element.className = `world-object berry-object${levelIndex === 1 ? " star-object" : ""}`;
      element.setAttribute("aria-label", `Walk to ${level.item} ${i + 1}`);
      element.dataset.collectible = String(i + 1);
      element.dataset[level.sprite] = String(i + 1);
      element.style.setProperty("--delay", `${-i * 0.55}s`);
      element.innerHTML = sprite(level.sprite);
      place(element, point.x, point.y);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        walkTo(point.x, point.y);
      });
      objects.append(element);
      return { ...point, element, collected: false };
    });
    FRIENDS.forEach((original, i) => {
      const friend = {
        ...original,
        lines: level.friendLines?.[i] || original.lines,
        visits: 0,
      };
      const element = document.createElement("button");
      element.className = "world-object friend";
      element.dataset.friend = friend.type;
      element.setAttribute(
        "aria-label",
        `Say hello to ${friend.name} the ${friend.type}`,
      );
      element.style.setProperty("--delay", `${-i * 0.35}s`);
      element.innerHTML = `${sprite(friend.type)}<span class="friend-heart" aria-hidden="true">♡</span>`;
      place(element, friend.x, friend.y);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        greet(friend, element);
      });
      objects.append(element);
    });
  }

  function frame(time) {
    const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (!helpDialog.open && !winDialog.open && !document.hidden) {
      let dx = 0;
      let dy = 0;
      if (keys.size) {
        dx =
          Number(keys.has("ArrowRight") || keys.has("d")) -
          Number(keys.has("ArrowLeft") || keys.has("a"));
        dy =
          Number(keys.has("ArrowDown") || keys.has("s")) -
          Number(keys.has("ArrowUp") || keys.has("w"));
      } else if (target) {
        dx = target.x - position.x;
        dy = target.y - position.y;
      }
      const length = Math.hypot(dx, dy);
      const walking = length > 0.5;
      if (walking) {
        const step = keys.size ? SPEED * dt : Math.min(SPEED * dt, length);
        position.x = Math.max(
          70,
          Math.min(942, position.x + (dx / length) * step),
        );
        position.y = Math.max(
          220,
          Math.min(526, position.y + (dy / length) * step),
        );
        if (dx) playerElement.classList.toggle("facing-left", dx < 0);
        place(playerElement, position.x, position.y);
        // Friends behind Clover can be seen over his shoulder; those in front overlap his paws.
        document.querySelectorAll(".friend").forEach((element) => {
          const friend = FRIENDS.find(
            (item) => item.type === element.dataset.friend,
          );
          element.style.zIndex = friend.y > position.y + 8 ? "9" : "7";
        });
      } else if (target) {
        target = null;
        destination.classList.remove("active");
      }
      playerElement.classList.toggle("walking", walking);
      if (!complete) {
        berries.forEach((berry) => {
          if (!berry.collected && distance(position, berry) < PICKUP_RADIUS)
            collect(berry);
        });
        if (count === 6 && distance(position, level.goal) < 32) finish();
      }
    } else {
      playerElement.classList.remove("walking");
    }
    requestAnimationFrame(frame);
  }

  game.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const rect = game.getBoundingClientRect();
    walkTo(
      ((event.clientX - rect.left) / rect.width) * WIDTH,
      ((event.clientY - rect.top) / rect.height) * HEIGHT,
    );
  });

  basket.addEventListener("click", (event) => {
    event.stopPropagation();
    if (complete) {
      note(level.afterLine, true);
      burst(level.goal.x, level.goal.y, 8);
      chime("friend");
    } else {
      walkTo(level.goal.x, level.goal.y);
      if (count < 6) {
        const remainingItem =
          levelIndex === 0
            ? count === 5
              ? "berry"
              : "berries"
            : count === 5
              ? "star"
              : "stars";
        note(
          `A little joy for every friend. Just ${6 - count} more ${remainingItem} to find.`,
          true,
        );
      }
    }
  });

  function continueAdventure() {
    if (!complete) return;
    winDialog.close();
    reset(levelIndex < LEVELS.length - 1 ? levelIndex + 1 : 0);
    game.focus({ preventScroll: true });
    announce(
      `Level ${levelIndex + 1} of 2: ${level.name}. ${level.instruction}. ${level.welcome}`,
    );
  }

  picnicButton.addEventListener("click", () => {
    if (complete) continueAdventure();
    else walkTo(level.goal.x, level.goal.y);
  });
  $("#next-level-button").addEventListener("click", continueAdventure);

  document.addEventListener("keydown", (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (
      !movementKeys.has(key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      helpDialog.open ||
      winDialog.open
    )
      return;
    if (event.target !== document.body && !game.contains(event.target)) return;
    event.preventDefault();
    target = null;
    destination.classList.remove("active");
    keys.add(key);
  });
  document.addEventListener("keyup", (event) =>
    keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key),
  );
  window.addEventListener("blur", stopWalking);
  document.addEventListener("visibilitychange", () => {
    stopWalking();
    lastTime = null;
  });
  game.addEventListener("focusout", (event) => {
    if (!game.contains(event.relatedTarget)) keys.clear();
  });

  $("#sound-button").addEventListener("click", async () => {
    try {
      if (!audioContext) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error("Web Audio unavailable");
        audioContext = new Audio();
      }
      if (audioContext.state === "suspended") await audioContext.resume();
      soundEnabled = !soundEnabled;
      const button = $("#sound-button");
      button.classList.toggle("sound-on", soundEnabled);
      button.setAttribute("aria-pressed", String(soundEnabled));
      button.setAttribute(
        "aria-label",
        `Turn sound ${soundEnabled ? "off" : "on"}`,
      );
      button.title = `Turn sound ${soundEnabled ? "off" : "on"}`;
      if (soundEnabled) chime("hello");
      else if (audioContext.state === "running") await audioContext.suspend();
    } catch {
      soundEnabled = false;
      $("#sound-button").classList.remove("sound-on");
      $("#sound-button").setAttribute("aria-pressed", "false");
      $("#sound-button").setAttribute("aria-label", "Sound is unavailable");
      $("#sound-button").title = "Sound is unavailable";
      note(
        "A quiet little picnic. Sound isn’t available in this browser.",
        true,
      );
    }
  });

  $("#help-button").addEventListener("click", () => {
    stopWalking();
    helpDialog.showModal();
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () =>
      document.getElementById(button.dataset.close).close(),
    );
  });
  $("#stay-button").addEventListener("click", () => winDialog.close());
  $("#replay-button").addEventListener("click", () => {
    winDialog.close();
    reset();
    announce("A fresh afternoon. Six new strawberries to find.");
  });
  [helpDialog, winDialog].forEach((dialog) => {
    dialog.addEventListener("close", () => {
      keys.clear();
      game.focus({ preventScroll: true });
    });
  });

  plantMeadow();
  reset();
  requestAnimationFrame(frame);
})();
