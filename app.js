import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// 1) Paste your config from Firebase console here
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  appId: "...",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Simple trial list (replace with your real assets + conditions)
const trials = [
  { imageId: "img01_rgb", src: "./assets/img01_rgb.jpg", condition: "rgb" },
  { imageId: "img01_fused", src: "./assets/img01_fused.jpg", condition: "fused" },
  // ...
];

const studyId = "thesis_ped_localization_v1";
let participantId = crypto.randomUUID();          // anonymous local ID
let userUid = null;
let trialIndex = -1;
let tStart = null;

const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const wrap = document.getElementById("stimulusWrap");
const img = document.getElementById("stimulus");

const nextBtn = document.getElementById("nextBtn");
let pendingResponse = null;


async function ensureAnonAuth() {
  const cred = await signInAnonymously(auth);
  userUid = cred.user.uid;
}

function showNextTrial() {
  trialIndex += 1;
  pendingResponse = null;
  nextBtn.disabled = true;

  if (trialIndex >= trials.length) {
    statusEl.textContent = "Done. Thank you.";
    wrap.classList.add("hidden");
    nextBtn.classList.add("hidden");
    return;
  }

  const tr = trials[trialIndex];
  img.src = tr.src;

  img.onload = () => {
    wrap.classList.remove("hidden");
    nextBtn.classList.remove("hidden");
    statusEl.textContent = `Trial ${trialIndex + 1}/${trials.length}: click the pedestrian location, then press Next.`;
    tStart = performance.now();
  };
}


function clickToNormXY(evt) {
  const rect = img.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top) / rect.height;
  return { xNorm: Math.min(1, Math.max(0, x)), yNorm: Math.min(1, Math.max(0, y)) };
}

img.addEventListener("click", async (evt) => {
  if (tStart === null) return;
  const rtMs = Math.round(performance.now() - tStart);
  const { xNorm, yNorm } = clickToNormXY(evt);
  const tr = trials[trialIndex];

  // Store ONE record per trial
  await addDoc(collection(db, "responses"), {
    studyId,
    participantId,
    firebaseUid: userUid,            // optional; you can omit to reduce identifiers
    trialIndex,
    condition: tr.condition,
    imageId: tr.imageId,
    rtMs,
    xNorm,
    yNorm,
    ts: serverTimestamp(),
  });

  tStart = null;
  showNextTrial();
});

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  statusEl.textContent = "Signing in...";
  await ensureAnonAuth();            // Anonymous auth is the key for rules-based writes :contentReference[oaicite:6]{index=6}
  statusEl.textContent = "Loading...";
  showNextTrial();
});

img.addEventListener("click", (evt) => {
  if (tStart === null) return;

  const rtMs = Math.round(performance.now() - tStart);
  const { xNorm, yNorm } = clickToNormXY(evt);
  const tr = trials[trialIndex];

  pendingResponse = { rtMs, xNorm, yNorm, condition: tr.condition, imageId: tr.imageId };
  nextBtn.disabled = false;

  // prevent re-click changing RT; allow if you prefer
  tStart = null;

  statusEl.textContent = `Recorded. Press Next.`;
});

nextBtn.addEventListener("click", async () => {
  if (!pendingResponse) return;
  nextBtn.disabled = true;

  await addDoc(collection(db, "responses"), {
    studyId,
    participantId,
    trialIndex,
    condition: pendingResponse.condition,
    imageId: pendingResponse.imageId,
    rtMs: pendingResponse.rtMs,
    xNorm: pendingResponse.xNorm,
    yNorm: pendingResponse.yNorm,
    ts: serverTimestamp(),
  });

  showNextTrial();
});


