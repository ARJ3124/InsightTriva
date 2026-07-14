import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// 1. App Configuration
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));
app.use(express.json());

const QUIZZES_FILE = path.join(__dirname, "quizzes.json");

// 2. Custom Quizzes Storage Database
function loadQuizzes() {
  if (!fs.existsSync(QUIZZES_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(QUIZZES_FILE, "utf8");
    return JSON.parse(data);
  } catch (e) {
    console.error("Failed to read quizzes.json, returning empty list.", e);
    return [];
  }
}

function saveQuiz(quiz) {
  const quizzes = loadQuizzes();
  quizzes.push(quiz);
  fs.writeFileSync(QUIZZES_FILE, JSON.stringify(quizzes, null, 2), "utf8");
}

// Express API Routes
app.get("/api/quizzes", (req, res) => {
  res.json(loadQuizzes());
});

app.post("/api/quizzes", (req, res) => {
  const quiz = req.body;
  if (!quiz || !quiz.id || !quiz.questions) {
    return res.status(400).json({ error: "Invalid quiz payload" });
  }
  saveQuiz(quiz);
  res.json({ success: true });
});

app.delete("/api/quizzes/:id", (req, res) => {
  const { id } = req.params;
  try {
    const quizzes = loadQuizzes();
    const updated = quizzes.filter(q => q.id !== id);
    fs.writeFileSync(QUIZZES_FILE, JSON.stringify(updated, null, 2), "utf8");
    res.json({ success: true });
  } catch (e) {
    console.error("Failed to delete quiz:", e);
    res.status(500).json({ error: "Failed to delete quiz" });
  }
});

// 3. Socket.io Game Room Manager
const rooms = new Map();
// Room state schema:
// {
//   code: "123456",
//   hostSocketId: "socket_id",
//   quiz: { id, title, description, questions: [...] },
//   players: [ { socketId, name, badge, score, streak, answersLog: [] } ],
//   status: "lobby", // "lobby" | "playing" | "feedback" | "ended"
//   mode: "timed", // "timed" | "self-paced"
//   currentQuestionIndex: 0,
//   questionTimer: null,
//   timeLeft: 20,
//   questionStartTime: 0,
//   submitsCount: 0
// }

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create Room (Host)
  socket.on("create-room", ({ quiz, isCustom, hostName, hostBadge, isPractice }) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Add host as first player
    const hostPlayer = {
      socketId: socket.id,
      isBot: false,
      isHost: true,
      name: hostName || "Host",
      badge: hostBadge || "▲",
      score: 0,
      streak: 0,
      answersLog: []
    };

    const roomState = {
      code,
      hostSocketId: socket.id,
      quiz,
      players: [hostPlayer],
      status: "lobby",
      mode: "timed",
      currentQuestionIndex: 0,
      questionTimer: null,
      timeLeft: 20,
      questionStartTime: 0,
      submitsCount: 0,
      isPractice: !!isPractice,
      maxRealPlayers: 0
    };

    rooms.set(code, roomState);
    socket.join(code);
    
    const sampleQuestions = quiz.questions.slice(0, 2).map(q => ({
      question: q.question,
      answer: q.options[q.answerIndex]
    }));

    socket.emit("room-created", { 
      code, 
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        totalQuestions: quiz.questions.length,
        sampleQuestions
      } 
    });
    console.log(`Room created: ${code} by host ${socket.id}`);
  });

  // Join Room (Player)
  socket.on("join-room", ({ name, badge, code }) => {
    const room = rooms.get(code);

    if (!room) {
      socket.emit("join-error", "Room session code not found.");
      return;
    }

    if (room.status !== "lobby") {
      socket.emit("join-error", "This session has already commenced.");
      return;
    }

    const joinedRealCount = room.players.filter(p => !p.isBot && !p.isHost).length;
    if (room.maxRealPlayers > 0 && joinedRealCount >= room.maxRealPlayers) {
      socket.emit("join-error", "Lobby limit reached.");
      return;
    }

    // Add player structure
    const player = {
      socketId: socket.id,
      name,
      badge,
      score: 0,
      streak: 0,
      answersLog: []
    };

    room.players.push(player);
    socket.join(code);

    const sampleQuestions = room.quiz.questions.slice(0, 2).map(q => ({
      question: q.question,
      answer: q.options[q.answerIndex]
    }));

    socket.emit("room-joined", {
      code,
      quiz: {
        id: room.quiz.id,
        title: room.quiz.title,
        description: room.quiz.description,
        totalQuestions: room.quiz.questions.length,
        sampleQuestions
      },
      isHost: false
    });

    // Broadcast updated player list to room
    const visiblePlayers = room.players.filter(p => !p.isHost || room.isPractice);
    io.to(code).emit("room-players-updated", {
      players: visiblePlayers.map(p => ({ name: p.name, badge: p.badge, score: p.score })),
      hostConnected: !!io.sockets.sockets.get(room.hostSocketId)
    });

    console.log(`Player ${name} (${socket.id}) joined room ${code}`);
  });

  // Start Session (Host)
  socket.on("start-game", ({ code, mode }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

    room.status = "playing";
    room.mode = mode;
    room.currentQuestionIndex = 0;

    // Filter host from leaderboard rankings unless practice
    const visiblePlayers = room.players.filter(p => !p.isHost || room.isPractice);
    const standings = visiblePlayers.map((p, idx) => ({
      socketId: p.socketId,
      name: p.name,
      badge: p.badge,
      score: 0,
      streak: 0,
      rank: idx + 1
    }));

    io.to(code).emit("game-started", { 
      mode, 
      totalQuestions: room.quiz.questions.length,
      standings
    });
    
    console.log(`Game started in room ${code} (Mode: ${mode})`);
    
    // Trigger first question
    setTimeout(() => {
      startQuestion(code);
    }, 1500);
  });

  // Submit Answer (Player)
  socket.on("submit-answer", ({ code, selectedIndex, timeUsedMs, doubleActive, shieldActive }) => {
    const room = rooms.get(code);
    if (!room || room.status !== "playing") return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const question = room.quiz.questions[room.currentQuestionIndex];
    const isCorrect = selectedIndex === question.answerIndex;

    let pointsGained = 0;
    
    if (isCorrect) {
      pointsGained = 1000;
      if (room.mode === "timed") {
        const speedRatio = Math.max(0, 1 - (timeUsedMs / 20000));
        pointsGained += Math.round(1000 * speedRatio);
      }

      // Streak multiplier
      const multiplier = 1.0 + player.streak * 0.1;
      pointsGained = Math.round(pointsGained * multiplier);

      if (doubleActive) {
        pointsGained *= 2;
      }

      player.score += pointsGained;
      player.streak++;
    } else {
      if (!shieldActive) {
        player.streak = 0;
      }
    }

    // Log response
    player.answersLog.push({
      questionIndex: room.currentQuestionIndex,
      userSelection: selectedIndex,
      correctIndex: question.answerIndex,
      pointsGained,
      isCorrect,
      isTimeout: false
    });

    room.submitsCount++;

    // Notify room that player answered — include stats for host dashboard
    const realPlayers = room.players.filter(p => !p.isHost || room.isPractice);
    io.to(code).emit("player-answered", {
      socketId: socket.id,
      name: player.name,
      badge: player.badge,
      answeredCount: room.submitsCount,
      totalPlayers: realPlayers.length
    });

    // Check if everyone answered (exclude host if not solo practice session)
    const requiredPlayersCount = room.players.filter(p => !p.isHost || room.isPractice).length;
    if (room.submitsCount >= requiredPlayersCount) {
      endQuestion(code);
    }
  });

  // Host Skip Timer / Force Advance
  socket.on("force-next-question", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

    if (room.status === "feedback") {
      advanceQuestion(code);
    } else if (room.status === "playing") {
      endQuestion(code);
    }
  });

  // Pause Game (Host Only)
  socket.on("pause-game", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.status !== "playing") return;

    room.status = "paused";
    // Stop the countdown timer
    if (room.questionTimer) {
      clearInterval(room.questionTimer);
      clearTimeout(room.questionTimer);
      room.questionTimer = null;
    }
    io.to(code).emit("game-paused");
    console.log(`Room ${code} paused by host.`);
  });

  // Resume Game (Host Only)
  socket.on("resume-game", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.status !== "paused") return;

    room.status = "playing";
    io.to(code).emit("game-resumed");
    console.log(`Room ${code} resumed by host.`);

    // Restart timer if timed mode
    if (room.mode === "timed" && room.timeLeft > 0) {
      room.questionTimer = setInterval(() => {
        if (room.status !== "playing") return;
        room.timeLeft--;
        io.to(code).emit("timer-sync", { timeLeft: room.timeLeft });
        if (room.timeLeft <= 0) {
          clearInterval(room.questionTimer);
          timeoutRemainingPlayers(code);
          endQuestion(code);
        }
      }, 1000);
    }
  });

  // Disconnect handler
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);

    // Check if player was in a room
    for (const [code, room] of rooms.entries()) {
      // If host disconnected
      if (room.hostSocketId === socket.id) {
        io.to(code).emit("host-disconnected");
        rooms.delete(code);
        console.log(`Room ${code} disbanded because host disconnected.`);
        continue;
      }

      // If player disconnected
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        room.players.splice(playerIndex, 1);
        
        const visiblePlayers = room.players.filter(p => !p.isHost || room.isPractice);
        io.to(code).emit("room-players-updated", {
          players: visiblePlayers.map(p => ({ name: p.name, badge: p.badge, score: p.score })),
          hostConnected: !!io.sockets.sockets.get(room.hostSocketId)
        });

        console.log(`Player ${player.name} left room ${code}.`);

        // If game is active, check if submitsCount matches remaining players
        if (room.status === "playing" && room.submitsCount >= room.players.length) {
          endQuestion(code);
        }
      }
    }
  });

  // Set Simulated Candidates (Host Only)
  socket.on("set-simulated-candidates", ({ code, count }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

    // Filter out previous bots from players list
    room.players = room.players.filter(p => !p.isBot);

    // Create new bot candidates
    const botNames = [
      "AlphaBot", "BetaBot", "GammaBot", "DeltaBot", "OmegaBot",
      "Einstein", "Curie", "Turing", "Lovelace", "Newton",
      "Maxwell", "Darwin", "Galileo", "Hawking", "Franklin"
    ];
    const botBadges = ["🤖", "👾", "🦊", "🦁", "🐨", "🐯", "🐼", "🐻", "🦄", "🦅"];

    for (let i = 0; i < count; i++) {
      const name = botNames[i % botNames.length] + " (Sim)";
      const badge = botBadges[i % botBadges.length];
      
      room.players.push({
        socketId: `bot-${i}-${Math.floor(Math.random() * 100000)}`,
        isBot: true,
        name: name,
        badge: badge,
        score: 0,
        streak: 0,
        answersLog: []
      });
    }

    // Broadcast updated player list to room
    const visiblePlayers = room.players.filter(p => !p.isHost || room.isPractice);
    io.to(code).emit("room-players-updated", {
      players: visiblePlayers.map(p => ({ name: p.name, badge: p.badge, score: p.score })),
      hostConnected: !!io.sockets.sockets.get(room.hostSocketId)
    });
  });

  // Set Max Real Players Limit (Host Only)
  socket.on("set-max-real-players", ({ code, maxPlayers }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;
    room.maxRealPlayers = parseInt(maxPlayers) || 0;
    console.log(`Room ${code} max real players limit set to: ${room.maxRealPlayers}`);
  });
});

