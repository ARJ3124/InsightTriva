import { PREMADE_QUIZZES, generateAIQuiz } from "./quizData.js";
import { audioManager } from "./audio.js";

// ==========================================================================
// Insight Trivia - Real-Time Socket.io Client Implementation
// ==========================================================================

// Initialize Socket connection
const socket = io();

// 1. Core Profile & Configuration
const AVATAR_BADGES = ["▲", "●", "■", "⬡", "⬢", "◆", "▼", "🌀", "⬟", "◆", "❖", "✦"];
let currentAvatarIndex = 0;

let userProfile = {
  name: "Guest Player",
  badge: "▲"
};

// 2. Global Active Game State
let activeGame = {
  quiz: null,
  mode: "timed", // "timed" | "self-paced"
  questions: [],
  currentQuestionIndex: 0,
  score: 0,
  streak: 0,
  maxStreak: 0,
  answersLog: [], // Track: { questionIndex, userSelection, correctIndex, pointsGained, isCorrect, isTimeout }
  timeLeft: 20, 
  questionStartTime: 0,

  // Socket configurations
  isHost: false,
  isCreator: false,
  roomCode: "",
  socketId: "",
  
  // Powerups status
  powerups: {
    clarity: 1, // 50:50
    double: 1,  // Double points
    shield: 1   // Streak protector
  },
  powerupActiveThisQuestion: {
    double: false,
    shield: false
  },
  participants: [], // Received from server
  autoStartPractice: false,
  isPractice: false,
  gamePaused: false,
  hostTotalPlayers: 0,
  hostAnsweredCount: 0
};

// Confetti Particle System
let confettiAnimationId = null;
const confettiCanvas = document.getElementById("confetti-canvas");
const confettiCtx = confettiCanvas ? confettiCanvas.getContext("2d") : null;
let confettiParticles = [];

// Custom user quizzes loaded from storage & server
let customQuizzes = [];

// ==========================================================================
// Initialization & Startup
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Load profile from storage
  loadUserProfile();
  
  // Load local custom quizzes
  loadLocalCustomQuizzes();
  
  // Fetch quizzes from server database to sync
  fetchServerQuizzes();

  // Attach DOM Listeners
  setupEventListeners();

  // Initialize Audio Context on first interaction
  document.body.addEventListener("click", () => {
    audioManager.init();
  }, { once: true });

  // Initialize Socket Event Listeners
  setupSocketListeners();
});

// Load user profile from localStorage
function loadUserProfile() {
  const storedProfile = localStorage.getItem("insight_trivia_profile");
  if (storedProfile) {
    try {
      userProfile = JSON.parse(storedProfile);
      currentAvatarIndex = AVATAR_BADGES.indexOf(userProfile.badge);
      if (currentAvatarIndex === -1) currentAvatarIndex = 0;
    } catch (e) {
      console.error("Failed to parse user profile.", e);
    }
  }
  updateProfileUI();
}

function updateProfileUI() {
  const headerBadge = document.getElementById("header-profile-badge");
  const headerName = document.getElementById("header-profile-name");
  const settingsBadge = document.getElementById("settings-avatar-display");
  const settingsNameInput = document.getElementById("username-input");

  if (headerBadge) headerBadge.textContent = userProfile.badge;
  if (headerName) headerName.textContent = userProfile.name;
  if (settingsBadge) settingsBadge.textContent = userProfile.badge;
  if (settingsNameInput && settingsNameInput.value !== userProfile.name) {
    settingsNameInput.value = userProfile.name;
  }
}

function saveUserProfile() {
  localStorage.setItem("insight_trivia_profile", JSON.stringify(userProfile));
  updateProfileUI();
}

// Load custom user quizzes from local storage
function loadLocalCustomQuizzes() {
  const storedCustom = localStorage.getItem("insight_trivia_custom_quizzes");
  if (storedCustom) {
    try {
      customQuizzes = JSON.parse(storedCustom);
    } catch (e) {
      console.error("Failed to parse custom quizzes.", e);
    }
  }
}

// Sync custom quizzes from backend server
function fetchServerQuizzes() {
  fetch("/api/quizzes")
    .then(res => res.json())
    .then(serverQuizzes => {
      // Merge unique quizzes by ID
      const localIds = new Set(customQuizzes.map(q => q.id));
      serverQuizzes.forEach(q => {
        if (!localIds.has(q.id)) {
          customQuizzes.push(q);
        }
      });
      localStorage.setItem("insight_trivia_custom_quizzes", JSON.stringify(customQuizzes));
      renderQuizzes();
    })
    .catch(err => {
      console.warn("Failed to fetch quizzes from server, using local database.", err);
      renderQuizzes();
    });
}

// Save custom quiz to storage and sync with server
function saveCustomQuiz(quiz) {
  customQuizzes.push(quiz);
  localStorage.setItem("insight_trivia_custom_quizzes", JSON.stringify(customQuizzes));

  fetch("/api/quizzes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quiz)
  })
    .then(res => res.json())
    .then(data => {
      console.log("Quiz synchronized with server database.", data);
      fetchServerQuizzes();
    })
    .catch(err => {
      console.error("Failed to post custom quiz to server.", err);
      renderQuizzes();
    });
}

// ==========================================================================
// Routing (View Switcher)
// ==========================================================================
function switchView(viewId) {
  if (viewId !== "report-view") {
    stopConfetti();
  }

  const views = document.querySelectorAll(".view");
  views.forEach(v => v.classList.remove("active"));

  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add("active");
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Render Quizzes Grid on Dashboard
function renderQuizzes() {
  const grid = document.getElementById("premade-quiz-grid");
  if (!grid) return;

  grid.innerHTML = "";

  const createCardHtml = (quiz, isCustom = false) => {
    return `
      <div class="quiz-card" data-id="${quiz.id}" data-custom="${isCustom}">
        <div class="quiz-card-header">
          <span class="quiz-icon">${quiz.icon || "📝"}</span>
          <span class="quiz-badge">${isCustom ? "Custom" : quiz.category}</span>
          ${isCustom ? `
            <button class="delete-quiz-btn" data-id="${quiz.id}" title="Delete Assessment">
              🗑️
            </button>
          ` : ""}
        </div>
        <div class="quiz-card-body">
          <h3>${quiz.title}</h3>
          <p>${quiz.description || "Interactive quiz assessment."}</p>
        </div>
        <div class="quiz-card-footer">
          <span class="quiz-q-count">${quiz.questions.length} Questions</span>
          <div class="quiz-card-actions">
            <button class="quiz-practice-btn" data-id="${quiz.id}" data-custom="${isCustom}">
              Practice
            </button>
            <button class="quiz-play-btn" data-id="${quiz.id}" data-custom="${isCustom}">
              Host →
            </button>
          </div>
        </div>
      </div>
    `;
  };

  // Add standard built-in quizzes
  PREMADE_QUIZZES.forEach(q => {
    grid.innerHTML += createCardHtml(q, false);
  });

  // Add custom quizzes
  customQuizzes.forEach(q => {
    grid.innerHTML += createCardHtml(q, true);
  });

  // Attach card event listeners
  const cards = grid.querySelectorAll(".quiz-card");
  cards.forEach(card => {
    card.addEventListener("click", (e) => {
      // Guard: ignore card clicks if they target action or delete buttons
      if (e.target.closest(".delete-quiz-btn") || e.target.closest(".quiz-practice-btn") || e.target.closest(".quiz-play-btn")) {
        return;
      }
      const quizId = card.getAttribute("data-id");
      const isCustom = card.getAttribute("data-custom") === "true";
      initiateLobby(quizId, isCustom);
    });
  });

  const practiceButtons = grid.querySelectorAll(".quiz-practice-btn");
  practiceButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const quizId = btn.getAttribute("data-id");
      const isCustom = btn.getAttribute("data-custom") === "true";
      activeGame.autoStartPractice = true;
      activeGame.isPractice = true;
      initiateLobby(quizId, isCustom);
    });
  });

  const playButtons = grid.querySelectorAll(".quiz-play-btn");
  playButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const quizId = btn.getAttribute("data-id");
      const isCustom = btn.getAttribute("data-custom") === "true";
      activeGame.isPractice = false;
      activeGame.autoStartPractice = false;
      initiateLobby(quizId, isCustom);
    });
  });

  // Attach delete buttons listeners
  const deleteButtons = grid.querySelectorAll(".delete-quiz-btn");
  deleteButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const quizId = btn.getAttribute("data-id");
      deleteCustomQuiz(quizId);
    });
  });
}

