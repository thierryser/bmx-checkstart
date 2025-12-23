const video = document.getElementById('webcam');
const motionCanvas = document.getElementById('motion-canvas');
const motionCtx = motionCanvas.getContext('2d');
const targetGate = document.getElementById('target-gate');
const targetPilot = document.getElementById('target-pilot');
const barGate = document.getElementById('bar-gate');
const barPilot = document.getElementById('bar-pilot');
const mainStatus = document.getElementById('main-status');
const videoContainer = document.getElementById('video-container');

const armBtn = document.getElementById('arm-btn');
const setupBtn = document.getElementById('setup-btn');
const resetBtn = document.getElementById('reset-btn');
const resultPanel = document.getElementById('result-panel');
const reactionTimeDisplay = document.getElementById('reaction-time');
const resultDetail = document.getElementById('result-detail');
const instructionText = document.getElementById('instruction');

// History UI
const historyPanelUi = document.getElementById('history-panel-ui');
const historyListEl = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// Config
const CONFIG = {
    RADIUS: 15,
    THRESHOLD_LOW: 8,
    THRESHOLD_HIGH: 25,
    STABILIZATION_MS: 2000
};

// State
let systemState = 'setup';
let gateTimestamp = 0;
let pilotTimestamp = 0;

let gateCandidate = 0;
let pilotCandidate = 0;

let prevFrameDataGate = null;
let prevFrameDataPilot = null;
let targetStep = 0;
let armingTimeout = null;

// Coordinates
let targets = {
    gate: { x: -100, y: -100, set: false },
    pilot: { x: -100, y: -100, set: false }
};

// History State
let history = JSON.parse(localStorage.getItem('bmx_history')) || [];

// --- Initialization ---

async function initSystem() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'environment'
            }
        });

        video.srcObject = stream;
        video.onloadedmetadata = () => {
            motionCanvas.width = video.videoWidth;
            motionCanvas.height = video.videoHeight;
        };

        // Start Loop
        processVideo();
        renderHistory();

    } catch (err) {
        console.error("Access denied", err);
        mainStatus.textContent = "ERREUR VIDEO";
        mainStatus.style.color = "var(--danger-color)";
    }
}

// --- History Logic ---

function addToHistory(value) {
    const item = {
        value: value,
        isValid: true, // Always valid now
        timestamp: new Date().toLocaleTimeString()
    };

    // Add to front
    history.unshift(item);

    // Keep max 10
    if (history.length > 10) {
        history.pop();
    }

    saveHistory();
    renderHistory();
}

function saveHistory() {
    localStorage.setItem('bmx_history', JSON.stringify(history));
}

function renderHistory() {
    if (history.length === 0) {
        historyPanelUi.classList.add('hidden');
        return;
    }

    historyPanelUi.classList.remove('hidden');
    historyListEl.innerHTML = '';

    history.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'history-item valid';

        li.innerHTML = `
            <span>#${index + 1}</span>
            <span>${item.value} ms</span>
        `;
        historyListEl.appendChild(li);
    });
}

clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Effacer l\'historique ?')) {
        history = [];
        saveHistory();
        renderHistory();
    }
});

// --- Targeting Logic ---

videoContainer.addEventListener('mousedown', handleInput);
videoContainer.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleInput(e.touches[0]);
});

function handleInput(e) {
    if (systemState !== 'setup') return;

    const rect = videoContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = motionCanvas.width / rect.width;
    const scaleY = motionCanvas.height / rect.height;

    const canvasX = Math.round(x * scaleX);
    const canvasY = Math.round(y * scaleY);

    if (targetStep === 0) {
        setTarget('gate', x, y, canvasX, canvasY);
        instructionText.textContent = "Maintenant, touchez le PILOTE (Rouge).";
        targetStep = 1;
    } else {
        setTarget('pilot', x, y, canvasX, canvasY);
        instructionText.textContent = "Cibles prêtes. Appuyez sur ARMER.";
        armBtn.disabled = false;
        targetStep = 2;
    }
}

function setTarget(type, uiX, uiY, canvasX, canvasY) {
    const el = (type === 'gate') ? targetGate : targetPilot;
    el.style.left = `${uiX}px`;
    el.style.top = `${uiY}px`;
    el.classList.remove('hidden');

    targets[type] = { x: canvasX, y: canvasY, set: true };
}

// --- System Control ---

setupBtn.addEventListener('click', () => {
    systemState = 'setup';
    targetStep = 0;
    targets.gate.set = false;
    targets.pilot.set = false;

    targetGate.classList.add('hidden');
    targetPilot.classList.add('hidden');

    armBtn.disabled = true;
    mainStatus.textContent = "SETUP";
    instructionText.textContent = "Touchez la GRILLE (Bleu)...";
});

armBtn.addEventListener('click', () => {
    if (!video.srcObject) {
        initSystem().then(armSystem);
    } else {
        armSystem();
    }
});

resetBtn.addEventListener('click', resetSystem);

