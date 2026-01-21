import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// -------------------------
// Firebase config
// -------------------------
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

// -------------------------
// DOM
// -------------------------
const statusEl = document.getElementById("status");
// const progressLabel = document.getElementById("progressLabel");
const img = document.getElementById("stimulus");
const wrap = document.getElementById("stimulusWrap");

// -------------------------
// Study IDs
// -------------------------
const studyId = "thesis_ped_localization_v1";
const participantId = crypto.randomUUID();
const participantCodeEl = document.getElementById("participantCode");
const participantCode = "P-" + participantId.replaceAll("-", "").slice(0, 6).toUpperCase();
participantCodeEl.textContent = participantCode;
let userUid = null;

// -------------------------
// Trials + state
// -------------------------
let trials = [];
let trialPos = -1;

let tStart = null;          // set when image is visible
let clicks = [];            // multiple pedestrians per image
let trialActive = false;

let experimentStarted = false;
let inFlight = false;       // prevents double-submission if Space is pressed rapidly

// Preload cache: src -> HTMLImageElement
const preloadCache = new Map();

// -------------------------
// Helpers: device + viewport logging
// -------------------------
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

// -------------------------
// Helpers: load trials manifest
// -------------------------
async function loadTrials() {
  const res = await fetch("./assets/trials.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load trials.json: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error("trials.json is empty/invalid");
  return data;
}

// -------------------------
// Helpers: shuffle (optional)
// -------------------------
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// -------------------------
// Preload logic
// -------------------------
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

// -------------------------
// Mapping click to normalised coords accounting for letterboxing
// -------------------------
function getDisplayedImageRect() {
  const wrapRect = wrap.getBoundingClientRect();
  const W = wrapRect.width;
  const H = wrapRect.height;

  const nW = img.naturalWidth;
  const nH = img.naturalHeight;
  if (!nW || !nH) return null;

  // object-fit: contain
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

// -------------------------
// Auth
// -------------------------
async function signInAnon() {
  statusEl.textContent = "Signing in...";
  const cred = await signInAnonymously(auth);
  userUid = cred.user.uid;
  console.log("Signed in. UID:", userUid);
}

// -------------------------
// Trial presentation
// -------------------------
async function showNextTrial() {
  trialPos += 1;
  clicks = [];
  tStart = null;
  trialActive = false;

  if (trialPos >= trials.length) {
    // progressLabel.textContent = `Completed ${trials.length} / ${trials.length}`;
    statusEl.textContent = "Done. Thank you.";
    wrap.classList.add("hidden");
    return;
  }

  const tr = trials[trialPos];

  // progressLabel.textContent = `Trial ${trialPos + 1} / ${trials.length}`;
  statusEl.textContent = `Loading trial ${trialPos + 1}/${trials.length}...`;
  wrap.classList.remove("hidden");

  // Preload current and next
  await ensurePreloaded(tr.src);
  if (trialPos + 1 < trials.length) preloadImage(trials[trialPos + 1].src);

  // Display
  img.src = tr.src;

  // Wait for decode (best-effort)
  await img.decode().catch(() => {});

  // Start timing after image is ready
  tStart = performance.now();
  trialActive = true;

  statusEl.textContent =
    `Trial ${trialPos + 1}/${trials.length}. Press Space to submit.`;

  console.log("Trial shown:", tr.imageId);
}

// -------------------------
// Save to Firestore (one doc per trial, with multiple clicks)
// -------------------------
async function submitCurrentTrial() {
  if (!trialActive) return;
  if (!userUid) throw new Error("Not signed in yet (userUid is null).");

  const tr = trials[trialPos];
  const device = getDeviceInfo();
  const vp = getViewportInfo();

  const payload = {
    studyId,
    participantId,
    firebaseUid: userUid,

    trialPos,
    sceneId: tr.sceneId,
    condition: tr.condition,
    imageId: tr.imageId,

    clicks,              // array of {xNorm, yNorm, rtMs}
    nClicks: clicks.length,

    ...device,
    ...vp,

    ts: serverTimestamp(),
  };

  console.log("Submitting payload keys:", Object.keys(payload).sort());
  await addDoc(collection(db, "responses"), payload);
}

// -------------------------
// Start experiment (Space)
// -------------------------
async function startExperiment() {
  if (experimentStarted) return;

  experimentStarted = true;
  inFlight = true;

  try {
    await signInAnon();
    trials = await loadTrials();
    shuffleInPlace(trials);

    // progressLabel.textContent = `Trial 1 / ${trials.length}`;
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

// -------------------------
// Events
// -------------------------

// Record click(s) (multiple pedestrians per image)
img.addEventListener("click", (evt) => {
  if (!trialActive || tStart === null) return;

  const xy = clickToNormXY(evt);
  if (!xy) return;

  const rtMs = Math.round(performance.now() - tStart);

  // Keep onset-based RT (recommended). If you later want inter-click intervals, store a second field.
  clicks.push({ xNorm: xy.xNorm, yNorm: xy.yNorm, rtMs });

  statusEl.textContent =
    `Recorded ${clicks.length} click(s). Press Space to submit.`;
});

// Space: start if not started; otherwise submit+advance
document.addEventListener("keydown", async (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();

  if (inFlight) return; // prevents rapid repeats
  inFlight = true;

  try {
    if (!experimentStarted) {
      statusEl.textContent = "Starting...";
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