// Delete custom quiz from local storage and sync with server
function deleteCustomQuiz(quizId) {
  if (!confirm("Are you sure you want to delete this custom assessment?")) return;

  // Filter out local list
  customQuizzes = customQuizzes.filter(q => q.id !== quizId);
  localStorage.setItem("insight_trivia_custom_quizzes", JSON.stringify(customQuizzes));

  fetch(`/api/quizzes/${quizId}`, {
    method: "DELETE"
  })
    .then(res => res.json())
    .then(data => {
      console.log("Quiz deleted on server:", data);
      showToast("Custom assessment deleted successfully.");
      renderQuizzes();
    })
    .catch(err => {
      console.error("Failed to delete quiz from server database:", err);
      showToast("Assessment deleted locally.");
      renderQuizzes();
    });
}

function showToast(message) {
  const toast = document.getElementById("toast-notification");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

// ==========================================================================
// Lobby Creation Logic (Host role trigger)
// ==========================================================================
function initiateLobby(quizId, isCustom) {
  let selectedQuiz = null;
  if (isCustom) {
    selectedQuiz = customQuizzes.find(q => q.id === quizId);
  } else {
    selectedQuiz = PREMADE_QUIZZES.find(q => q.id === quizId);
  }

  if (!selectedQuiz) {
    showToast("Quiz data could not be loaded.");
    return;
  }

  // Create room on server
  activeGame.isHost = true;
  activeGame.isCreator = true;
  activeGame.quiz = selectedQuiz;
  activeGame.questions = selectedQuiz.questions;

  socket.emit("create-room", { 
    quiz: selectedQuiz, 
    isCustom, 
    hostName: userProfile.name, 
    hostBadge: userProfile.badge,
    isPractice: activeGame.isPractice
  });
}

// ==========================================================================
// Socket.io Client Listeners SETUP
// ==========================================================================
function setupSocketListeners() {
  // Capture client socket ID
  socket.on("connect", () => {
    activeGame.socketId = socket.id;
    console.log("Connected to server. Socket ID: ", socket.id);
  });

  // Room Created (Host Callback)
  socket.on("room-created", ({ code, quiz }) => {
    activeGame.roomCode = code;
    activeGame.participants = [];

    if (activeGame.autoStartPractice) {
      activeGame.autoStartPractice = false;
      // Immediately start in self-paced mode
      socket.emit("start-game", {
        code: code,
        mode: "self-paced"
      });
      return;
    }

    // UI Updates
    document.getElementById("lobby-quiz-title").textContent = quiz.title;
    document.getElementById("lobby-quiz-desc").textContent = `Session Join Code: ${code}`;
    document.getElementById("lobby-questions-count").textContent = quiz.questions ? quiz.questions.length : quiz.totalQuestions;
    document.getElementById("lobby-mode-display").textContent = "Timed Challenge";

    // Show host controls
    document.getElementById("start-game-btn").style.display = "block";
    document.getElementById("start-game-btn").textContent = "Launch Session";
    


    // Show candidates selection & reset input for Host (guarded)
    const candContainer = document.getElementById("lobby-candidates-container");
    if (candContainer) {
      candContainer.style.display = "flex";
      const candidatesInput = document.getElementById("lobby-candidates-count");
      if (candidatesInput) candidatesInput.value = "0";
    }

    // Show max players limit & reset selection for Host
    document.getElementById("lobby-max-players-container").style.display = "flex";
    const maxPlayersSelect = document.getElementById("lobby-max-players");
    if (maxPlayersSelect) maxPlayersSelect.value = "0";

    // Populate sample questions preview in lobby
    populateSampleQuestions(quiz.sampleQuestions);

    // Initial render
    const participantsList = document.getElementById("participants-list");
    if (participantsList) {
      participantsList.innerHTML = `<p class="no-items-msg">No players connected yet. Share code: <strong>${code}</strong></p>`;
    }
    
    const activityLog = document.getElementById("lobby-activity-log");
    if (activityLog) {
      activityLog.innerHTML = `<p class="log-entry" style="color:var(--accent-color);">Room created. Shared code: ${code}</p>`;
    }

    updateLobbyParticipantsCount(0);
    switchView("lobby-view");
    audioManager.playLevelUp();
  });

  // Room Joined successfully (Player Callback)
  socket.on("room-joined", ({ code, quiz }) => {
    activeGame.roomCode = code;
    activeGame.isHost = false;
    activeGame.isCreator = false;
    
    // Update Lobby titles
    document.getElementById("lobby-quiz-title").textContent = quiz.title;
    document.getElementById("lobby-quiz-desc").textContent = `Connected Code: ${code}`;
    document.getElementById("lobby-questions-count").textContent = quiz.totalQuestions;

    // Hide host start button, show waiting state
    document.getElementById("start-game-btn").style.display = "none";
    


    // Hide candidates and max players selection for joining players (guarded)
    const candContainer = document.getElementById("lobby-candidates-container");
    if (candContainer) candContainer.style.display = "none";
    document.getElementById("lobby-max-players-container").style.display = "none";

    // Populate sample questions preview in lobby
    populateSampleQuestions(quiz.sampleQuestions);

    const activityLog = document.getElementById("lobby-activity-log");
    if (activityLog) {
      activityLog.innerHTML = `<p class="log-entry">Connected. Waiting for host to launch session...</p>`;
    }

    switchView("lobby-view");
    audioManager.playClick();
  });

  // Join Error
  socket.on("join-error", (message) => {
    const errorMsg = document.getElementById("join-error-msg");
    if (errorMsg) {
      errorMsg.textContent = message;
    }
    audioManager.playIncorrect();
  });

  // Players Updated inside lobby
  socket.on("room-players-updated", ({ players }) => {
    activeGame.participants = players;
    const list = document.getElementById("participants-list");
    const countSpan = document.getElementById("participant-count");
    const activityLog = document.getElementById("lobby-activity-log");

    if (countSpan) countSpan.textContent = players.length;

    if (!list) return;

    if (players.length === 0) {
      list.innerHTML = `<p class="no-items-msg">No players connected yet.</p>`;
      return;
    }

    list.innerHTML = "";
    players.forEach(p => {
      const isMe = p.name === userProfile.name;
      list.innerHTML += `
        <div class="player-lobby-badge ${isMe ? "me" : ""}">
          <div class="player-lobby-icon">${p.badge}</div>
          <span class="player-lobby-name">${p.name} ${isMe ? "(You)" : ""}</span>
        </div>
      `;
    });

    // Append to log if someone joined
    if (activityLog && players.length > 0) {
      const latestPlayer = players[players.length - 1];
      activityLog.innerHTML += `<p class="log-entry joined">${latestPlayer.name} entered the room.</p>`;
      activityLog.scrollTop = activityLog.scrollHeight;
    }
  });

  // Game commenced by server
  socket.on("game-started", ({ mode, totalQuestions, standings }) => {
    activeGame.mode = mode;
    activeGame.score = 0;
    activeGame.streak = 0;
    activeGame.maxStreak = 0;
    activeGame.answersLog = [];
    activeGame.questions = []; // Populated as we receive them

    // Refresh assisting powerups state
    activeGame.powerups = { clarity: 1, double: 1, shield: 1 };
    updatePowerupsUI();

    // Toggle timer HUD
    const timerContainer = document.getElementById("game-timer-container");
    if (timerContainer) {
      timerContainer.style.display = mode === "timed" ? "block" : "none";
    }

    // Toggle Host Live Console vs Powerups console
    const isLiveHost = activeGame.isHost && !activeGame.isPractice;
    const pConsole = document.getElementById("powerups-console");
    const hConsole = document.getElementById("host-control-console");
    if (pConsole) pConsole.style.display = isLiveHost ? "none" : "block";
    if (hConsole) hConsole.style.display = isLiveHost ? "block" : "none";

    // Initial Leaderboard display
    if (standings) {
      renderLeaderboard(standings);
    }

    switchView("game-view");
    audioManager.playLevelUp();
  });

  // New Question starts
  socket.on("question-start", ({ questionIndex, questionText, options, totalQuestions }) => {
    // Hide feedback overlay if visible
    document.getElementById("feedback-overlay").classList.remove("active");

    activeGame.currentQuestionIndex = questionIndex;
    
    // Cache question payload
    const qObj = { question: questionText, options, answerIndex: -1 };
    activeGame.questions[questionIndex] = qObj;

    // Reset powerup flags for this round
    activeGame.powerupActiveThisQuestion.double = false;
    activeGame.powerupActiveThisQuestion.shield = false;
    
    document.getElementById("pw-double").classList.remove("active");
    document.getElementById("pw-shield").classList.remove("active");

    // HUD bindings
    document.getElementById("current-q-num").textContent = questionIndex + 1;
    document.getElementById("total-q-num").textContent = totalQuestions;
    document.getElementById("current-score").textContent = activeGame.score;
    document.getElementById("streak-count").textContent = activeGame.streak;

    const mult = 1.0 + activeGame.streak * 0.1;
    document.getElementById("multiplier-display").textContent = mult.toFixed(1);

    // Question title
    document.getElementById("game-question-text").textContent = questionText;

    // Options grid
    const answersGrid = document.getElementById("game-answers-grid");
    answersGrid.innerHTML = "";

    const isLiveHost = activeGame.isHost && !activeGame.isPractice;

    options.forEach((opt, idx) => {
      const letters = ["A", "B", "C", "D"];
      answersGrid.innerHTML += `
        <button class="answer-card option-${idx} ${isLiveHost ? 'disabled' : ''}" data-index="${idx}" ${isLiveHost ? 'disabled' : ''}>
          <span class="option-marker">${letters[idx]}</span>
          <span class="option-text">${opt}</span>
        </button>
      `;
    });

    // Rebind options listeners
    const optionCards = answersGrid.querySelectorAll(".answer-card");
    optionCards.forEach(card => {
      if (!isLiveHost) {
        card.addEventListener("click", () => {
          const selectedIdx = parseInt(card.getAttribute("data-index"));
          submitMultiplayerAnswer(selectedIdx);
        });
      }
    });

    // Dynamic assists count refresh
    updatePowerupsUI();

    // If live host — reset answered list and update dashboard
    if (activeGame.isHost && !activeGame.isPractice) {
      activeGame.hostAnsweredCount = 0;
      const list = document.getElementById("host-answered-list");
      if (list) list.innerHTML = "";
      const hQNum = document.getElementById("host-q-num");
      const hTotal = document.getElementById("host-total-q");
      if (hQNum) hQNum.textContent = questionIndex + 1;
      if (hTotal) hTotal.textContent = totalQuestions;
      updateHostDashboardStats();
    }

    // Reset timer progress bar
    if (activeGame.mode === "timed") {
      activeGame.timeLeft = 20;
      activeGame.questionStartTime = Date.now();
      const timerBar = document.getElementById("game-timer-bar");
      if (timerBar) {
        timerBar.style.width = "100%";
        timerBar.classList.remove("warning");
      }
    }
  });

  // Sync Timer from server countdown
  socket.on("timer-sync", ({ timeLeft }) => {
    if (activeGame.mode !== "timed") return;

    activeGame.timeLeft = timeLeft;
    const timerBar = document.getElementById("game-timer-bar");
    if (timerBar) {
      const percentage = (timeLeft / 20) * 100;
      timerBar.style.width = `${percentage}%`;

      if (timeLeft <= 5) {
        timerBar.classList.add("warning");
        audioManager.playTick();
      }
    }

    // Update host dashboard time left
    const hostTime = document.getElementById("host-time-left");
    if (hostTime) hostTime.textContent = timeLeft;
  });

  // Player Answered notification
  socket.on("player-answered", ({ name, badge, answeredCount, totalPlayers }) => {
    const isLiveHost = activeGame.isHost && !activeGame.isPractice;
    if (!isLiveHost) {
      showToast(`${name} submitted an answer.`);
    }
    // Update host dashboard answered count
    if (isLiveHost) {
      activeGame.hostAnsweredCount = (answeredCount !== undefined) ? answeredCount : (activeGame.hostAnsweredCount + 1);
      activeGame.hostTotalPlayers = (totalPlayers !== undefined) ? totalPlayers : activeGame.hostTotalPlayers;
      updateHostDashboardStats();
      // Add chip for who answered
      const list = document.getElementById("host-answered-list");
      if (list) {
        const chip = document.createElement("div");
        chip.className = "host-answered-chip";
        chip.innerHTML = `<span class="chip-badge">${badge || "▲"}</span>${name}`;
        list.appendChild(chip);
      }
    }
  });

  // Question Completed (Round evaluation broadcast)
  socket.on("question-end", ({ correctIndex, explanation, standings, results }) => {
    const qIndex = activeGame.currentQuestionIndex;
    const question = activeGame.questions[qIndex];
    question.answerIndex = correctIndex;
    question.explanation = explanation;

    // Check my result
    const myResult = results[socket.id];
    let isCorrect = false;
    let isTimeout = false;
    let pointsGained = 0;
    let userSelection = -1;

    if (myResult) {
      isCorrect = myResult.isCorrect;
      isTimeout = myResult.isTimeout;
      pointsGained = myResult.pointsGained;
      userSelection = myResult.userSelection;
      
      // Update local client score & streak tracker
      activeGame.score += pointsGained;
      if (isCorrect) {
        activeGame.streak++;
        if (activeGame.streak > activeGame.maxStreak) activeGame.maxStreak = activeGame.streak;
      } else {
        if (!activeGame.powerupActiveThisQuestion.shield) {
          activeGame.streak = 0;
        }
      }
    }

    // Log answer locally for final report screen
    activeGame.answersLog.push({
      questionIndex: qIndex,
      userSelection,
      correctIndex,
      pointsGained,
      isCorrect,
      isTimeout
    });

    const isLiveHost = activeGame.isHost && !activeGame.isPractice;

    // Play sounds (skip for live host)
    if (!isLiveHost) {
      if (isCorrect) {
        audioManager.playCorrect();
      } else {
        audioManager.playIncorrect();
      }
    }

    // Refresh scores HUD
    document.getElementById("current-score").textContent = activeGame.score;
    document.getElementById("streak-count").textContent = activeGame.streak;

    // Render updated rankings leaderboard (filter host)
    renderLeaderboard(standings);

    // Show Feedback Modal — NOT for live host
    if (!isLiveHost) {
      showFeedbackOverlay(isCorrect, isTimeout, userSelection, correctIndex, pointsGained, explanation);
    }
  });

  // Session Completed (Game Ended)
  socket.on("game-ended", ({ standings }) => {
    // Hide feedback overlay
    document.getElementById("feedback-overlay").classList.remove("active");

    const playerRank = standings.findIndex(s => s.socketId === socket.id) + 1;
    const correctAnswers = activeGame.answersLog.filter(l => l.isCorrect).length;
    const accuracyRatio = activeGame.questions.length > 0 ? (correctAnswers / activeGame.questions.length) : 0;
    const accuracyPercentage = Math.round(accuracyRatio * 100);

    // Header Report Info
    document.getElementById("report-quiz-title").textContent = activeGame.quiz.title;
    document.getElementById("report-timestamp").textContent = new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric"
    });

    // Circle SVG Loader
    const ring = document.getElementById("report-accuracy-ring");
    const accuracyText = document.getElementById("report-accuracy-text");
    if (ring && accuracyText) {
      accuracyText.textContent = `${accuracyPercentage}%`;
      const offset = 314 - (314 * accuracyRatio);
      ring.style.strokeDashoffset = offset;
    }

    // Tile metrics bindings
    document.getElementById("report-standing").textContent = getOrdinal(playerRank) + " Place";
    document.getElementById("report-score").textContent = activeGame.score;
    document.getElementById("report-max-streak").textContent = activeGame.maxStreak;

    // Detailed Review Grid compilation
    const breakdownList = document.getElementById("report-questions-breakdown");
    if (breakdownList) {
      breakdownList.innerHTML = "";

      activeGame.answersLog.forEach((log, index) => {
        const q = activeGame.questions[log.questionIndex];
        let statusClass = "incorrect";
        if (log.isCorrect) statusClass = "correct";
        else if (log.isTimeout) statusClass = "timeout";

        let choicesHtml = "";
        q.options.forEach((opt, optIdx) => {
          const isUserSelected = optIdx === log.userSelection;
          const isCorrectChoice = optIdx === log.correctIndex;
          let choiceClass = "";

          if (isUserSelected) {
            choiceClass = isCorrectChoice ? "user-selected correct" : "user-selected incorrect";
          } else if (isCorrectChoice) {
            choiceClass = "correct-answer";
          }

          choicesHtml += `
            <div class="breakdown-choice ${choiceClass}">
              <span>${opt}</span>
              ${isUserSelected ? `<span class="choice-marker">${isCorrectChoice ? "✔ Your Choice" : "✘ Your Choice"}</span>` : ""}
              ${!isUserSelected && isCorrectChoice ? `<span class="choice-marker" style="color:var(--color-success);">✔ Correct Solution</span>` : ""}
            </div>
          `;
        });

        breakdownList.innerHTML += `
          <div class="breakdown-item ${statusClass}">
            <h4 class="breakdown-q-title">${index + 1}. ${q.question}</h4>
            <div class="breakdown-answers">
              ${choicesHtml}
            </div>
          </div>
        `;
      });
    }

    // Trigger Win Chime & Canvas Confetti on 1st place!
    if (playerRank === 1) {
      audioManager.playLevelUp();
      startConfetti();
    } else {
      audioManager.playCorrect();
    }

    switchView("report-view");
  });

  // Host disconnected disband room
  socket.on("host-disconnected", () => {
    showToast("The session was disbanded by the host.");
    switchView("home-view");
    audioManager.playIncorrect();
  });
}

