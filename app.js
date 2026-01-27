import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* =========================================================
   Firebase config
========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyCJMsriYRyR6Wl6ky3T2AbUJVK2Z3x54ss",
  authDomain: "rgbt-fusion-human-study.firebaseapp.com",
  projectId: "rgbt-fusion-human-study",
  storageBucket: "rgbt-fusion-human-study.firebasestorage.app",
  messagingSenderId: "101524489707",
  appId: "1:101524489707:web:e4b4c43200733cee2485ae"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log("Firebase initialized:", app.options.projectId);

/* =========================================================
   DOM
========================================================= */
const statusEl = document.getElementById("status");
const participantCodeEl = document.getElementById("participantCode");

const img = document.getElementById("stimulus");
const wrap = document.getElementById("stimulusWrap");

// Instruction overlay DOM (must exist in HTML)
const overlay = document.getElementById("instructionOverlay");
const startOverlayBtn = document.getElementById("startExperimentBtn");

/* =========================================================
   Participant ID (per browser tab/session)
========================================================= */
const SS_KEY_PID = "pedstudy_participantId_v1";
let participantId = sessionStorage.getItem(SS_KEY_PID);
if (!participantId) {
  participantId = crypto.randomUUID();
  sessionStorage.setItem(SS_KEY_PID, participantId);
}

