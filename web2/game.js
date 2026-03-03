(() => {
    "use strict";

    // ===== Audio =====
    const SE_PLACE = "./assets/se/maou_se_system47.wav";
    const SE_WIN = "./assets/se/8bit-juuyou-item.wav";
    const SE_LOSE = "./assets/se/8bit-game-over2.wav";

    let audioUnlocked = false;

    function playSE(path, volume = 0.9) {
        if (!audioUnlocked) return;
        const a = new Audio(path);
        a.volume = volume;
        a.play().catch(() => { });
    }

    function unlockAudioOnce() {
        audioUnlocked = true;
    }
    window.addEventListener("pointerdown", unlockAudioOnce, { once: true });
    window.addEventListener("keydown", unlockAudioOnce, { once: true });

    // ===== Game constants =====
    const SIZE = 8;
    const EMPTY = 0;
    const BLACK = 1;
    const WHITE = -1;

    const DIRS = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1],
    ];

    // ===== Ring FX =====
    // { r, c, player, t0 }
    const ringFx = [];
    const RING_DURATION = 420;

    function spawnRing(r, c, player) {
        ringFx.push({ r, c, player, t0: performance.now() });
    }

    // ===== State =====
    let cpuLevel = "easy"; // easy | normal | hard
    let board = makeStartBoard();

    // ここが重要：人間/CPUの色は毎回変わるので let
    let HUMAN = WHITE;
    let CPU = BLACK;

    let turn = HUMAN;
    let gameOver = false;
    let cpuThinking = false;
    let resultSEPlayed = false;
    let overlayShown = false;
    let started = false;

    // ===== DOM =====
    const cv = document.getElementById("cv");
    const ctx = cv.getContext("2d");
    const statusEl = document.getElementById("status");

    const restartBtn = document.getElementById("restart");
    const cpuEasyBtn = document.getElementById("cpu_easy");
    const cpuNormalBtn = document.getElementById("cpu_normal");
    const cpuHardBtn = document.getElementById("cpu_hard");

    // これらはHTMLに無い可能性もあるので安全に拾う（無くても動く）
    const resultOverlay = document.getElementById("resultOverlay");
    const resultText = document.getElementById("resultText");
    const resultSub = document.getElementById("resultSub");

    function setCpuLevel(level) {
        cpuLevel = level;
        cpuEasyBtn?.classList.toggle("isOn", level === "easy");
        cpuNormalBtn?.classList.toggle("isOn", level === "normal");
        cpuHardBtn?.classList.toggle("isOn", level === "hard");
    }

    cpuEasyBtn?.addEventListener("click", () => setCpuLevel("easy"));
    cpuNormalBtn?.addEventListener("click", () => setCpuLevel("normal"));
    cpuHardBtn?.addEventListener("click", () => setCpuLevel("hard"));

    restartBtn?.addEventListener("click", () => {
        resetGame(true, true); // 色も先攻後攻もランダム
    });

    // ===== Board helpers =====
    function makeStartBoard() {
        const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
        const m = SIZE / 2;
        // 初期配置は「黒/白」の固定（人間がどっちでも関係ない）
        b[m - 1][m - 1] = WHITE;
        b[m][m] = WHITE;
        b[m - 1][m] = BLACK;
        b[m][m - 1] = BLACK;
        return b;
    }

    function inside(r, c) {
        return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
    }

    function countStones(b) {
        let black = 0, white = 0;
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (b[r][c] === BLACK) black++;
                else if (b[r][c] === WHITE) white++;
            }
        }
        return { black, white };
    }

    function getHumanCpuCounts() {
        const { black, white } = countStones(board);
        const human = (HUMAN === BLACK) ? black : white;
        const cpu = (CPU === BLACK) ? black : white;
        return { black, white, human, cpu };
    }

    function findFlips(b, player, r, c) {
        if (!inside(r, c) || b[r][c] !== EMPTY) return [];
        const flips = [];
        for (const [dr, dc] of DIRS) {
            let rr = r + dr, cc = c + dc;
            const line = [];
            while (inside(rr, cc) && b[rr][cc] === -player) {
                line.push([rr, cc]);
                rr += dr; cc += dc;
            }
            if (line.length > 0 && inside(rr, cc) && b[rr][cc] === player) {
                flips.push(...line);
            }
        }
        return flips;
    }

    function validMoves(b, player) {
        const moves = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const flips = findFlips(b, player, r, c);
                if (flips.length) moves.push({ r, c, flips });
            }
        }
        return moves;
    }

    // AI思考用：副作用なし
    function applyMove(b, player, mv) {
        b[mv.r][mv.c] = player;
        for (const [rr, cc] of mv.flips) b[rr][cc] = player;
    }

    // 実ゲーム用：リング演出つき
    function applyMoveWithFx(b, player, mv) {
        b[mv.r][mv.c] = player;
        spawnRing(mv.r, mv.c, player);

        for (const [rr, cc] of mv.flips) {
            b[rr][cc] = player;
            spawnRing(rr, cc, player);
        }
    }

    function cloneBoard(b) {
        return b.map(row => row.slice());
    }

    function isGameOver(b) {
        const m1 = validMoves(b, BLACK).length;
        const m2 = validMoves(b, WHITE).length;
        return (m1 === 0 && m2 === 0);
    }

    // ===== CPU =====
    function chooseCpuMoveEasy() {
        const moves = validMoves(board, CPU);
        if (!moves.length) return null;
        return moves[Math.floor(Math.random() * moves.length)];
    }

    function scoreMoveHeuristic(mv) {
        const { r, c } = mv;
        const isCorner = (r === 0 || r === 7) && (c === 0 || c === 7);
        if (isCorner) return 10000 + mv.flips.length;

        const isEdge = (r === 0 || r === 7 || c === 0 || c === 7);
        let s = mv.flips.length;
        if (isEdge) s += 20;

        const nearCorner =
            (r === 0 && (c === 1 || c === 6)) ||
            (r === 7 && (c === 1 || c === 6)) ||
            (c === 0 && (r === 1 || r === 6)) ||
            (c === 7 && (r === 1 || r === 6)) ||
            ((r === 1 || r === 6) && (c === 1 || c === 6));

        if (nearCorner) s -= 30;

        return s;
    }

    function chooseCpuMoveNormal() {
        const moves = validMoves(board, CPU);
        if (!moves.length) return null;
        moves.sort((a, b) => scoreMoveHeuristic(b) - scoreMoveHeuristic(a));
        return moves[0];
    }

    // CPU視点の評価（CPUが白になる場合があるので可変）
    function evalBoard(b) {
        const { black, white } = countStones(b);
        return (CPU === BLACK) ? (black - white) : (white - black);
    }

    function minimax(b, player, depth) {
        if (depth === 0 || isGameOver(b)) return { score: evalBoard(b), move: null };

        const moves = validMoves(b, player);
        if (!moves.length) {
            return minimax(b, -player, depth - 1);
        }

        let bestMove = null;

        if (player === CPU) {
            let bestScore = -Infinity;
            for (const mv of moves) {
                const nb = cloneBoard(b);
                applyMove(nb, player, mv);
                const r = minimax(nb, -player, depth - 1);
                if (r.score > bestScore) {
                    bestScore = r.score;
                    bestMove = mv;
                }
            }
            return { score: bestScore, move: bestMove };
        } else {
            let bestScore = Infinity;
            for (const mv of moves) {
                const nb = cloneBoard(b);
                applyMove(nb, player, mv);
                const r = minimax(nb, -player, depth - 1);
                if (r.score < bestScore) {
                    bestScore = r.score;
                    bestMove = mv;
                }
            }
            return { score: bestScore, move: bestMove };
        }
    }

    function chooseCpuMoveHard() {
        return minimax(cloneBoard(board), CPU, 3).move;
    }

    function requestCpuMove() {
        if (!started) return;
        if (gameOver || cpuThinking) return;
        if (turn !== CPU) return;

        cpuThinking = true;
        updateStatus();

        setTimeout(() => {
            cpuThinking = false;

            let mv = null;
            if (cpuLevel === "easy") mv = chooseCpuMoveEasy();
            else if (cpuLevel === "normal") mv = chooseCpuMoveNormal();
            else mv = chooseCpuMoveHard();

            if (!mv) {
                // CPUパス
                turn = HUMAN;
                if (isGameOver(board)) gameOver = true;

                updateStatus();

                // 人間も置けないならCPUへ（連続パス）
                if (!gameOver && validMoves(board, HUMAN).length === 0) {
                    turn = CPU;
                    updateStatus();
                    requestCpuMove();
                }
                return;
            }

            applyMoveWithFx(board, CPU, mv);
            playSE(SE_PLACE, 0.65);

            if (isGameOver(board)) gameOver = true;

            // 次へ
            turn = HUMAN;
            if (!gameOver && validMoves(board, HUMAN).length === 0) {
                turn = CPU;
            }

            updateStatus();
            if (!gameOver && turn === CPU) requestCpuMove();
        }, 260);
    }

    // ===== Start / Reset =====
    function resetGame(randomFirst = true, randomColors = true) {
        started = true;

        board = makeStartBoard();
        gameOver = false;
        cpuThinking = false;
        resultSEPlayed = false;
        overlayShown = false;
        ringFx.length = 0;

        hideResultOverlay();

        // ★人間/CPUの白黒をランダム
        if (randomColors) {
            HUMAN = (Math.random() < 0.5) ? WHITE : BLACK;
            CPU = -HUMAN;
        } else {
            HUMAN = WHITE;
            CPU = BLACK;
        }

        // ★先攻後攻をランダム（「色」とは別）
        if (randomFirst) {
            turn = (Math.random() < 0.5) ? HUMAN : CPU;
        } else {
            turn = HUMAN;
        }

        updateStatus();

        // CPU先手なら開始
        if (!gameOver && turn === CPU) {
            requestCpuMove();
        }
    }

    // ===== Input =====
    cv.addEventListener("pointerdown", (e) => {
        // 初回タップで開始（色・先攻後攻ランダム）
        if (!started) {
            resetGame(true, true);
            return;
        }

        if (gameOver || cpuThinking) return;
        if (turn !== HUMAN) return;

        const rect = cv.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (cv.width / rect.width);
        const y = (e.clientY - rect.top) * (cv.height / rect.height);

        const cellPos = canvasToCell(x, y);
        if (!cellPos) return;

        const moves = validMoves(board, HUMAN);
        const mv = moves.find(m => m.r === cellPos.r && m.c === cellPos.c);
        if (!mv) return;

        applyMoveWithFx(board, HUMAN, mv);
        playSE(SE_PLACE, 0.85);

        if (isGameOver(board)) gameOver = true;

        // 次へ
        turn = CPU;
        if (!gameOver && validMoves(board, CPU).length === 0) {
            turn = HUMAN;
            if (validMoves(board, HUMAN).length === 0) gameOver = true;
        }

        updateStatus();
        if (!gameOver && turn === CPU) requestCpuMove();
    });

    function canvasToCell(x, y) {
        const pad = 18;
        const size = cv.width - pad * 2;
        const cell = size / SIZE;
        const cx = x - pad;
        const cy = y - pad;
        if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
        return { r: Math.floor(cy / cell), c: Math.floor(cx / cell) };
    }

    // ===== Result Overlay =====
    function showResultOverlay(kind, black, white) {
        if (!resultOverlay || !resultText || !resultSub) return;
        if (overlayShown) return;
        overlayShown = true;

        resultOverlay.classList.remove("isHidden");

        resultText.classList.remove("isWin", "isLose", "isDraw");
        if (kind === "win") {
            resultText.textContent = "YOU WIN";
            resultText.classList.add("isWin");
        } else if (kind === "lose") {
            resultText.textContent = "YOU LOSE";
            resultText.classList.add("isLose");
        } else {
            resultText.textContent = "DRAW";
            resultText.classList.add("isDraw");
        }

        resultSub.textContent = `BLACK:${black} WHITE:${white}`;

        // アニメ再発火
        resultText.style.animation = "none";
        void resultText.offsetHeight;
        resultText.style.animation = "";
    }

    function hideResultOverlay() {
        if (!resultOverlay || !resultText) return;
        resultOverlay.classList.add("isHidden");
        resultText.classList.remove("isWin", "isLose", "isDraw");
    }

    // ===== UI =====
    function updateStatus() {
        const { black, white, human, cpu } = getHumanCpuCounts();

        const humanColorLabel = (HUMAN === WHITE) ? "白" : "黒";
        const cpuColorLabel = (CPU === WHITE) ? "白" : "黒";

        if (!started) {
            statusEl.textContent = "タップ/クリックして開始";
            return;
        }

        if (gameOver) {
            let msg = `GAME OVER | BLACK:${black} WHITE:${white} | `;
            let kind = "draw";
            let result = "DRAW";

            if (human > cpu) { kind = "win"; result = "YOU WIN"; }
            else if (cpu > human) { kind = "lose"; result = "YOU LOSE"; }

            msg += result;
            statusEl.textContent = msg;

            showResultOverlay(kind, black, white);

            if (!resultSEPlayed) {
                resultSEPlayed = true;
                if (human > cpu) playSE(SE_WIN, 0.95);
                else if (cpu > human) playSE(SE_LOSE, 0.95);
            }
            return;
        }

        if (cpuThinking) {
            statusEl.textContent = `CPU考え中…（CPU:${cpuColorLabel}） | BLACK:${black} WHITE:${white}`;
            return;
        }

        if (turn === HUMAN) {
            statusEl.textContent = `あなたの番（${humanColorLabel}） | BLACK:${black} WHITE:${white}`;
        } else {
            statusEl.textContent = `CPUの番（${cpuColorLabel}） | BLACK:${black} WHITE:${white}`;
        }
    }

    // ===== Render =====
    function drawBoardAndStones() {
        ctx.clearRect(0, 0, cv.width, cv.height);

        const pad = 18;
        const size = cv.width - pad * 2;
        const cell = size / SIZE;

        // 背景
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(pad, pad, size, size);

        // グリッド（薄め）
        ctx.strokeStyle = "rgba(57,246,255,0.18)";
        ctx.lineWidth = 1;
        ctx.strokeRect(pad + 0.5, pad + 0.5, size - 1, size - 1);

        for (let i = 1; i < SIZE; i++) {
            ctx.beginPath();
            ctx.moveTo(pad + i * cell, pad);
            ctx.lineTo(pad + i * cell, pad + size);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(pad, pad + i * cell);
            ctx.lineTo(pad + size, pad + i * cell);
            ctx.stroke();
        }

        // 石
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const v = board[r][c];
                if (v === EMPTY) continue;

                const cx = pad + c * cell + cell / 2;
                const cy = pad + r * cell + cell / 2;
                const rad = cell * 0.33;

                if (v === WHITE) {
                    // 外縁（ピンク）
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad * 1.12, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(255,79,214,0.95)";
                    ctx.lineWidth = 4;
                    ctx.stroke();

                    // 中身
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(245,250,255,0.95)";
                    ctx.fill();

                    // 内側の締めリング（ハイライト無しで“締まる”）
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad * 0.98, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(10,14,18,0.35)";
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                } else {
                    // 外縁（シアン）
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad * 1.12, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(57,246,255,0.95)";
                    ctx.lineWidth = 4;
                    ctx.stroke();

                    // 中身
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(8,12,15,0.98)";
                    ctx.fill();
                }
            }
        }

        // ヒント（人間ターン中だけ）
        if (started && !gameOver && turn === HUMAN && !cpuThinking) {
            const moves = validMoves(board, HUMAN);
            ctx.fillStyle = "rgba(207,239,255,0.35)";
            for (const mv of moves) {
                const cx = pad + mv.c * cell + cell / 2;
                const cy = pad + mv.r * cell + cell / 2;
                ctx.beginPath();
                ctx.arc(cx, cy, cell * 0.06, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        return { pad, cell };
    }

    function drawRings(pad, cell) {
        const now = performance.now();

        for (let i = ringFx.length - 1; i >= 0; i--) {
            const fx = ringFx[i];
            const t = (now - fx.t0) / RING_DURATION;
            if (t >= 1) {
                ringFx.splice(i, 1);
                continue;
            }

            const cx = pad + fx.c * cell + cell / 2;
            const cy = pad + fx.r * cell + cell / 2;

            const base = cell * 0.18;
            const radius = base + t * cell * 0.85;
            const alpha = (1 - t);

            ctx.save();
            ctx.globalAlpha = 0.9 * alpha;

            ctx.strokeStyle = (fx.player === WHITE)
                ? "rgba(255,79,214,0.95)"
                : "rgba(57,246,255,0.95)";

            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.globalAlpha = 0.35 * alpha;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 1.18, 0, Math.PI * 2);
            ctx.stroke();

            ctx.restore();
        }
    }

    function loop() {
        const { pad, cell } = drawBoardAndStones();
        if (ringFx.length) drawRings(pad, cell);
        requestAnimationFrame(loop);
    }

    // ===== start =====
    setCpuLevel("easy");
    hideResultOverlay();
    started = false;
    updateStatus();
    requestAnimationFrame(loop);
})();