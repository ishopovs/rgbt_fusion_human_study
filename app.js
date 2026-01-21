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
const instructionsEl = document.getElementById("instructions");
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");

const img = document.getElementById("stimulus");
const wrap = document.getElementById("stimulusWrap");

// -------------------------
// Study IDs
// -------------------------
const studyId = "thesis_ped_localization_v1";
const participantId = crypto.randomUUID();
let userUid = null;
let experimentStarted = false;

// -------------------------
// Trials + state
// -------------------------
let trials = [];
let trialPos = -1;
let tStart = null;           // trial timer start (after image shown)
let clicks = [];             // multiple pedestrians: store multiple clicks
let trialActive = false;

// Preload cache: src -> HTMLImageElement
const preloadCache = new Map();

statusEl.textContent = "Press Start. Then click the pedestrian location as fast as possible. Press Space to submit and go to the next image";
// showInstructions();


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
  // wait until loaded (or error)
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
  // wrapper size
  const wrapRect = wrap.getBoundingClientRect();
  const W = wrapRect.width;
  const H = wrapRect.height;

  // intrinsic image size
  const nW = img.naturalWidth;
  const nH = img.naturalHeight;
  if (!nW || !nH) return null;

  // "contain" fit into wrapper
  const scale = Math.min(W / nW, H / nH);
  const dispW = nW * scale;
  const dispH = nH * scale;

  // centered inside wrapper
  const left = wrapRect.left + (W - dispW) / 2;
  const top  = wrapRect.top  + (H - dispH) / 2;

  return { left, top, dispW, dispH };
}

function clickToNormXY(evt) {
  const r = getDisplayedImageRect();
  if (!r) return null;

  const x = evt.clientX - r.left;
  const y = evt.clientY - r.top;

  // ignore clicks outside the displayed image area (letterbox region)
  if (x < 0 || y < 0 || x > r.dispW || y > r.dispH) return null;

  return {
    xNorm: x / r.dispW,
    yNorm: y / r.dispH
  };
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
// Instructions (minimal fields)
// -------------------------
// function showInstructions() {
//   instructionsEl.classList.remove("hidden");
//   // instructionsEl.innerHTML = `
//   //   <b>Instructions</b><br/>
//   //   - You will see a sequence of images in different driving conditions.<br/>
//   //   - Click on <b>each pedestrian</b> you can see (multiple clicks allowed).<br/>
//   //   - When done with the image, press <b>Space</b> (or click Next) to continue.<br/>
//   //   - Try to respond as quickly and accurately as possible.<br/>
//   // `;
// }

// -------------------------
// Trial presentation
// -------------------------
async function showNextTrial() {
  trialPos += 1;
  clicks = [];
  tStart = null;
  trialActive = false;
  nextBtn.disabled = true;

  if (trialPos >= trials.length) {
    statusEl.textContent = "Done. Thank you!";
    wrap.classList.add("hidden");
    img.classList.add("hidden");
    nextBtn.classList.add("hidden");
    startBtn.disabled = true;
    startBtn.classList.add("hidden");
    return;
  }

  const tr = trials[trialPos];
  statusEl.textContent = `Loading trial ${trialPos + 1}/${trials.length}...`;
  wrap.classList.remove("hidden");
  nextBtn.classList.remove("hidden");

  // Preload current and (optionally) next
  await ensurePreloaded(tr.src);
  if (trialPos + 1 < trials.length) preloadImage(trials[trialPos + 1].src);

  // Display
  img.src = tr.src;

  // Wait until the displayed <img> has decoded
  await img.decode().catch(() => { /* decode not supported everywhere; onload will still work */ });

  // Start timing only now (image is ready to be seen)
  tStart = performance.now();
  trialActive = true;
  nextBtn.disabled = false;

  statusEl.textContent = `Trial ${trialPos + 1}/${trials.length}: click pedestrians (count=${clicks.length}). Press Space/Next to submit.`;
}

// -------------------------
// Save to Firestore (one doc per trial, with multiple clicks)
// -------------------------
async function submitCurrentTrial() {
  if (!trialActive) return; // nothing to submit

  const tr = trials[trialPos];
  const device = getDeviceInfo();
  const vp = getViewportInfo();

  // allow submission even with 0 clicks (useful for "no pedestrian" images)
  const payload = {
    studyId,
    participantId,
    firebaseUid: userUid,

    trialPos,
    sceneId: tr.sceneId,
    condition: tr.condition,
    imageId: tr.imageId,

    // multiple pedestrians per image
    clicks,              // array of {xNorm, yNorm, rtMs}
    nClicks: clicks.length,

    // context logging
    ...device,
    ...vp,

    ts: serverTimestamp(),
  };

  await addDoc(collection(db, "responses"), payload);
}

async function startExperiment() {
  if (experimentStarted) return;
  experimentStarted = true;

  startBtn.disabled = true;
  startBtn.classList.add("hidden");

  await signInAnon();
  trials = await loadTrials();
  shuffleInPlace(trials);

  statusEl.textContent = "Starting...";
  await showNextTrial();
}


// -------------------------
// Events
// -------------------------
startBtn.addEventListener("click", async () => {
  try {
    await startExperiment();
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Start failed: ${e.code || e.message}`;
    experimentStarted = false;
    startBtn.disabled = false;
    startBtn.classList.remove("hidden");
  }
});

document.addEventListener("keydown", async (e) => {
  if (e.code !== "Enter") return;
  if (experimentStarted) return;

  e.preventDefault();
  try {
    await startExperiment();
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Start failed: ${err.code || err.message}`;
    experimentStarted = false;
  }
});

// record click(s)
img.addEventListener("click", (evt) => {
  if (!trialActive || tStart === null) return;

  const xy = clickToNormXY(evt);
  if (!xy) return; // click in letterbox area

  const rtMs = Math.round(performance.now() - tStart);
  // Reset timer to count response time for multiple objects
  tStart = performance.now();
  clicks.push({ xNorm: xy.xNorm, yNorm: xy.yNorm, rtMs });

  statusEl.textContent = `Recorded ${clicks.length} click(s). Press Space/Next to submit.`;
});

// submit on Next
nextBtn.addEventListener("click", async () => {
  if (!trialActive) return;
  nextBtn.disabled = true;
  statusEl.textContent = "Saving...";
  try {
    await submitCurrentTrial();
    statusEl.textContent = "Saved.";
    await showNextTrial();
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Save failed: ${e.code || e.message}`;
    nextBtn.disabled = false;
  }
});

// submit on Space
document.addEventListener("keydown", async (e) => {
  if (e.code !== "Space") return;
  if (!trialActive) return;

  e.preventDefault(); // prevents page scrolling
  nextBtn.disabled = true;
  statusEl.textContent = "Saving...";
  try {
    await submitCurrentTrial();
    statusEl.textContent = "Saved.";
    await showNextTrial();
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Save failed: ${err.code || err.message}`;
    nextBtn.disabled = false;
  }
});