/* =========================================================
   Helper: stable type assignment from participantId
========================================================= */
function hashToUint32(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function getParticipantType() {
  return hashToUint32(participantId) % 3; // 0,1,2
}

// Compute participant trial type once (global)
const trialType = getParticipantType();
console.log("Assigned trialType:", trialType);

/* =========================================================
   Study IDs + display code
========================================================= */
const studyId = "thesis_ped_localization_v1";
const participantCode = "P-" + participantId.replaceAll("-", "").slice(0, 6).toUpperCase();
if (participantCodeEl) participantCodeEl.textContent = participantCode;

let userUid = null;

/* =========================================================
   Practice trials (fixed, shown first, can discard in analysis)
   Conditions fixed: RGB -> methodA -> methodB
   Scene IDs fixed:  T01S01, T02S02, T03S03
========================================================= */
const PRACTICE_TRIALS = [
  { sceneId: "T01S01", condition: "RGB" },
  { sceneId: "T02S02", condition: "methodA" },
  { sceneId: "T03S03", condition: "methodB" },
];

/* =========================================================
   Main trials: fixed scene order (your chosen order)
========================================================= */
const MAIN_SCENE_ORDER = [
  "G01S03","G02S12","G03S24","G02S11","G03S18","G01S04","G01S08","G02S16",
  "G03S19","G01S01","G02S13","G03S22","G03S17","G01S06","G02S10","G01S05",
  "G03S23","G02S09","G03S21","G02S15","G01S02","G02S14","G03S20","G01S07"
];

/* =========================================================
   Map group + type -> folder for MAIN trials
   Rotation:
   Type 0: G01->RGB,     G02->methodA, G03->methodB
   Type 1: G01->methodA, G02->methodB, G03->RGB
   Type 2: G01->methodB, G02->RGB,     G03->methodA
========================================================= */
function folderFor(groupStr, type) {
  if (type === 0) {
    if (groupStr === "G01") return "RGB";
    if (groupStr === "G02") return "methodA";
    return "methodB";
  }
  if (type === 1) {
    if (groupStr === "G01") return "methodA";
    if (groupStr === "G02") return "methodB";
    return "RGB";
  }
  // type === 2
  if (groupStr === "G01") return "methodB";
  if (groupStr === "G02") return "RGB";
  return "methodA";
}

/* =========================================================
   Build trials: practice first (fixed), then main (type-rotated)
========================================================= */
function buildTrialsFixedOrder() {
  const type = trialType;
  console.log("ParticipantId:", participantId, "Type:", type);

  const practice = PRACTICE_TRIALS.map((p, idx) => ({
    trialPos: idx,                 // 0..2
    sceneId: p.sceneId,            // e.g., "T01S01"
    group: "T",                    // practice group tag
    condition: p.condition,        // fixed: RGB/methodA/methodB
    imageId: `${p.condition}_${p.sceneId}`,
    src: `./trial/${p.condition}/${p.sceneId}.jpg`,
    isPractice: true,
  }));

  const main = MAIN_SCENE_ORDER.map((sceneId, i) => {
    const groupStr = sceneId.slice(0, 3);  // "G01"/"G02"/"G03"
    const folder = folderFor(groupStr, type);
    return {
      trialPos: PRACTICE_TRIALS.length + i, // 3..26
      sceneId,
      group: groupStr,
      condition: folder,
      imageId: `${folder}_${sceneId}`,
      src: `./trial/${folder}/${sceneId}.jpg`,
      isPractice: false,
    };
  });

  return [...practice, ...main];
}

/* =========================================================
   Trials + state
========================================================= */
let trials = [];
let trialPos = -1;

let tStart = null;          // set when image is visible
let trialShownAt = null;   // when the current image becomes visible (ms)
let dwellMs = null;        // total time spent on current image (ms)

let clicks = [];            // multiple pedestrians per image
let trialActive = false;

let experimentStarted = false;
let inFlight = false;       // prevents double submission

// Preload cache: src -> HTMLImageElement
const preloadCache = new Map();

/* =========================================================
   Helpers: device + viewport logging
========================================================= */
function getDeviceInfo() {
  const ua = navigator.userAgent || "";
  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const deviceType = (isMobileUA || isTouch) ? "mobile_or_touch" : "desktop";

  return {
    deviceType,
    userAgent: ua,
    platform: navigator.platform || "",
    devicePixelRatio: window.devicePixelRatio || 1
  };
}

function getViewportInfo() {
  return {
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    screenW: window.screen?.width ?? null,
    screenH: window.screen?.height ?? null
  };
}

/* =========================================================
   Preload logic
========================================================= */
function preloadImage(src) {
  if (preloadCache.has(src)) return preloadCache.get(src);
  const im = new Image();
  im.src = src;
  preloadCache.set(src, im);
  return im;
}

async function ensurePreloaded(src) {
  const im = preloadImage(src);
  if (im.complete && im.naturalWidth > 0) return im;

  await new Promise((resolve, reject) => {
    im.onload = () => resolve();
    im.onerror = () => reject(new Error(`Preload failed: ${src}`));
  });

  return im;
}

/* =========================================================
   Click mapping with object-fit: contain (ignore letterboxing)
========================================================= */
function getDisplayedImageRect() {
  const wrapRect = wrap.getBoundingClientRect();
  const W = wrapRect.width;
  const H = wrapRect.height;

  const nW = img.naturalWidth;
  const nH = img.naturalHeight;
  if (!nW || !nH) return null;

  const scale = Math.min(W / nW, H / nH);
  const dispW = nW * scale;
  const dispH = nH * scale;

  const left = wrapRect.left + (W - dispW) / 2;
  const top  = wrapRect.top  + (H - dispH) / 2;

  return { left, top, dispW, dispH };
}

function clickToNormXY(evt) {
  const r = getDisplayedImageRect();
  if (!r) return null;

  const x = evt.clientX - r.left;
  const y = evt.clientY - r.top;

  // Ignore clicks in letterbox region
  if (x < 0 || y < 0 || x > r.dispW || y > r.dispH) return null;

  return { xNorm: x / r.dispW, yNorm: y / r.dispH };
}

/* =========================================================
   Auth
========================================================= */
async function signInAnon() {
  statusEl.textContent = "Signing in...";
  const cred = await signInAnonymously(auth);
  userUid = cred.user.uid;
  console.log("Signed in. UID:", userUid);
}

/* =========================================================
   Trial presentation
========================================================= */
async function showNextTrial() {
  trialPos += 1;
  clicks = [];
  tStart = null;
  trialActive = false;

  trialShownAt = null;
  dwellMs = null;

  if (trialPos >= trials.length) {
    statusEl.textContent = "Done. Thank you.";
    wrap.classList.add("hidden");

    // Allow a new participant immediately in the same tab after completion
    sessionStorage.removeItem(SS_KEY_PID);
    return;
  }

  const tr = trials[trialPos];

  statusEl.textContent = `Loading trial ${trialPos + 1}/${trials.length}...`;
  wrap.classList.remove("hidden");

  // Preload current and next
  await ensurePreloaded(tr.src);
  if (trialPos + 1 < trials.length) preloadImage(trials[trialPos + 1].src);

  // Display
  img.src = tr.src;

  // Decode best-effort
  await img.decode().catch(() => {});

  // Start timing after image is ready
  // tStart = performance.now();
  trialShownAt = performance.now();
  tStart = trialShownAt;   // keep your click RT reference the same
  trialActive = true;
   
  const practiceTag = tr.isPractice ? " (practice)" : "";
  statusEl.textContent =
    `Trial ${trialPos + 1}/${trials.length}${practiceTag}. Click people, press Space to submit.`;

  console.log("Trial shown:", tr.imageId);
}

/* =========================================================
   Save to Firestore (one doc per trial, multiple clicks)
========================================================= */
async function submitCurrentTrial() {
  if (!trialActive) return;
  if (!userUid) throw new Error("Not signed in yet (userUid is null).");

  const tr = trials[trialPos];
  const device = getDeviceInfo();
  const vp = getViewportInfo();

  dwellMs = (trialShownAt == null) ? null : Math.round(performance.now() - trialShownAt);

  const payload = {
    studyId,
    participantId,
    firebaseUid: userUid,

    trialType,          // 0/1/2
    isPractice: tr.isPractice === true,

    trialPos,
    sceneId: tr.sceneId,
    condition: tr.condition,
    imageId: tr.imageId,

    clicks,             // array of {xNorm, yNorm, rtMs}
    nClicks: clicks.length,

    dwellMs,

    ...device,
    ...vp,

    ts: serverTimestamp(),
  };

  console.log("Submitting payload keys:", Object.keys(payload).sort());
  await addDoc(collection(db, "responses"), payload);
}

/* =========================================================
   Start experiment (called after overlay dismiss)
========================================================= */
async function startExperiment() {
  if (experimentStarted) return;

  experimentStarted = true;
  inFlight = true;

  try {
    await signInAnon();
    trials = buildTrialsFixedOrder(); // practice + main (fixed order)

    statusEl.textContent = "Starting...";
    await showNextTrial();
  } catch (e) {
    console.error(e);
    experimentStarted = false;
    statusEl.textContent = `Start failed: ${e.code || e.message}`;
  } finally {
    inFlight = false;
  }
}

/* =========================================================
   Instruction overlay wiring
========================================================= */
function isOverlayVisible() {
  return overlay && overlay.style.display !== "none";
}

function dismissOverlayAndStart() {
  if (overlay) overlay.style.display = "none";
  statusEl.textContent = "Starting...";
  startExperiment();
}

// Ensure overlay is visible on load (if present in HTML)
if (overlay && overlay.style.display === "") {
  overlay.style.display = "flex";
}

if (startOverlayBtn) {
  startOverlayBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (inFlight) return;
    dismissOverlayAndStart();
  });
}