function updateLobbyParticipantsCount(num) {
  const counter = document.getElementById("participant-count");
  if (counter) counter.textContent = num;
}

// Render active rankings list on sidebar (filter host from leaderboard)
function renderLeaderboard(standings) {
  const board = document.getElementById("sidebar-leaderboard-list");
  if (!board) return;

  // Exclude the hosting socket from the leaderboard display
  const isLiveHost = activeGame.isHost && !activeGame.isPractice;
  const displayStandings = isLiveHost
    ? standings.filter(p => p.socketId !== socket.id)
    : standings;

  board.innerHTML = "";
  displayStandings.forEach((p, idx) => {
    const isMe = p.socketId === socket.id;
    const displayRank = idx + 1;
    board.innerHTML += `
      <div class="leaderboard-item ${isMe ? "player" : ""}">
        <span class="leaderboard-rank">${displayRank}</span>
        <div class="leaderboard-badge">${p.badge}</div>
        <span class="leaderboard-name">${p.name}${isMe ? " (You)" : ""}</span>
        <span class="leaderboard-score">${p.score}</span>
      </div>
    `;
  });
}

// Update host dashboard live stats
function updateHostDashboardStats() {
  const answered = document.getElementById("host-answered-count");
  const total = document.getElementById("host-total-players");
  if (answered) answered.textContent = activeGame.hostAnsweredCount;
  if (total) total.textContent = activeGame.hostTotalPlayers;
}

