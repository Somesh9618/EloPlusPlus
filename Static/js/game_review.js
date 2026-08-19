/**
 * Elo++ Game Review Client-side Engine & Visualizer
 * Implements move navigation, evaluation calculation, 
 * move classification, and move notation replay.
 */

(function () {
    // Quality badges config
    const BADGES = {
        brilliant: { label: 'Brilliant', icon: '💎', color: '#00f2fe', desc: 'A brilliant move finding a decisive tactical or sacrifice sequence.' },
        great:     { label: 'Great Move', icon: '🌟', color: '#5c7cfa', desc: 'An excellent find that significantly improves the position.' },
        best:      { label: 'Best Move', icon: '⭐', color: '#00e676', desc: 'The objectively best move according to positional evaluation.' },
        excellent: { label: 'Excellent', icon: '👍', color: '#69db7c', desc: 'A very solid continuation close to the engine best.' },
        good:      { label: 'Good', icon: '✔', color: '#a9e34b', desc: 'A standard sound chess move.' },
        book:      { label: 'Book Move', icon: '📖', color: '#cc5de8', desc: 'Established chess opening theory.' },
        inaccuracy:{ label: 'Inaccuracy', icon: '🟡', color: '#ffd43b', desc: 'Not the optimal move, ceding minor advantage.' },
        mistake:   { label: 'Mistake', icon: '🟠', color: '#ff922b', desc: 'A notable error that damages your position.' },
        miss:      { label: 'Missed Win', icon: '❌', color: '#ff6b6b', desc: 'Missed a winning tactical or positional opportunity.' },
        blunder:   { label: 'Blunder', icon: '🔴', color: '#ff1744', desc: 'A severe blunder drastically changing game outcome.' }
    };

    // Minimal lightweight chess state engine for replay
    class SimpleChess {
        constructor() {
            this.reset();
        }

        reset() {
            this.board = [
                ['r','n','b','q','k','b','n','r'],
                ['p','p','p','p','p','p','p','p'],
                ['','','','','','','',''],
                ['','','','','','','',''],
                ['','','','','','','',''],
                ['','','','','','','',''],
                ['P','P','P','P','P','P','P','P'],
                ['R','N','B','Q','K','B','N','R']
            ];
            this.turn = 'w'; // 'w' or 'b'
            this.castling = { K: true, Q: true, k: true, q: true };
            this.enPassant = null;
            this.halfMoves = 0;
            this.fullMoves = 1;
            this.history = [];
        }

        getPiece(row, col) {
            if (row < 0 || row > 7 || col < 0 || col > 7) return '';
            return this.board[row][col];
        }

        setPiece(row, col, piece) {
            this.board[row][col] = piece;
        }

        getFEN() {
            let fen = '';
            for (let r = 0; r < 8; r++) {
                let empty = 0;
                for (let c = 0; c < 8; c++) {
                    const p = this.board[r][c];
                    if (!p) {
                        empty++;
                    } else {
                        if (empty > 0) {
                            fen += empty;
                            empty = 0;
                        }
                        fen += p;
                    }
                }
                if (empty > 0) fen += empty;
                if (r < 7) fen += '/';
            }
            fen += ` ${this.turn} `;
            let castlingStr = '';
            if (this.castling.K) castlingStr += 'K';
            if (this.castling.Q) castlingStr += 'Q';
            if (this.castling.k) castlingStr += 'k';
            if (this.castling.q) castlingStr += 'q';
            fen += (castlingStr || '-') + ' ';
            fen += (this.enPassant || '-') + ' ';
            fen += `${this.halfMoves} ${this.fullMoves}`;
            return fen;
        }

        // Apply SAN move string (e.g. e4, Nf3, O-O, exd5, Bxe7, Qh5#, e8=Q)
        applySAN(san) {
            san = san.replace(/[+#?!]/g, '').trim();
            if (!san) return null;

            const isWhite = this.turn === 'w';
            let fromRow = -1, fromCol = -1, toRow = -1, toCol = -1;
            let promo = null;

            // Castling
            if (san === 'O-O' || san === '0-0') {
                const r = isWhite ? 7 : 0;
                this.setPiece(r, 4, '');
                this.setPiece(r, 6, isWhite ? 'K' : 'k');
                this.setPiece(r, 7, '');
                this.setPiece(r, 5, isWhite ? 'R' : 'r');
                fromRow = r; fromCol = 4; toRow = r; toCol = 6;
            } else if (san === 'O-O-O' || san === '0-0-0') {
                const r = isWhite ? 7 : 0;
                this.setPiece(r, 4, '');
                this.setPiece(r, 2, isWhite ? 'K' : 'k');
                this.setPiece(r, 0, '');
                this.setPiece(r, 3, isWhite ? 'R' : 'r');
                fromRow = r; fromCol = 4; toRow = r; toCol = 2;
            } else {
                // Promotion check
                if (san.includes('=')) {
                    const parts = san.split('=');
                    promo = parts[1][0];
                    san = parts[0];
                }

                const targetSq = san.slice(-2);
                if (targetSq.length === 2 && targetSq[0] >= 'a' && targetSq[0] <= 'h' && targetSq[1] >= '1' && targetSq[1] <= '8') {
                    toCol = targetSq.charCodeAt(0) - 97;
                    toRow = 8 - parseInt(targetSq[1]);
                } else {
                    return null;
                }

                let pieceType = 'P';
                let disambig = '';
                const prefix = san.slice(0, -2).replace('x', '');

                if (prefix.length > 0 && prefix[0] >= 'A' && prefix[0] <= 'Z') {
                    pieceType = prefix[0];
                    disambig = prefix.slice(1);
                } else {
                    pieceType = 'P';
                    disambig = prefix;
                }

                const searchPiece = isWhite ? pieceType : pieceType.toLowerCase();

                // Find candidate source square
                const candidates = [];
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        if (this.board[r][c] === searchPiece) {
                            if (this.canPieceMove(r, c, toRow, toCol, searchPiece, isWhite)) {
                                candidates.push({ r, c });
                            }
                        }
                    }
                }

                let chosen = null;
                if (candidates.length === 1) {
                    chosen = candidates[0];
                } else if (candidates.length > 1) {
                    // Match disambiguation
                    for (let cand of candidates) {
                        const fileChar = String.fromCharCode(97 + cand.c);
                        const rankChar = String(8 - cand.r);
                        if (disambig.includes(fileChar) || disambig.includes(rankChar)) {
                            chosen = cand;
                            break;
                        }
                    }
                    if (!chosen) chosen = candidates[0];
                }

                if (chosen) {
                    fromRow = chosen.r;
                    fromCol = chosen.c;

                    // Handle en-passant capture
                    if (pieceType === 'P' && toCol !== fromCol && this.board[toRow][toCol] === '') {
                        this.setPiece(fromRow, toCol, ''); // remove captured pawn
                    }

                    this.setPiece(fromRow, fromCol, '');
                    let finalPiece = searchPiece;
                    if (promo) {
                        finalPiece = isWhite ? promo.toUpperCase() : promo.toLowerCase();
                    }
                    this.setPiece(toRow, toCol, finalPiece);
                }
            }

            this.turn = isWhite ? 'b' : 'w';
            if (!isWhite) this.fullMoves++;
            return { fromRow, fromCol, toRow, toCol };
        }

        canPieceMove(fr, fc, tr, tc, piece, isWhite) {
            const type = piece.toUpperCase();
            const dr = tr - fr;
            const dc = tc - fc;
            const absDr = Math.abs(dr);
            const absDc = Math.abs(dc);

            if (type === 'P') {
                const dir = isWhite ? -1 : 1;
                const startRow = isWhite ? 6 : 1;
                // Single step forward
                if (dc === 0 && dr === dir && this.board[tr][tc] === '') return true;
                // Double step forward
                if (dc === 0 && fr === startRow && dr === 2 * dir && this.board[fr + dir][fc] === '' && this.board[tr][tc] === '') return true;
                // Capture
                if (absDc === 1 && dr === dir) {
                    if (this.board[tr][tc] !== '') return true;
                    return true;
                }
                return false;
            }

            if (type === 'N') {
                return (absDr === 1 && absDc === 2) || (absDr === 2 && absDc === 1);
            }

            if (type === 'B') {
                if (absDr !== absDc || absDr === 0) return false;
                return this.isPathClear(fr, fc, tr, tc);
            }

            if (type === 'R') {
                if (dr !== 0 && dc !== 0) return false;
                return this.isPathClear(fr, fc, tr, tc);
            }

            if (type === 'Q') {
                if (absDr !== absDc && dr !== 0 && dc !== 0) return false;
                return this.isPathClear(fr, fc, tr, tc);
            }

            if (type === 'K') {
                return absDr <= 1 && absDc <= 1;
            }

            return false;
        }

        isPathClear(fr, fc, tr, tc) {
            const stepR = Math.sign(tr - fr);
            const stepC = Math.sign(tc - fc);
            let curR = fr + stepR;
            let curC = fc + stepC;
            while (curR !== tr || curC !== tc) {
                if (this.board[curR][curC] !== '') return false;
                curR += stepR;
                curC += stepC;
            }
            return true;
        }
    }

    // Material & positional weight heuristic evaluator
    const PIECE_VALS = { 'P': 1.0, 'N': 3.1, 'B': 3.3, 'R': 5.0, 'Q': 9.2, 'K': 0.0 };

    function evaluatePosition(board, turn, plyIndex, totalPlies) {
        let whiteScore = 0;
        let blackScore = 0;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                const isW = p === p.toUpperCase();
                const val = PIECE_VALS[p.toUpperCase()] || 0;
                
                // Center control bonus
                const centerBonus = (r >= 2 && r <= 5 && c >= 2 && c <= 5) ? 0.2 : 0;
                const advancement = isW ? (7 - r) * 0.05 : r * 0.05;

                if (isW) {
                    whiteScore += val + centerBonus + advancement;
                } else {
                    blackScore += val + centerBonus + advancement;
                }
            }
        }

        let evalVal = whiteScore - blackScore;
        return parseFloat(evalVal.toFixed(2));
    }

    // Parse PGN Moves & Headers
    function parsePGN(pgnText) {
        if (!pgnText) return { headers: {}, moves: [] };

        const headers = {};
        const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
        let match;
        while ((match = headerRegex.exec(pgnText)) !== null) {
            headers[match[1]] = match[2];
        }

        let moveSection = pgnText.replace(/\[[^\]]*\]/g, ' ');
        moveSection = moveSection.replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ');
        moveSection = moveSection.replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ');

        const tokens = moveSection.split(/\s+/).filter(t => t && !t.includes('.') || /^\d+\.\.\./.test(t) || /^\d+\./.test(t));
        
        const sanMoves = [];
        for (let t of tokens) {
            let clean = t.replace(/^\d+\.+/, '').trim();
            if (clean && !['1-0', '0-1', '1/2-1/2', '*'].includes(clean)) {
                sanMoves.push(clean);
            }
        }

        return { headers, moves: sanMoves };
    }

    // Build timeline of moves, evaluations, classifications
    function buildGameTimeline(sanMoves, userColor, pgnHeaders) {
        const chess = new SimpleChess();
        const timeline = [];

        // Initial starting position
        timeline.push({
            ply: 0,
            moveNumber: 0,
            turn: 'w',
            san: 'Start',
            fen: chess.getFEN(),
            board: JSON.parse(JSON.stringify(chess.board)),
            eval: 0.15,
            classification: 'book',
            highlight: null
        });

        let prevEval = 0.15;

        for (let i = 0; i < sanMoves.length; i++) {
            const san = sanMoves[i];
            const isWhite = (i % 2 === 0);
            const moveNum = Math.floor(i / 2) + 1;
            const moveResult = chess.applySAN(san);
            const fen = chess.getFEN();
            const curEval = evaluatePosition(chess.board, chess.turn, i + 1, sanMoves.length);

            const delta = isWhite ? (curEval - prevEval) : (prevEval - curEval);
            
            let classification = 'good';
            if (i < 8) {
                classification = 'book';
            } else if (delta >= 1.2 && (san.includes('x') || san.includes('Q') || san.includes('N'))) {
                classification = 'brilliant';
            } else if (delta >= 0.8) {
                classification = 'great';
            } else if (delta >= -0.15) {
                classification = 'best';
            } else if (delta >= -0.45) {
                classification = 'excellent';
            } else if (delta >= -0.9) {
                classification = 'good';
            } else if (delta >= -1.5) {
                classification = 'inaccuracy';
            } else if (delta >= -2.8) {
                classification = 'mistake';
            } else if (delta < -4.0 && (isWhite ? prevEval > 2.0 : prevEval < -2.0)) {
                classification = 'miss';
            } else {
                classification = 'blunder';
            }

            timeline.push({
                ply: i + 1,
                moveNumber: moveNum,
                isWhite: isWhite,
                turn: isWhite ? 'w' : 'b',
                san: san,
                fen: fen,
                board: JSON.parse(JSON.stringify(chess.board)),
                eval: curEval,
                delta: delta,
                classification: classification,
                highlight: moveResult
            });

            prevEval = curEval;
        }

        return timeline;
    }

    // Initialize UI Component
    function initGameReviewApp() {
        const pgnDataElement = document.getElementById('pgnData');
        if (!pgnDataElement) return; // Not on review workspace

        const userColor = document.getElementById('reviewUserColor')?.value || 'white';
        const pgnText = pgnDataElement.textContent.trim();

        const { headers, moves } = parsePGN(pgnText);
        const timeline = buildGameTimeline(moves, userColor, headers);

        let currentPly = 0;
        let isAutoPlaying = false;
        let playInterval = null;

        // Count classifications for user & opponent
        const userStats = { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 };
        const oppStats  = { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 };

        for (let i = 1; i < timeline.length; i++) {
            const item = timeline[i];
            const isUserMove = (userColor === 'white' && item.isWhite) || (userColor === 'black' && !item.isWhite);
            const target = isUserMove ? userStats : oppStats;
            if (target[item.classification] !== undefined) {
                target[item.classification]++;
            }
        }

        renderClassificationMatrix(userStats, oppStats);
        renderMoveList(timeline);
        updateReviewState(0);

        // Bind playback controls
        document.getElementById('btnFirst')?.addEventListener('click', () => goToPly(0));
        document.getElementById('btnPrev')?.addEventListener('click', () => goToPly(currentPly - 1));
        document.getElementById('btnNext')?.addEventListener('click', () => goToPly(currentPly + 1));
        document.getElementById('btnLast')?.addEventListener('click', () => goToPly(timeline.length - 1));

        const playBtn = document.getElementById('btnPlay');
        playBtn?.addEventListener('click', () => {
            if (isAutoPlaying) {
                clearInterval(playInterval);
                isAutoPlaying = false;
                playBtn.innerHTML = '▶';
            } else {
                isAutoPlaying = true;
                playBtn.innerHTML = '⏸';
                playInterval = setInterval(() => {
                    if (currentPly < timeline.length - 1) {
                        goToPly(currentPly + 1);
                    } else {
                        clearInterval(playInterval);
                        isAutoPlaying = false;
                        playBtn.innerHTML = '▶';
                    }
                }, 1000);
            }
        });

        // Keyboard listener
        window.addEventListener('keydown', (e) => {
            if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
                e.preventDefault();
                goToPly(currentPly - 1);
            } else if (['ArrowRight', 'ArrowDown', ' '].includes(e.key)) {
                e.preventDefault();
                goToPly(currentPly + 1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                goToPly(0);
            } else if (e.key === 'End') {
                e.preventDefault();
                goToPly(timeline.length - 1);
            }
        });

        function goToPly(targetPly) {
            if (targetPly < 0) targetPly = 0;
            if (targetPly >= timeline.length) targetPly = timeline.length - 1;
            currentPly = targetPly;
            updateReviewState(currentPly);
        }

        function updateReviewState(ply) {
            const state = timeline[ply];
            updateEvaluationBar(state.eval);
            updateMoveBadge(state);
            highlightActiveMove(ply);
        }

        function updateEvaluationBar(evalScore) {
            const barFill = document.getElementById('evalBarFill');
            const scoreText = document.getElementById('evalScoreText');
            if (!barFill || !scoreText) return;

            // Map eval from -10 to +10 into percentage (50% is even)
            let clamped = Math.max(-10, Math.min(10, evalScore));
            let whitePct = 50 + (clamped * 4.5);
            whitePct = Math.max(5, Math.min(95, whitePct));

            barFill.style.width = `${whitePct}%`;

            let displayScore = evalScore > 0 ? `+${evalScore.toFixed(1)}` : `${evalScore.toFixed(1)}`;
            if (evalScore === 0) displayScore = '0.0';
            
            let leadText = evalScore > 0.3 ? `White (${displayScore})` : (evalScore < -0.3 ? `Black (${displayScore})` : `Even (${displayScore})`);
            scoreText.textContent = leadText;
        }

        function updateMoveBadge(state) {
            const badgeContainer = document.getElementById('currentMoveBadge');
            const explanationContainer = document.getElementById('moveExplanation');
            if (!badgeContainer) return;

            if (state.ply === 0) {
                badgeContainer.innerHTML = `<span class="quality-badge" style="background: rgba(255,255,255,0.1); color: var(--text-primary);"><span class="badge-icon">♟️</span> Initial Position</span>`;
                if (explanationContainer) {
                    explanationContainer.textContent = "Start of the match. White to move.";
                }
                return;
            }

            const conf = BADGES[state.classification] || BADGES.good;
            badgeContainer.innerHTML = `
                <span class="quality-badge badge-${state.classification}" style="border-color: ${conf.color}; color: ${conf.color};">
                    <span class="badge-icon">${conf.icon}</span> ${conf.label} (${state.san})
                </span>
            `;

            if (explanationContainer) {
                const playerLabel = state.isWhite ? 'White' : 'Black';
                explanationContainer.textContent = `Move ${state.moveNumber}${state.isWhite ? '.' : '...'} ${playerLabel} played ${state.san}. ${conf.desc}`;
            }
        }

        function renderMoveList(timeline) {
            const listEl = document.getElementById('moveListContainer');
            if (!listEl) return;
            listEl.innerHTML = '';

            let currentMoveRow = null;

            for (let i = 1; i < timeline.length; i++) {
                const item = timeline[i];
                if (item.isWhite) {
                    currentMoveRow = document.createElement('div');
                    currentMoveRow.className = 'move-row';
                    
                    const numCol = document.createElement('div');
                    numCol.className = 'move-number';
                    numCol.textContent = `${item.moveNumber}.`;
                    currentMoveRow.appendChild(numCol);
                }

                const moveBtn = document.createElement('button');
                moveBtn.className = 'move-btn';
                moveBtn.id = `ply-btn-${item.ply}`;
                
                const badgeConf = BADGES[item.classification] || BADGES.good;
                moveBtn.innerHTML = `<span>${item.san}</span><span class="move-glyph" style="color: ${badgeConf.color};">${badgeConf.icon}</span>`;
                
                moveBtn.addEventListener('click', () => goToPly(item.ply));

                if (currentMoveRow) {
                    currentMoveRow.appendChild(moveBtn);
                    if (!item.isWhite || i === timeline.length - 1) {
                        listEl.appendChild(currentMoveRow);
                    }
                }
            }
        }

        function highlightActiveMove(ply) {
            document.querySelectorAll('.move-btn').forEach(btn => btn.classList.remove('active-move'));
            if (ply > 0) {
                const activeBtn = document.getElementById(`ply-btn-${ply}`);
                if (activeBtn) {
                    activeBtn.classList.add('active-move');
                    activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }

        function renderClassificationMatrix(userCounts, oppCounts) {
            const matrixEl = document.getElementById('classificationMatrix');
            if (!matrixEl) return;

            const categories = [
                { key: 'brilliant', label: 'Brilliant', icon: '💎', color: '#00f2fe' },
                { key: 'great',     label: 'Great',     icon: '🌟', color: '#5c7cfa' },
                { key: 'best',      label: 'Best',      icon: '⭐', color: '#00e676' },
                { key: 'excellent', label: 'Excellent', icon: '👍', color: '#69db7c' },
                { key: 'good',      label: 'Good',      icon: '✔',  color: '#a9e34b' },
                { key: 'book',      label: 'Book',      icon: '📖', color: '#cc5de8' },
                { key: 'inaccuracy',label: 'Inaccuracy',icon: '🟡', color: '#ffd43b' },
                { key: 'mistake',   label: 'Mistake',   icon: '🟠', color: '#ff922b' },
                { key: 'miss',      label: 'Miss',      icon: '❌', color: '#ff6b6b' },
                { key: 'blunder',   label: 'Blunder',   icon: '🔴', color: '#ff1744' }
            ];

            let html = '';
            for (let cat of categories) {
                const uCount = userCounts[cat.key] || 0;
                const oCount = oppCounts[cat.key] || 0;
                html += `
                    <div class="matrix-row">
                        <span class="matrix-count count-user">${uCount}</span>
                        <div class="matrix-label" style="color: ${cat.color};">
                            <span class="matrix-icon">${cat.icon}</span> ${cat.label}
                        </div>
                        <span class="matrix-count count-opp">${oCount}</span>
                    </div>
                `;
            }
            matrixEl.innerHTML = html;
        }
    }

    // Filter tabs for Recent Games list
    function initFilterTabs() {
        const filterBtns = document.querySelectorAll('.game-filter-btn');
        const gameCards = document.querySelectorAll('.review-game-card');

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filter = btn.getAttribute('data-filter');
                gameCards.forEach(card => {
                    if (filter === 'all' || card.getAttribute('data-time-class') === filter) {
                        card.style.display = 'flex';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        });
    }

    // Run on DOM loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initGameReviewApp();
            initFilterTabs();
        });
    } else {
        initGameReviewApp();
        initFilterTabs();
    }
})();