// Allow Space/Enter to start while overlay is visible
document.addEventListener("keydown", (e) => {
  if (!isOverlayVisible()) return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (inFlight) return;
    dismissOverlayAndStart();
  }
});

/* =========================================================
   Events: clicks + Space navigation
========================================================= */

// Record click(s)
img.addEventListener("click", (evt) => {
  if (!trialActive || tStart === null) return;

  const xy = clickToNormXY(evt);
  if (!xy) return;

  const rtMs = Math.round(performance.now() - tStart);

  // Onset-based RT for each click (recommended for now).
  // If later you want inter-click intervals, reset tStart here and store two RT fields.
  clicks.push({ xNorm: xy.xNorm, yNorm: xy.yNorm, rtMs });

  statusEl.textContent = `Recorded ${clicks.length} click(s). Press Space to submit.`;
});

// Space: submit + next (overlay already handled above)
document.addEventListener("keydown", async (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();

  // If overlay visible, ignore here (handled by overlay handler)
  if (isOverlayVisible()) return;

  if (inFlight) return;
  inFlight = true;

  try {
    if (!experimentStarted) {
      // Fallback: allow Space-to-start if overlay removed for some reason
      await startExperiment();
      return;
    }

    if (!trialActive) return;

    statusEl.textContent = "Saving...";
    await submitCurrentTrial();

    statusEl.textContent = "Saved.";
    await showNextTrial();
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Save failed: ${err.code || err.message}`;
  } finally {
    inFlight = false;
  }
});