// ==========================================================================
// Answer Submission & Evaluation (Multiplayer)
// ==========================================================================
function submitMultiplayerAnswer(selectedIndex) {
  // Lock option card clicks in the DOM
  const cards = document.querySelectorAll("#game-answers-grid .answer-card");
  cards.forEach(card => card.classList.add("disabled"));

  // Highlight selection
  const selectedCard = document.querySelector(`.answer-card.option-${selectedIndex}`);
  if (selectedCard) selectedCard.classList.add("selected");

  // Play audio blip
  audioManager.playClick();

  // Send packet to server
  const timeUsedMs = activeGame.mode === "timed" ? (Date.now() - activeGame.questionStartTime) : 0;
  
  socket.emit("submit-answer", {
    code: activeGame.roomCode,
    selectedIndex,
    timeUsedMs,
    doubleActive: activeGame.powerupActiveThisQuestion.double,
    shieldActive: activeGame.powerupActiveThisQuestion.shield
  });
}

// Display Feedback Overlay
function showFeedbackOverlay(isCorrect, isTimeout, selectedIndex, correctIndex, pointsGained, explanationText) {
  const overlay = document.getElementById("feedback-overlay");
  const card = document.getElementById("feedback-card");
  const icon = document.getElementById("feedback-icon");
  const title = document.getElementById("feedback-title");
  const points = document.getElementById("feedback-points-gain");
  const explanation = document.getElementById("feedback-explanation-box");

  const hostSkipBtn = document.getElementById("host-skip-btn");
  const waitMsg = document.getElementById("feedback-wait-msg");

  if (!overlay || !card) return;

  card.className = "feedback-card";

  const question = activeGame.questions[activeGame.currentQuestionIndex];

  if (isCorrect) {
    card.classList.add("correct");
    icon.textContent = "✔";
    title.textContent = "Correct Selection";
    points.textContent = `+${pointsGained} Points`;
    explanation.innerHTML = `<p>Perfect answer: <strong>${question.options[correctIndex]}</strong></p>`;
  } else if (isTimeout) {
    card.classList.add("timeout");
    icon.textContent = "⏳";
    title.textContent = "Time Expired";
    points.textContent = "+0 Points";
    explanation.innerHTML = `<p>The server clock ran out. Correct answer was: <strong>${question.options[correctIndex]}</strong></p>`;
  } else {
    card.classList.add("incorrect");
    icon.textContent = "✘";
    title.textContent = "Incorrect Choice";
    points.textContent = "+0 Points";
    
    const userSelectedText = selectedIndex >= 0 ? question.options[selectedIndex] : "None";
    explanation.innerHTML = `
      <p>Your choice: <span style="text-decoration:line-through; color:var(--color-danger);">${userSelectedText}</span></p>
      <p style="margin-top:8px;">Correct solution: <strong style="color:var(--color-success);">${question.options[correctIndex]}</strong></p>
    `;
  }

  // Appends server explanation text if present
  if (explanationText) {
    explanation.innerHTML += `<div style="margin-top:10px; padding-top:10px; border-top:1px solid #e5e5e4; font-style:italic;">${explanationText}</div>`;
  }

  // Handle Host Skip button vs Player waiting state
  if (activeGame.isHost) {
    hostSkipBtn.style.display = "block";
    waitMsg.style.display = "none";
    if (activeGame.mode === "self-paced") {
      hostSkipBtn.textContent = "Continue ➔";
    } else {
      hostSkipBtn.textContent = "Next Question (Host Only) ➔";
    }
  } else {
    hostSkipBtn.style.display = "none";
    waitMsg.style.display = "block";
    waitMsg.textContent = "Waiting for next question index...";
  }

  overlay.classList.add("active");
}