// Start Question Round
function startQuestion(code) {
  const room = rooms.get(code);
  if (!room) return;

  room.status = "playing";
  room.timeLeft = 20;
  room.questionStartTime = Date.now();
  room.submitsCount = 0;

  // Clear any existing bot timeouts on players in the room
  room.players.forEach(p => {
    if (p.botTimeout) {
      clearTimeout(p.botTimeout);
      p.botTimeout = null;
    }
  });

  const q = room.quiz.questions[room.currentQuestionIndex];
  
  // Send data to clients (excluding answer index for cheating prevention)
  io.to(code).emit("question-start", {
    questionIndex: room.currentQuestionIndex,
    questionText: q.question,
    options: q.options,
    totalQuestions: room.quiz.questions.length
  });

  // Clear existing timer
  if (room.questionTimer) clearInterval(room.questionTimer);

  // Set interval timer if timed challenge
  if (room.mode === "timed") {
    room.questionTimer = setInterval(() => {
      room.timeLeft -= 1;
      
      io.to(code).emit("timer-sync", { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        clearInterval(room.questionTimer);
        room.questionTimer = null;
        
        // Timeout remaining players
        timeoutRemainingPlayers(code);
        endQuestion(code);
      }
    }, 1000);
  }

  // Schedule bots simulated submissions
  room.players.forEach(p => {
    if (p.isBot) {
      const delay = room.mode === "timed"
        ? Math.floor(2000 + Math.random() * 12000) // 2s to 14s
        : Math.floor(800 + Math.random() * 2000);   // 0.8s to 2.8s
      p.botTimeout = setTimeout(() => {
        submitBotAnswer(code, p.socketId);
      }, delay);
    }
  });
}

// Timeout players who did not submit
function timeoutRemainingPlayers(code) {
  const room = rooms.get(code);
  if (!room) return;

  const question = room.quiz.questions[room.currentQuestionIndex];

  room.players.forEach(player => {
    // If they haven't logged an answer for this question index
    if (player.answersLog.length <= room.currentQuestionIndex) {
      player.streak = 0; // reset streak
      player.answersLog.push({
        questionIndex: room.currentQuestionIndex,
        userSelection: -1,
        correctIndex: question.answerIndex,
        pointsGained: 0,
        isCorrect: false,
        isTimeout: true
      });
    }
  });
}

// End Question Round (Reveal correctness & scoreboard)
function endQuestion(code) {
  const room = rooms.get(code);
  if (!room) return;

  room.status = "feedback";
  if (room.questionTimer) {
    clearInterval(room.questionTimer);
    room.questionTimer = null;
  }

  // Clear bot timeouts
  room.players.forEach(p => {
    if (p.botTimeout) {
      clearTimeout(p.botTimeout);
      p.botTimeout = null;
    }
  });

  const question = room.quiz.questions[room.currentQuestionIndex];

  // Compile rankings
  const standings = [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({
      socketId: p.socketId,
      name: p.name,
      badge: p.badge,
      score: p.score,
      streak: p.streak,
      rank: idx + 1
    }));

  // Compile detailed result stats for each socket
  const results = {};
  room.players.forEach(p => {
    const log = p.answersLog[room.currentQuestionIndex];
    results[p.socketId] = {
      isCorrect: log ? log.isCorrect : false,
      isTimeout: log ? log.isTimeout : false,
      pointsGained: log ? log.pointsGained : 0,
      userSelection: log ? log.userSelection : -1,
      streak: p.streak
    };
  });

  io.to(code).emit("question-end", {
    correctIndex: question.answerIndex,
    explanation: question.explanation || `The correct answer is: ${question.options[question.answerIndex]}`,
    standings,
    results
  });

  // Automatically advance after 9 seconds review time (or host skips)
  room.questionTimer = setTimeout(() => {
    advanceQuestion(code);
  }, 9000);
}

// Advance to next question or final report page
function advanceQuestion(code) {
  const room = rooms.get(code);
  if (!room) return;

  if (room.questionTimer) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
  }

  // Clear bot timeouts
  room.players.forEach(p => {
    if (p.botTimeout) {
      clearTimeout(p.botTimeout);
      p.botTimeout = null;
    }
  });

  room.currentQuestionIndex++;

  if (room.currentQuestionIndex < room.quiz.questions.length) {
    startQuestion(code);
  } else {
    // End session, compile final rankings
    room.status = "ended";
    
    const finalStandings = [...room.players]
      .sort((a, b) => b.score - a.score)
      .map((p, idx) => ({
        socketId: p.socketId,
        name: p.name,
        badge: p.badge,
        score: p.score,
        accuracy: Math.round((p.answersLog.filter(l => l.isCorrect).length / room.quiz.questions.length) * 100),
        maxStreak: Math.max(0, ...p.answersLog.map(l => l.pointsGained > 0 ? 1 : 0)), // placeholder or full sweep
        rank: idx + 1
      }));

    // Calculate actual max streaks for final summary
    room.players.forEach(p => {
      let maxStr = 0;
      let currStr = 0;
      p.answersLog.forEach(l => {
        if (l.isCorrect) {
          currStr++;
          if (currStr > maxStr) maxStr = currStr;
        } else {
          currStr = 0;
        }
      });
      const match = finalStandings.find(fs => fs.socketId === p.socketId);
      if (match) match.maxStreak = maxStr;
    });

    io.to(code).emit("game-ended", { standings: finalStandings });
    console.log(`Game session ${code} ended.`);
  }
}

