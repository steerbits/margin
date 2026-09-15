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
      `${count} of 6 strawberries gathered`,
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
    chime();
    note(pickupNotes[count - 1]);
    announce(`${count} of 6 strawberries gathered. ${pickupNotes[count - 1]}`);
    if (count === 6) {
      game.classList.add("ready");
      $("#objective-title").textContent = "The sweetest little haul!";
      $("#objective-copy").textContent = "Bring your berries to the basket";
      basket.setAttribute(
        "aria-label",
        "Share all six strawberries at the picnic basket",
      );
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
    $("#objective-title").textContent = "Good things are for sharing";
    $("#objective-copy").textContent = "A full basket & happy hearts";
    basket.setAttribute(
      "aria-label",
      "A full picnic basket. Share a happy moment.",
    );
    picnicButton.innerHTML = "Another lovely afternoon <span>↻</span>";
    $(".player-name").innerHTML = "happy Clover <span>♡</span>";
    note("And just like that, an ordinary day became a lovely one.", true);
    document
      .querySelectorAll(".friend")
      .forEach((element) => element.classList.add("party"));
    burst(BASKET.x, BASKET.y - 30, 22);
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

  function reset() {
    round++;
    stopWalking();
    greetingTimers.forEach(clearTimeout);
    greetingTimers = new Map();
    count = 0;
    complete = false;
    position = { ...START };
    game.classList.remove("ready", "completed");
    playerElement.classList.remove("facing-left");
    $(".player-name").innerHTML = "Clover <span>♡</span>";
    place(playerElement, position.x, position.y);
    objects.replaceChildren();
    $("#particles").replaceChildren();
    progress.innerHTML =
      '<span class="progress-dot" aria-hidden="true"></span>'.repeat(6);
    updateProgress();
    $("#objective-title").textContent = "A picnic for everyone";
    $("#objective-copy").textContent = "Find 6 sweet strawberries";
    basket.setAttribute(
      "aria-label",
      "Picnic basket. Gather six strawberries first.",
    );
    picnicButton.innerHTML = "Bring berries to the picnic <span>↗</span>";
    picnicButton.disabled = true;
    note("Little paws. Big picnic plans.");
    berries = BERRIES.map((point, i) => {
      const element = document.createElement("button");
      element.className = "world-object berry-object";
      element.setAttribute("aria-label", `Walk to strawberry ${i + 1}`);
      element.dataset.berry = String(i + 1);
      element.style.setProperty("--delay", `${-i * 0.55}s`);
      element.innerHTML = sprite("berry");
      place(element, point.x, point.y);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        walkTo(point.x, point.y);
      });
      objects.append(element);
      return { ...point, element, collected: false };
    });
    FRIENDS.forEach((original, i) => {
      const friend = { ...original, visits: 0 };
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
        if (count === 6 && distance(position, BASKET) < 32) finish();
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
      note("Puddles: “Same time tomorrow? And the day after that?”", true);
      burst(BASKET.x, BASKET.y, 8);
      chime("friend");
    } else {
      walkTo(BASKET.x, BASKET.y);
      if (count < 6)
        note(
          `A spot for every friend. Just ${6 - count} more ${count === 5 ? "berry" : "berries"} to find.`,
          true,
        );
    }
  });

  picnicButton.addEventListener("click", () => {
    if (complete) {
      reset();
      game.focus({ preventScroll: true });
      announce("A fresh afternoon. Find six strawberries for your friends.");
    } else walkTo(BASKET.x, BASKET.y);
  });

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