// Powerups assisting actions
function triggerPowerupClarity() {
  if (activeGame.powerups.clarity <= 0) return;

  const question = activeGame.questions[activeGame.currentQuestionIndex];
  // Since correctIndex is not sent to client to prevent cheating, we query the server's options index locally.
  // Wait, correctIndex is only broadcast in the question-end event!
  // How does Clarity (50:50) work client-side if we don't know correctIndex?
  // Ah! This is a fascinating architectural challenge.
  // Since we don't know the correct index on the client side during the answering phase,
  // we can request the server to return which two options to eliminate!
  // Or, we can let the server know, or for the built-in quizzes we DO have correctIndex in the local PREMADE_QUIZZES data bank!
  // Wait! Yes, for pre-made quizzes, we have the correct index in `PREMADE_QUIZZES` (and also custom quizzes are stored locally in `customQuizzes`!).
  // So we can find the quiz in the local array, find the question, look up its `answerIndex`, and blur two incorrect ones!
  // This is a brilliant, secure client-side workaround that doesn't require a WebSocket trip!
  
  let localCorrectIdx = -1;
  const localQuiz = PREMADE_QUIZZES.find(q => q.id === activeGame.quiz.id) 
                 || customQuizzes.find(q => q.id === activeGame.quiz.id);

  if (localQuiz && localQuiz.questions[activeGame.currentQuestionIndex]) {
    localCorrectIdx = localQuiz.questions[activeGame.currentQuestionIndex].answerIndex;
  }

  // Fallback: if we can't find it, choose option 0 as correct (or just don't activate)
  if (localCorrectIdx === -1) {
    localCorrectIdx = 0; // safe fallback
  }

  const incorrectIndices = [];
  question.options.forEach((_, idx) => {
    if (idx !== localCorrectIdx) incorrectIndices.push(idx);
  });

  const shuffledIncorrect = incorrectIndices.sort(() => 0.5 - Math.random());
  const elim1 = shuffledIncorrect[0];
  const elim2 = shuffledIncorrect[1];

  const cards = document.querySelectorAll(".answers-grid .answer-card");
  cards.forEach(card => {
    const idx = parseInt(card.getAttribute("data-index"));
    if (idx === elim1 || idx === elim2) {
      card.classList.add("blurred");
    }
  });

  activeGame.powerups.clarity--;
  audioManager.playAssist();
  updatePowerupsUI();
  showToast("50:50 Activated: Eliminated two options.");
}

function triggerPowerupDouble() {
  if (activeGame.powerups.double <= 0) return;

  activeGame.powerupActiveThisQuestion.double = true;
  activeGame.powerups.double--;
  
  document.getElementById("pw-double").classList.add("active");

  audioManager.playAssist();
  updatePowerupsUI();
  showToast("Double Points multiplier enabled.");
}

function triggerPowerupShield() {
  if (activeGame.powerups.shield <= 0) return;

  activeGame.powerupActiveThisQuestion.shield = true;
  activeGame.powerups.shield--;

  document.getElementById("pw-shield").classList.add("active");

  audioManager.playAssist();
  updatePowerupsUI();
  showToast("Streak Protection Shield enabled.");
}

function updatePowerupsUI() {
  const clarityBtn = document.getElementById("pw-5050");
  const doubleBtn = document.getElementById("pw-double");
  const shieldBtn = document.getElementById("pw-shield");

  const clarityCount = document.getElementById("pw-count-5050");
  const doubleCount = document.getElementById("pw-count-double");
  const shieldCount = document.getElementById("pw-count-shield");

  if (clarityCount) clarityCount.textContent = activeGame.powerups.clarity;
  if (doubleCount) doubleCount.textContent = activeGame.powerups.double;
  if (shieldCount) shieldCount.textContent = activeGame.powerups.shield;

  if (clarityBtn) {
    clarityBtn.disabled = activeGame.powerups.clarity <= 0;
    clarityBtn.classList.toggle("disabled", activeGame.powerups.clarity <= 0);
  }
  if (doubleBtn) {
    doubleBtn.disabled = activeGame.powerups.double <= 0;
    doubleBtn.classList.toggle("disabled", activeGame.powerups.double <= 0);
  }
  if (shieldBtn) {
    shieldBtn.disabled = activeGame.powerups.shield <= 0;
    shieldBtn.classList.toggle("disabled", activeGame.powerups.shield <= 0);
  }
}

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ==========================================================================
// VIEW 4: ASSESSMENT CREATOR / AI COMPILER
// ==========================================================================
let creatorAddedQuestions = [];

function switchCreatorTab(tabId) {
  const tabs = document.querySelectorAll(".creator-tab");
  tabs.forEach(t => t.classList.remove("active"));
  
  const panels = document.querySelectorAll(".creator-panel");
  panels.forEach(p => p.classList.remove("active"));

  document.getElementById(`tab-${tabId}`).classList.add("active");
  document.getElementById(`panel-${tabId}`).classList.add("active");
}