// 4. Start Server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Insight Trivia server listening on http://localhost:${PORT}`);
});

// Bot Answer Simulation Helper
function submitBotAnswer(code, socketId) {
  const room = rooms.get(code);
  if (!room || room.status !== "playing") return;

  const player = room.players.find(p => p.socketId === socketId);
  if (!player) return;

  const question = room.quiz.questions[room.currentQuestionIndex];
  
  // Decide selection: 75% accuracy
  const isCorrect = Math.random() < 0.75;
  let selectedIndex = question.answerIndex;
  if (!isCorrect) {
    // Pick a random incorrect index
    const incorrectOptions = [];
    question.options.forEach((_, idx) => {
      if (idx !== question.answerIndex) incorrectOptions.push(idx);
    });
    selectedIndex = incorrectOptions[Math.floor(Math.random() * incorrectOptions.length)];
  }

  const timeUsedMs = room.mode === "timed" ? (Date.now() - room.questionStartTime) : 0;

  let pointsGained = 0;
  if (isCorrect) {
    pointsGained = 1000;
    if (room.mode === "timed") {
      const speedRatio = Math.max(0, 1 - (timeUsedMs / 20000));
      pointsGained += Math.round(1000 * speedRatio);
    }
    const multiplier = 1.0 + player.streak * 0.1;
    pointsGained = Math.round(pointsGained * multiplier);
    
    // Simulate double points powerup sometimes for bots (e.g. 15% chance if they are doing well)
    if (Math.random() < 0.15 && player.streak > 1) {
      pointsGained *= 2;
    }

    player.score += pointsGained;
    player.streak++;
  } else {
    // Simulate streak shield sometimes (e.g. 30% chance)
    if (Math.random() > 0.3) {
      player.streak = 0;
    }
  }

  player.answersLog.push({
    questionIndex: room.currentQuestionIndex,
    userSelection: selectedIndex,
    correctIndex: question.answerIndex,
    pointsGained,
    isCorrect,
    isTimeout: false
  });

  room.submitsCount++;

  // Notify room that bot answered
  io.to(code).emit("player-answered", {
    socketId: player.socketId,
    name: player.name
  });

  // Check if everyone answered (exclude host if not solo practice session)
  const requiredPlayersCount = room.players.filter(p => !p.isHost || room.isPractice).length;
  if (room.submitsCount >= requiredPlayersCount) {
    endQuestion(code);
  }
}