function armSystem() {
    if (!targets.gate.set || !targets.pilot.set) return;

    // Reset loop vars
    gateTimestamp = 0;
    pilotTimestamp = 0;
    gateCandidate = 0;
    pilotCandidate = 0;
    prevFrameDataGate = null;
    prevFrameDataPilot = null;

    // UI Update
    armBtn.classList.add('hidden');
    setupBtn.classList.add('hidden');
    resultPanel.classList.add('hidden');
    targetGate.classList.remove('active');
    targetPilot.classList.remove('active');

    // Start Stabilization Delay
    systemState = 'arming';
    mainStatus.textContent = "STABILISATION...";
    mainStatus.style.color = "orange";

    if (armingTimeout) clearTimeout(armingTimeout);

    armingTimeout = setTimeout(() => {
        systemState = 'armed';
        mainStatus.textContent = "EN ATTENTE GRILLE...";
        mainStatus.style.color = "var(--secondary-accent)";
        prevFrameDataGate = null;
        prevFrameDataPilot = null;
    }, CONFIG.STABILIZATION_MS);
}

function resetSystem() {
    armSystem();
    setupBtn.classList.remove('hidden');
}

// --- Video Processing ---

function processVideo() {
    requestAnimationFrame(processVideo);
    if (!video || video.readyState !== 4) return;

    motionCtx.drawImage(video, 0, 0, motionCanvas.width, motionCanvas.height);

    if (systemState === 'setup' || !targets.gate.set || !targets.pilot.set) return;

    // IMPORTANT: Analyze both continuously to keep buffers fresh
    const gateDiff = analyzeTarget(targets.gate, 'gate');
    const pilotDiff = analyzeTarget(targets.pilot, 'pilot');

    // Visuals
    const amp = 4;
    barGate.style.width = `${Math.min(100, gateDiff * amp)}%`;
    barPilot.style.width = `${Math.min(100, pilotDiff * amp)}%`;

    if (gateCandidate > 0) barGate.style.backgroundColor = 'orange';
    else barGate.style.backgroundColor = 'var(--secondary-accent)';

    if (pilotCandidate > 0) barPilot.style.backgroundColor = 'orange';
    else barPilot.style.backgroundColor = 'var(--danger-color)';

    // Logic: ARMED
    if (systemState === 'armed') {

        // 1. GATE Logic
        if (gateTimestamp === 0) {
            if (gateDiff > CONFIG.THRESHOLD_HIGH) {
                if (gateCandidate === 0) gateCandidate = performance.now();
                gateTimestamp = gateCandidate;
                triggerGate();

                // Update Status
                mainStatus.textContent = "GRILLE OK ! ATTENTE PILOTE...";
                mainStatus.style.color = "var(--danger-color)";

            } else if (gateDiff > CONFIG.THRESHOLD_LOW) {
                if (gateCandidate === 0) gateCandidate = performance.now();
            } else {
                gateCandidate = 0;
            }
        }

        // 2. PILOT Logic (ONLY if Gate is detected)
        // This effectively ignores any pilot movement occurring BEFORE gate drop
        if (gateTimestamp > 0 && pilotTimestamp === 0) {
            if (pilotDiff > CONFIG.THRESHOLD_HIGH) {
                if (pilotCandidate === 0) pilotCandidate = performance.now();
                pilotTimestamp = pilotCandidate;
                triggerPilot();
            } else if (pilotDiff > CONFIG.THRESHOLD_LOW) {
                if (pilotCandidate === 0) pilotCandidate = performance.now();
            } else {
                pilotCandidate = 0;
            }
        }

        if (gateTimestamp > 0 && pilotTimestamp > 0) {
            finishCheck();
        }
    }
}

function analyzeTarget(wb, type) {
    const r = CONFIG.RADIUS;
    let sx = wb.x - r;
    let sy = wb.y - r;
    const dim = r * 2;

    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;

    const frameData = motionCtx.getImageData(sx, sy, dim, dim);
    const data = frameData.data;

    let prevBuffer = (type === 'gate') ? prevFrameDataGate : prevFrameDataPilot;

    if (!prevBuffer || prevBuffer.length !== data.length) {
        const buf = new Uint8ClampedArray(data);
        if (type === 'gate') prevFrameDataGate = buf;
        else prevFrameDataPilot = buf;
        return 0;
    }

    let diffScore = 0;
    for (let i = 0; i < data.length; i += 4) {
        const rDiff = Math.abs(data[i] - prevBuffer[i]);
        const gDiff = Math.abs(data[i + 1] - prevBuffer[i + 1]);
        const bDiff = Math.abs(data[i + 2] - prevBuffer[i + 2]);

        if (rDiff + gDiff + bDiff > 60) {
            diffScore++;
        }
    }

    const newBuf = new Uint8ClampedArray(data);
    if (type === 'gate') prevFrameDataGate = newBuf;
    else prevFrameDataPilot = newBuf;

    return (diffScore / (dim * dim)) * 1000;
}

function triggerGate() {
    targetGate.classList.add('active');
}

function triggerPilot() {
    targetPilot.classList.add('active');
}

function finishCheck() {
    systemState = 'complete';

    resetBtn.classList.remove('hidden');
    resultPanel.classList.remove('hidden');
    setupBtn.classList.remove('hidden');

    const diff = Math.round(pilotTimestamp - gateTimestamp);
    reactionTimeDisplay.innerHTML = `${diff} <span class="ms">ms</span>`;

    reactionTimeDisplay.classList.remove('negative');
    resultDetail.textContent = "Temps de réaction valide.";
    mainStatus.textContent = "TERMINÉ";
    addToHistory(diff);

    setTimeout(() => {
        targetGate.classList.remove('active');
        targetPilot.classList.remove('active');
    }, 2000);
}