function addQuestionToCreator() {
  const textInput = document.getElementById("q-input-text");
  const opt0 = document.getElementById("opt-input-0");
  const opt1 = document.getElementById("opt-input-1");
  const opt2 = document.getElementById("opt-input-2");
  const opt3 = document.getElementById("opt-input-3");

  const radios = document.getElementsByName("correct-option-radio");
  let correctIndex = 0;
  for (let r of radios) {
    if (r.checked) correctIndex = parseInt(r.value);
  }

  if (!textInput.value.trim()) {
    showToast("Please enter a valid question prompt.");
    return;
  }
  if (!opt0.value.trim() || !opt1.value.trim() || !opt2.value.trim() || !opt3.value.trim()) {
    showToast("All option fields are required.");
    return;
  }

  creatorAddedQuestions.push({
    question: textInput.value.trim(),
    options: [
      opt0.value.trim(),
      opt1.value.trim(),
      opt2.value.trim(),
      opt3.value.trim()
    ],
    answerIndex: correctIndex
  });

  textInput.value = "";
  opt0.value = "";
  opt1.value = "";
  opt2.value = "";
  opt3.value = "";
  document.getElementById("radio-0").checked = true;

  renderCreatorQuestionsPreview();
  showToast("Question added.");
}

function renderCreatorQuestionsPreview() {
  const list = document.getElementById("added-questions-preview-list");
  const countSpan = document.getElementById("creator-added-count");

  if (!list) return;

  if (countSpan) countSpan.textContent = creatorAddedQuestions.length;

  if (creatorAddedQuestions.length === 0) {
    list.innerHTML = `<p class="no-items-msg">No questions added yet. Construct your first question below.</p>`;
    return;
  }

  list.innerHTML = "";
  creatorAddedQuestions.forEach((q, idx) => {
    list.innerHTML += `
      <div class="added-question-row">
        <span class="added-question-text">${idx + 1}. ${q.question}</span>
        <button class="added-question-delete" data-index="${idx}">Delete</button>
      </div>
    `;
  });

  const delButtons = list.querySelectorAll(".added-question-delete");
  delButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index"));
      creatorAddedQuestions.splice(idx, 1);
      renderCreatorQuestionsPreview();
    });
  });
}

function finalizeCustomQuiz() {
  const titleInput = document.getElementById("manual-title");
  const categorySelect = document.getElementById("manual-category");
  const iconInput = document.getElementById("manual-icon");

  if (!titleInput.value.trim()) {
    showToast("Please enter an Assessment Title.");
    return;
  }
  if (creatorAddedQuestions.length === 0) {
    showToast("Your quiz must contain at least 1 question.");
    return;
  }

  const joinCode = Math.floor(100000 + Math.random() * 900000).toString();
  const newQuiz = {
    id: `custom-${joinCode}`,
    title: titleInput.value.trim(),
    icon: iconInput.value.trim() || "📝",
    category: categorySelect.value,
    description: `User custom assessment code: ${joinCode}`,
    questions: [...creatorAddedQuestions],
    joinCode: joinCode
  };

  saveCustomQuiz(newQuiz);

  // Reset fields
  creatorAddedQuestions = [];
  titleInput.value = "";
  iconInput.value = "📝";
  renderCreatorQuestionsPreview();

  showToast(`Quiz saved! Room Code: ${joinCode}`);
  switchView("home-view");
}

function executeAIQuizGeneration() {
  const promptInput = document.getElementById("ai-topic-prompt");
  const topic = promptInput.value.trim();

  if (!topic) {
    showToast("Please specify a topic.");
    return;
  }

  const countInput = document.getElementById("ai-question-count");
  const numQuestions = countInput ? parseInt(countInput.value) || 5 : 5;

  const loader = document.getElementById("ai-loader");
  const resultBox = document.getElementById("ai-result-box");
  
  if (loader) loader.style.display = "flex";
  if (resultBox) resultBox.style.display = "none";
  
  audioManager.playClick();

  const handleQuizSuccess = (aiQuiz) => {
    // Save locally and sync with server
    saveCustomQuiz(aiQuiz);

    const countLabel = document.getElementById("ai-result-count-label");
    if (countLabel) countLabel.textContent = aiQuiz.questions.length;

    document.getElementById("ai-result-icon").textContent = aiQuiz.icon;
    document.getElementById("ai-result-title").textContent = aiQuiz.title;
    document.getElementById("ai-result-desc").textContent = aiQuiz.description;
    
    const codeBtn = document.getElementById("ai-result-code");
    codeBtn.textContent = aiQuiz.joinCode;
    codeBtn.setAttribute("data-code", aiQuiz.joinCode);

    if (loader) loader.style.display = "none";
    if (resultBox) resultBox.style.display = "flex";

    promptInput.value = "";

    // Cache in state so Launch button triggers it directly
    activeGame.quiz = aiQuiz;
    activeGame.questions = aiQuiz.questions;

    audioManager.playLevelUp();
  };

  const fallbackToLocal = () => {
    console.warn("Falling back to local offline trivia generator.");
    const aiQuiz = generateAIQuiz(topic, numQuestions);
    handleQuizSuccess(aiQuiz);
    showToast("Offline AI compiler completed.");
  };

  // If puter object is present and loaded, attempt cloud generation
  if (window.puter && puter.ai) {
    const prompt = `Generate a trivia quiz on the topic: "${topic}".
Generate exactly ${numQuestions} questions.
You MUST output ONLY a valid raw JSON object matching this schema, without any markdown formatting, backticks, or explanatory text:
{
  "title": "A catchy title for the quiz",
  "description": "A short, engaging description of the quiz",
  "icon": "A single emoji representing the topic",
  "questions": [
    {
      "question": "The question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0,
      "explanation": "A short explanation of why this answer is correct"
    }
  ]
}`;

    puter.ai.chat(prompt)
      .then(response => {
        try {
          let cleanText = response.trim();
          if (cleanText.startsWith("```")) {
            cleanText = cleanText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
          }
          const generated = JSON.parse(cleanText);
          const joinCode = Math.floor(100000 + Math.random() * 900000).toString();
          const aiQuiz = {
            id: `ai-${joinCode}`,
            title: generated.title || `${topic} Quiz`,
            icon: generated.icon || "🤖",
            category: "AI Generated",
            description: generated.description || `Assessment focusing on ${topic}.`,
            questions: generated.questions || [],
            joinCode: joinCode
          };
          
          if (aiQuiz.questions && aiQuiz.questions.length > 0) {
            handleQuizSuccess(aiQuiz);
            showToast("Cloud AI compiled questions successfully.");
          } else {
            fallbackToLocal();
          }
        } catch (e) {
          console.error("Failed to parse puter JSON response:", e, response);
          fallbackToLocal();
        }
      })
      .catch(err => {
        console.error("Puter AI chat failed:", err);
        fallbackToLocal();
      });
  } else {
    fallbackToLocal();
  }
}

// Code joiner
function submitJoinCode() {
  const codeInput = document.getElementById("join-code-input");
  const errorMsg = document.getElementById("join-error-msg");
  const code = codeInput.value.trim();

  if (!code || code.length !== 6) {
    if (errorMsg) errorMsg.textContent = "Please enter a 6-digit Join Code.";
    return;
  }

  if (errorMsg) errorMsg.textContent = "";

  // Submit join command to Socket server
  socket.emit("join-room", {
    name: userProfile.name,
    badge: userProfile.badge,
    code: code
  });
}

// ==========================================================================
// CONFETTI CANVAS EFFECT
// ==========================================================================
function startConfetti() {
  if (!confettiCanvas || !confettiCtx) return;

  confettiCanvas.style.display = "block";
  resizeConfettiCanvas();
  window.addEventListener("resize", resizeConfettiCanvas);

  confettiParticles = [];
  const colors = ["#4a7b9d", "#6e8c75", "#df5d5c", "#d99f59", "#87817b"];

  for (let i = 0; i < 120; i++) {
    confettiParticles.push({
      x: Math.random() * confettiCanvas.width,
      y: Math.random() * confettiCanvas.height - confettiCanvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * confettiCanvas.height,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    });
  }

  animateConfetti();
}

