// APP VERSION: 2026-01-20-2
console.log("APP VERSION: 2026-01-20-2");

// -------------------------
// Imports (MUST be at top)
// -------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// -------------------------
// Firebase init
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
const startBtn = document.getElementById("startBtn");
const img = document.getElementById("stimulus");
const wrap = document.getElementById("stimulusWrap");

// -------------------------
// Study constants
// -------------------------
const studyId = "thesis_ped_localization_v1";
const participantId = crypto.randomUUID();
const ONE_IMAGE_SRC = "./assets/Picture1.jpg"; // <-- set this to a real image

let userUid = null;
let tStart = null;

// -------------------------
// Helpers
// -------------------------
async function signInAnon() {
  statusEl.textContent = "Signing in...";
  console.log("Attempting anonymous sign-in...");
  const cred = await signInAnonymously(auth);
  userUid = cred.user.uid;
  console.log("Signed in. UID:", userUid);
  statusEl.textContent = "Signed in.";
}

function clickToNormXY(evt) {
  const rect = img.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top) / rect.height;
  return {
    xNorm: Math.min(1, Math.max(0, x)),
    yNorm: Math.min(1, Math.max(0, y)),
  };
}

async function saveResponse({ rtMs, xNorm, yNorm }) {
  const docRef = await addDoc(collection(db, "responses"), {
    studyId,
    participantId,
    firebaseUid: userUid, // optional; remove if you prefer
    imageId: "example_image",
    condition: "debug_single_image",
    rtMs,
    xNorm,
    yNorm,
    ts: serverTimestamp(),
  });
  console.log("Saved response with ID:", docRef.id);
}

function startOneImageTrial() {
  statusEl.textContent = "Loading image...";
  wrap.classList.remove("hidden");

  img.onload = () => {
    statusEl.textContent = "Click the pedestrian location.";
    tStart = performance.now();
    console.log("Image shown; timer started.");
  };

  img.onerror = () => {
    statusEl.textContent = "Image failed to load. Check ONE_IMAGE_SRC path.";
    console.error("Image load failed:", ONE_IMAGE_SRC);
  };

  img.src = ONE_IMAGE_SRC;
}

// -------------------------
// UI events
// -------------------------
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    await signInAnon();
    startOneImageTrial();
  } catch (e) {
    console.error("Start failed:", e);
    statusEl.textContent = `Start failed: ${e.code || e.message}`;
  } finally {
    startBtn.disabled = false;
  }
});

img.addEventListener("click", async (evt) => {
  if (tStart === null) return;

  const rtMs = Math.round(performance.now() - tStart);
  const { xNorm, yNorm } = clickToNormXY(evt);

  tStart = null; // stop timing immediately
  statusEl.textContent = `Saving... RT=${rtMs} ms`;

  try {
    await saveResponse({ rtMs, xNorm, yNorm });
    statusEl.textContent = "Saved. Thank you.";
  } catch (e) {
    console.error("Firestore write failed:", e);
    statusEl.textContent = `Save failed: ${e.code || e.message}`;
  }
});
