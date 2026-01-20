import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import { collection, addDoc, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCJMsriYRyR6Wl6ky3T2AbUJVK2Z3x54ss",
  authDomain: "rgbt-fusion-human-study.firebaseapp.com",
  projectId: "rgbt-fusion-human-study",
  storageBucket: "rgbt-fusion-human-study.firebasestorage.app",
  messagingSenderId: "101524489707",
  appId: "1:101524489707:web:e4b4c43200733cee2485ae"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
console.log("Firebase initialized:", app.options.projectId);

//Enable anonymous Sign-In

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
let trialPos = -1;      // index into trials in the order shown to this participant
let pending = null;     // stores click result until Next is pressed
let userUid = null;

async function signInAnon() {
  statusEl.textContent = "Signing in...";
  console.log("Attempting anonymous sign-in...");

  try {
    const cred = await signInAnonymously(auth);
    userUid = cred.user.uid;
    console.log("Signed in. UID:", cred.user.uid);
    statusEl.textContent = "Signed in successfully.";
    return cred.user.uid;
  } catch (e) {
    console.error("Anonymous sign-in failed:", e);
    statusEl.textContent = `Sign-in failed: ${e.code || e.message}`;
    throw e;
  }
}
// startBtn.addEventListener("click", async () => {
//   startBtn.disabled = true;
//   try {
//     await signInAnon();
//   } finally {
//     startBtn.disabled = false;
//   }
// });

// Block 3: Show one image, start timer when it is visible, log click RT + normalised coords
const img = document.getElementById("stimulus");
const wrap = document.getElementById("stimulusWrap");

const ONE_IMAGE_SRC = "./assets/Picture1.jpg";
const trials = [
  { sceneId: "s01", condition: "fused",   imageId: "s01_fused",   src: "./assets/Picture1.jpg" },
  { sceneId: "s02", condition: "fused", imageId: "s02_fused", src: "./assets/Picture9.jpg" },
  // add more...
];

let tStart = null;

// function startOneImageTrial() {
//   statusEl.textContent = "Loading image...";
//   wrap.classList.remove("hidden");

//   img.onload = () => {
//     statusEl.textContent = "Click the pedestrian location.";
//     tStart = performance.now();
//     console.log("Image shown; timer started.");
//   };

//   img.onerror = () => {
//     statusEl.textContent = "Image failed to load. Check the path.";
//     console.error("Image load failed:", ONE_IMAGE_SRC);
//   };

//   img.src = ONE_IMAGE_SRC; // triggers loading + display
// }

function showNextTrial() {
  trialPos += 1;
  pending = null;
  nextBtn.disabled = true;

  if (trialPos >= trials.length) {
    statusEl.textContent = "Done. Thank you.";
    wrap.classList.add("hidden");
    nextBtn.classList.add("hidden");
    return;
  }

  const tr = trials[trialPos];

  statusEl.textContent = `Loading trial ${trialPos + 1}/${trials.length}...`;
  wrap.classList.remove("hidden");
  nextBtn.classList.remove("hidden");

  img.onload = () => {
    statusEl.textContent = `Trial ${trialPos + 1}/${trials.length}: click the pedestrian, then press Next.`;
    tStart = performance.now();
    console.log("Image shown; timer started.", tr.imageId);
  };

  img.onerror = () => {
    statusEl.textContent = "Image failed to load. Check the path.";
    console.error("Image load failed:", tr.src);
    tStart = null;
  };

  img.src = tr.src;
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

// Start button now: sign in, then start the one-image trial
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    await signInAnon();
    // startOneImageTrial();
    showNextTrial();
  } finally {
    startBtn.disabled = false;
  }
});

// img.addEventListener("click", async (evt) => {
//   if (tStart === null) return;

//   const rtMs = Math.round(performance.now() - tStart);
//   const { xNorm, yNorm } = clickToNormXY(evt);

//   console.log({ rtMs, xNorm, yNorm });
//   statusEl.textContent = `Recorded: RT=${rtMs} ms, x=${xNorm.toFixed(3)}, y=${yNorm.toFixed(3)}`;

//   // Stop timing after first click (prevents re-clicks changing RT)
//   tStart = null;

//   try {
//     await saveResponse({ rtMs, xNorm, yNorm });
//     statusEl.textContent = "Saved. Thank you.";
//   } catch (e) {
//     console.error("Firestore write failed:", e);
//     statusEl.textContent = "Error saving response (check console).";
//   }
  
// });

img.addEventListener("click", async (evt) => {
  if (tStart === null) return;
  if (pending !== null) return; // lock to first click

  const rtMs = Math.round(performance.now() - tStart);
  const { xNorm, yNorm } = clickToNormXY(evt);
  const tr = trials[trialPos];

  pending = { rtMs, xNorm, yNorm, tr };
  tStart = null;

  statusEl.textContent = `Recorded. Press Next. (RT=${rtMs} ms)`;
  nextBtn.disabled = false;
});

nextBtn.addEventListener("click", async () => {
  if (!pending) return;

  nextBtn.disabled = true;
  statusEl.textContent = "Saving...";

  const { rtMs, xNorm, yNorm, tr } = pending;

  try {
    await addDoc(collection(db, "responses"), {
      studyId,
      participantId,
      firebaseUid: userUid,

      trialPos,                 // actual presentation order for this participant
      sceneId: tr.sceneId,
      condition: tr.condition,
      imageId: tr.imageId,

      rtMs,
      xNorm,
      yNorm,

      ts: serverTimestamp(),
    });

    statusEl.textContent = "Saved.";
    showNextTrial();
  } catch (e) {
    console.error("Firestore write failed:", e);
    statusEl.textContent = `Error saving: ${e.code || e.message}`;
    nextBtn.disabled = false;
  }
});


// Block 4: Write one response to Firestore

const studyId = "thesis_ped_localization_v1";
const participantId = crypto.randomUUID();  // local anonymous ID

async function saveResponse({ rtMs, xNorm, yNorm }) {
  const docRef = await addDoc(collection(db, "responses"), {
    studyId,
    participantId,
    imageId: "example_image",
    condition: "debug_single_image",
    rtMs,
    xNorm,
    yNorm,
    ts: serverTimestamp(),
  });

  console.log("Saved response with ID:", docRef.id);
}
// ---------------------- TESTED OK UNTIL HERE -------------------------------- //