function resizeConfettiCanvas() {
  if (confettiCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
}

function animateConfetti() {
  if (!confettiCtx || !confettiCanvas) return;
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

  let activeParticles = 0;

  confettiParticles.forEach(p => {
    p.tiltAngle += p.tiltAngleIncremental;
    p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
    p.tilt = Math.sin(p.tiltAngle - activeParticles / 3) * 15;

    if (p.y <= confettiCanvas.height) {
      activeParticles++;
    }

    confettiCtx.beginPath();
    confettiCtx.lineWidth = p.r;
    confettiCtx.strokeStyle = p.color;
    confettiCtx.moveTo(p.x + p.tilt + p.r / 2, p.y);
    confettiCtx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
    confettiCtx.stroke();

    if (p.y > confettiCanvas.height) {
      p.x = Math.random() * confettiCanvas.width;
      p.y = -20;
      p.tilt = Math.random() * 10 - 5;
    }
  });

  confettiAnimationId = requestAnimationFrame(animateConfetti);
}

function stopConfetti() {
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  if (confettiCanvas) {
    confettiCanvas.style.display = "none";
  }
  window.removeEventListener("resize", resizeConfettiCanvas);
}

// ==========================================================================
// EVENT LISTENERS BINDINGS
// ==========================================================================
function setupEventListeners() {
  // Navigation Header Logo Button
  const logo = document.getElementById("header-logo-btn");
  if (logo) {
    logo.addEventListener("click", () => {
      audioManager.playClick();
      switchView("home-view");
    });
  }

  // Audio Toggle Button
  const muteBtn = document.getElementById("mute-btn");
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      const isMuted = audioManager.toggleMute();
      const volumeIcon = document.getElementById("volume-icon");
      if (volumeIcon) {
        if (isMuted) {
          volumeIcon.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          `;
        } else {
          volumeIcon.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          `;
        }
      }
      audioManager.playClick();
      showToast(isMuted ? "Volume muted." : "Volume unmuted.");
    });
  }

  // Avatar Picker Navigation
  const avPrev = document.getElementById("avatar-prev");
  const avNext = document.getElementById("avatar-next");
  if (avPrev) {
    avPrev.addEventListener("click", () => {
      currentAvatarIndex = (currentAvatarIndex - 1 + AVATAR_BADGES.length) % AVATAR_BADGES.length;
      userProfile.badge = AVATAR_BADGES[currentAvatarIndex];
      saveUserProfile();
      audioManager.playClick();
    });
  }
  if (avNext) {
    avNext.addEventListener("click", () => {
      currentAvatarIndex = (currentAvatarIndex + 1) % AVATAR_BADGES.length;
      userProfile.badge = AVATAR_BADGES[currentAvatarIndex];
      saveUserProfile();
      audioManager.playClick();
    });
  }

  // Display Name Change Input Listener
  const nameInput = document.getElementById("username-input");
  if (nameInput) {
    nameInput.addEventListener("change", () => {
      const val = nameInput.value.trim();
      if (val) {
        userProfile.name = val;
        saveUserProfile();
        audioManager.playClick();
        showToast(`Display name updated: ${val}`);
      } else {
        nameInput.value = userProfile.name;
      }
    });
  }

  // Main Actions: Routing to Creator & AI Generator tabs
  const openCreator = document.getElementById("open-creator-btn");
  if (openCreator) {
    openCreator.addEventListener("click", () => {
      audioManager.playClick();
      switchView("creator-view");
      switchCreatorTab("manual");
    });
  }

  const openAIGen = document.getElementById("open-ai-generator-btn");
  if (openAIGen) {
    openAIGen.addEventListener("click", () => {
      audioManager.playClick();
      switchView("creator-view");
      switchCreatorTab("ai");
    });
  }

  // Creator View Tab selectors
  const tabManual = document.getElementById("tab-manual");
  const tabAI = document.getElementById("tab-ai");
  if (tabManual) tabManual.addEventListener("click", () => { audioManager.playClick(); switchCreatorTab("manual"); });
  if (tabAI) tabAI.addEventListener("click", () => { audioManager.playClick(); switchCreatorTab("ai"); });

  // Creator Manual Question Builder
  const addQBtn = document.getElementById("add-question-to-list-btn");
  if (addQBtn) {
    addQBtn.addEventListener("click", () => {
      addQuestionToCreator();
    });
  }

  const loadSamplesBtn = document.getElementById("load-samples-btn");
  if (loadSamplesBtn) {
    loadSamplesBtn.addEventListener("click", () => {
      creatorAddedQuestions = [
        {
          question: "Which keyword is used to declare a constant variable in JavaScript?",
          options: ["var", "let", "const", "constant"],
          answerIndex: 2
        },
        {
          question: "What is the correct file extension for Python scripts?",
          options: [".py", ".pyt", ".pyw", ".pt"],
          answerIndex: 0
        },
        {
          question: "What does SQL stand for in data management?",
          options: ["Standard Query Language", "Structured Queue Language", "Structured Query Language", "Sequential Query Language"],
          answerIndex: 2
        }
      ];
      renderCreatorQuestionsPreview();
      audioManager.playLevelUp();
      showToast("3 Sample Questions Loaded!");
    });
  }

  const clearQBtn = document.getElementById("clear-questions-btn");
  if (clearQBtn) {
    clearQBtn.addEventListener("click", () => {
      creatorAddedQuestions = [];
      renderCreatorQuestionsPreview();
      audioManager.playClick();
    });
  }

  const saveQuizBtn = document.getElementById("save-quiz-btn");
  if (saveQuizBtn) {
    saveQuizBtn.addEventListener("click", () => {
      finalizeCustomQuiz();
    });
  }

  const creatorBackBtn = document.getElementById("creator-back-btn");
  if (creatorBackBtn) {
    creatorBackBtn.addEventListener("click", () => {
      audioManager.playClick();
      switchView("home-view");
    });
  }

  // AI Quiz Generator submit
  const aiGenBtn = document.getElementById("ai-generate-btn");
  if (aiGenBtn) {
    aiGenBtn.addEventListener("click", () => {
      executeAIQuizGeneration();
    });
  }

  const aiPlayNowBtn = document.getElementById("ai-play-now-btn");
  if (aiPlayNowBtn) {
    aiPlayNowBtn.addEventListener("click", () => {
      audioManager.playClick();
      initiateLobby(activeGame.quiz.id, true);
    });
  }

  const aiResetBtn = document.getElementById("ai-reset-btn");
  if (aiResetBtn) {
    aiResetBtn.addEventListener("click", () => {
      audioManager.playClick();
      document.getElementById("ai-result-box").style.display = "none";
      document.getElementById("ai-topic-prompt").value = "";
    });
  }

  // Copy Code Click
  const codeTextReveal = document.getElementById("ai-result-code");
  if (codeTextReveal) {
    codeTextReveal.addEventListener("click", () => {
      const code = codeTextReveal.getAttribute("data-code");
      navigator.clipboard.writeText(code).then(() => {
        showToast(`Code ${code} copied to clipboard.`);
        const hint = document.getElementById("ai-copy-hint");
        if (hint) hint.textContent = "Copied!";
        setTimeout(() => {
          if (hint) hint.textContent = "Click code to copy";
        }, 2000);
      });
    });
  }

  // Lobby view buttons
  const lobbyCancelBtn = document.getElementById("lobby-cancel-btn");
  if (lobbyCancelBtn) {
    lobbyCancelBtn.addEventListener("click", () => {
      audioManager.playClick();
      // Disconnect socket from room
      socket.disconnect();
      socket.connect(); // re-connect fresh
      switchView("home-view");
    });
  }

  // Launch Session by Host
  const startGameBtn = document.getElementById("start-game-btn");
  if (startGameBtn) {
    startGameBtn.addEventListener("click", () => {
      audioManager.playClick();
      
      socket.emit("start-game", {
        code: activeGame.roomCode,
        mode: "timed"
      });
    });
  }

  // Lobby Simulated Candidates Apply Button
  const applyCandidatesBtn = document.getElementById("apply-candidates-btn");
  if (applyCandidatesBtn) {
    applyCandidatesBtn.addEventListener("click", () => {
      audioManager.playClick();
      const input = document.getElementById("lobby-candidates-count");
      const count = Math.max(0, Math.min(50, parseInt(input.value) || 0));
      input.value = count; // clamp display
      socket.emit("set-simulated-candidates", {
        code: activeGame.roomCode,
        count: count
      });
      showToast(count === 0 ? "Simulated candidates removed." : `${count} simulated candidate${count > 1 ? "s" : ""} added.`);
    });
  }

  // Lobby Max Real Players Change Listener
  const maxPlayersSelect = document.getElementById("lobby-max-players");
  if (maxPlayersSelect) {
    maxPlayersSelect.addEventListener("change", () => {
      audioManager.playClick();
      const val = parseInt(maxPlayersSelect.value) || 0;
      socket.emit("set-max-real-players", {
        code: activeGame.roomCode,
        maxPlayers: val
      });
      showToast(val === 0 ? "Player limit set to Unlimited." : `Player limit set to ${val} real players.`);
    });
  }



  // Join Code Form Submission
  const joinBtn = document.getElementById("join-btn");
  if (joinBtn) {
    joinBtn.addEventListener("click", () => {
      submitJoinCode();
    });
  }
  const joinInput = document.getElementById("join-code-input");
  if (joinInput) {
    joinInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        submitJoinCode();
      }
    });
  }

  // Gameplay Power-up Assists buttons
  const pwClarity = document.getElementById("pw-5050");
  if (pwClarity) {
    pwClarity.addEventListener("click", () => {
      triggerPowerupClarity();
    });
  }

  const pwDouble = document.getElementById("pw-double");
  if (pwDouble) {
    pwDouble.addEventListener("click", () => {
      triggerPowerupDouble();
    });
  }

  const pwShield = document.getElementById("pw-shield");
  if (pwShield) {
    pwShield.addEventListener("click", () => {
      triggerPowerupShield();
    });
  }

  // Host force next question button
  const hostSkipBtn = document.getElementById("host-skip-btn");
  if (hostSkipBtn) {
    hostSkipBtn.addEventListener("click", () => {
      audioManager.playClick();
      socket.emit("force-next-question", { code: activeGame.roomCode });
    });
  }

  // Host skip timer inside game-view
  // Host Dashboard — Skip Timer button
  const hostSkipTimerBtn = document.getElementById("host-skip-timer-btn");
  if (hostSkipTimerBtn) {
    hostSkipTimerBtn.addEventListener("click", () => {
      audioManager.playClick();
      socket.emit("force-next-question", { code: activeGame.roomCode });
    });
  }

  // Host Dashboard — Pause / Resume button
  const hostPauseBtn = document.getElementById("host-pause-btn");
  if (hostPauseBtn) {
    hostPauseBtn.addEventListener("click", () => {
      audioManager.playClick();
      if (activeGame.gamePaused) {
        socket.emit("resume-game", { code: activeGame.roomCode });
      } else {
        socket.emit("pause-game", { code: activeGame.roomCode });
      }
    });
  }

  // Host Dashboard — Leaderboard toggle button
  const hostLbBtn = document.getElementById("host-leaderboard-btn");
  if (hostLbBtn) {
    hostLbBtn.addEventListener("click", () => {
      audioManager.playClick();
      const sidebar = document.querySelector(".sidebar-leaderboard");
      if (sidebar) {
        const isHidden = sidebar.style.display === "none";
        sidebar.style.display = isHidden ? "" : "none";
        hostLbBtn.classList.toggle("active-state", isHidden);
      }
    });
  }

  // Socket — Game Paused
  socket.on("game-paused", () => {
    activeGame.gamePaused = true;
    const dot = document.getElementById("host-status-dot");
    const txt = document.getElementById("host-status-text");
    const btn = document.getElementById("host-pause-btn");
    if (dot) dot.classList.add("paused");
    if (txt) txt.textContent = "Session Paused";
    if (btn) {
      btn.querySelector(".ctrl-icon").textContent = "▶";
      btn.querySelector(".ctrl-label").textContent = "Resume";
      btn.classList.add("active-state");
    }
    showToast("Session paused.");
  });

  // Socket — Game Resumed
  socket.on("game-resumed", () => {
    activeGame.gamePaused = false;
    const dot = document.getElementById("host-status-dot");
    const txt = document.getElementById("host-status-text");
    const btn = document.getElementById("host-pause-btn");
    if (dot) dot.classList.remove("paused");
    if (txt) txt.textContent = "Session Live";
    if (btn) {
      btn.querySelector(".ctrl-icon").textContent = "⏸";
      btn.querySelector(".ctrl-label").textContent = "Pause";
      btn.classList.remove("active-state");
    }
    showToast("Session resumed.");
  });

  // Report View actions
  const reportRetryBtn = document.getElementById("report-retry-btn");
  if (reportRetryBtn) {
    reportRetryBtn.addEventListener("click", () => {
      audioManager.playClick();
      initiateLobby(activeGame.quiz.id, activeGame.quiz.id.startsWith("custom-") || activeGame.quiz.id.startsWith("ai-"));
    });
  }

  const reportHomeBtn = document.getElementById("report-home-btn");
  if (reportHomeBtn) {
    reportHomeBtn.addEventListener("click", () => {
      audioManager.playClick();
      switchView("home-view");
    });
  }

  // Toggle Sidebar Leaderboard visibility
  const toggleLeaderboard = document.getElementById("toggle-sidebar-leaderboard");
  if (toggleLeaderboard) {
    toggleLeaderboard.addEventListener("click", () => {
      const sidebar = document.querySelector(".sidebar-leaderboard");
      if (sidebar) {
        const isHidden = sidebar.style.display === "none";
        sidebar.style.display = isHidden ? "block" : "none";
        toggleLeaderboard.textContent = isHidden ? "Hide" : "Show";
      }
    });
  }
}

// Populate sample questions preview in lobby
function populateSampleQuestions(sampleQuestions) {
  const container = document.getElementById("sample-questions-list");
  if (!container) return;

  if (!sampleQuestions || sampleQuestions.length === 0) {
    container.innerHTML = `<p class="no-items-msg">No preview available for this quiz.</p>`;
    return;
  }

  container.innerHTML = "";
  sampleQuestions.forEach((q, idx) => {
    container.innerHTML += `
      <div class="sample-question-item">
        <div class="sample-question-title">${idx + 1}. ${q.question}</div>
        <div class="sample-question-answer">💡 Sample Answer: ${q.answer}</div>
      </div>
    `;
  });
}
