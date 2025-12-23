const video = document.getElementById('webcam');
const motionCanvas = document.getElementById('motion-canvas');
const motionCtx = motionCanvas.getContext('2d');
const audioBar = document.getElementById('audio-bar');
const motionBar = document.getElementById('motion-bar');
const audioStatus = document.getElementById('audio-status');
const videoStatus = document.getElementById('video-status');
const armBtn = document.getElementById('arm-btn');
const resetBtn = document.getElementById('reset-btn');
const instructionText = document.getElementById('instruction');
const resultPanel = document.getElementById('result-panel');
const reactionTimeDisplay = document.getElementById('reaction-time');

// Config
const THRESHOLDS = {
    AUDIO: 0.25, // Volume threshold for "LOUD beep"
    MOTION: 25   // Pixel Count threshold (scaled) for "MOVEMENT"
};

// State
let systemState = 'idle'; // idle, armed, complete
let audioContext;
let analyser;
let microphone;
let startTimestamp = 0; // When Audio Triggered
let movementTimestamp = 0; // When Video Triggered

// Buffers
let prevFrameData = null;

// --- Initialization ---

async function initSystem() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: {
                width: { ideal: 320 },
                height: { ideal: 240 },
                facingMode: 'environment' // Use back camera if available
            }
        });

        // Setup Video
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            motionCanvas.width = video.videoWidth;
            motionCanvas.height = video.videoHeight;
        };

        // Setup Audio
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        instructionText.textContent = "Système calibré. Prêt à armer.";

        // Start Loops
        processAudio();
        processVideo();

    } catch (err) {
        console.error("Access denied", err);
        instructionText.textContent = "Erreur : Accès Micro/Caméra refusé confirm in browser settings.";
        instructionText.style.color = "var(--danger-color)";
    }
}

// --- Setup ---
armBtn.addEventListener('click', () => {
    if (!audioContext) {
        initSystem().then(() => setArmed());
    } else {
        setArmed();
    }
});

resetBtn.addEventListener('click', resetSystem);

function setArmed() {
    // Resume audio context if suspended
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }

    systemState = 'armed';
    startTimestamp = 0;
    movementTimestamp = 0;

    // UI Updates
    resultPanel.classList.add('hidden');
    armBtn.classList.add('hidden');
    resetBtn.classList.remove('hidden');
    instructionText.textContent = "EN ATTENTE DU BIP...";
    audioStatus.textContent = "Écoute...";
    videoStatus.textContent = "Détection active...";
    videoStatus.classList.remove('active');
    audioStatus.classList.remove('active');

    document.body.style.borderColor = "var(--accent-color)";
}

function resetSystem() {
    systemState = 'idle';
    armBtn.classList.remove('hidden');
    resetBtn.classList.add('hidden');
    instructionText.textContent = "Prêt à armer.";
    audioStatus.textContent = "En attente";
    videoStatus.textContent = "Calme";
}

// --- Core Loops ---

function processAudio() {
    requestAnimationFrame(processAudio);

    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // Calculate Volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const volume = sum / dataArray.length;

    // Visualize
    const normalizedVol = Math.min(100, (volume / 255) * 400);
    audioBar.style.width = `${normalizedVol}%`;

    // Trigger Logic
    if (systemState === 'armed' && normalizedVol > (THRESHOLDS.AUDIO * 100)) {
        triggerAudioStart();
    }
}

function triggerAudioStart() {
    if (startTimestamp > 0) return; // Already triggered

    startTimestamp = performance.now();

    audioStatus.textContent = "BIP DÉTECTÉ";
    audioStatus.classList.add('active');

    // Check if movement already happened (False Start waiting for verification)
    if (movementTimestamp > 0) {
        finishCheck();
    }
}

function processVideo() {
    requestAnimationFrame(processVideo);

    if (!video || video.readyState !== 4) return;

    // Draw
    motionCtx.drawImage(video, 0, 0, motionCanvas.width, motionCanvas.height);

    const frameData = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
    const data = frameData.data;

    if (!prevFrameData) {
        prevFrameData = data; // Intentionally reference for first frame or copy? safer to copy
        prevFrameData = new Uint8ClampedArray(frameData.data);
        return;
    }

    let diffScore = 0;

    // Compare
    // Optimized: Check every 32nd byte (8th pixel)
    for (let i = 0; i < data.length; i += 32) {
        const rDiff = Math.abs(data[i] - prevFrameData[i]);
        const gDiff = Math.abs(data[i + 1] - prevFrameData[i + 1]);
        const bDiff = Math.abs(data[i + 2] - prevFrameData[i + 2]);

        if (rDiff + gDiff + bDiff > 100) {
            diffScore++;
            // Debug highlight
            data[i] = 0;
            data[i + 1] = 255;
            data[i + 2] = 0;
        }
    }

    motionCtx.putImageData(frameData, 0, 0);

    // Visualize Score
    const normalizedMotion = Math.min(100, (diffScore / THRESHOLDS.MOTION) * 50);
    motionBar.style.width = `${normalizedMotion}%`;

    // Trigger Logic
    if (systemState === 'armed' && diffScore > THRESHOLDS.MOTION) {
        triggerMotion();
    }

    // Save for next frame
    prevFrameData = new Uint8ClampedArray(frameData.data);
}

function triggerMotion() {
    if (movementTimestamp > 0) return;

    movementTimestamp = performance.now();
    videoStatus.textContent = "MOUVEMENT !";
    videoStatus.classList.add('active');

    // Check if audio already happened
    if (systemState === 'armed') {
        if (startTimestamp > 0) {
            finishCheck();
        } else {
            // Wait for audio to calculate negative time
            videoStatus.textContent = "FAUX DÉPART ?";
            videoStatus.style.color = "var(--danger-color)";
        }
    }
}

function finishCheck() {
    if (systemState === 'complete') return;
    systemState = 'complete';

    const reactionTime = Math.round(movementTimestamp - startTimestamp);

    reactionTimeDisplay.innerHTML = `${reactionTime} <span class="ms">ms</span>`;
    resultPanel.classList.remove('hidden');

    if (reactionTime < 0) {
        reactionTimeDisplay.style.color = "var(--danger-color)";
        instructionText.textContent = "⚠️ FAUX DÉPART ⚠️";
    } else {
        reactionTimeDisplay.style.color = "var(--accent-color)";
        instructionText.textContent = "Mesure terminée.";
    }
}
