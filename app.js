import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");

async function signInAnon() {
  statusEl.textContent = "Signing in...";
  console.log("Attempting anonymous sign-in...");

  try {
    const cred = await signInAnonymously(auth);
    console.log("Signed in. UID:", cred.user.uid);
    statusEl.textContent = "Signed in successfully.";
    return cred.user.uid;
  } catch (e) {
    console.error("Anonymous sign-in failed:", e);
    statusEl.textContent = `Sign-in failed: ${e.code || e.message}`;
    throw e;
  }
}
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    await signInAnon();
  } finally {
    startBtn.disabled = false;
  }
});

// Block 3: Show one image, start timer when it is visible, log click RT + normalised coords
const img = document.getElementById("stimulus");
const wrap = document.getElementById("stimulusWrap");

const ONE_IMAGE_SRC = "./assets/Picture1.jpg";
let tStart = null;

function startOneImageTrial() {
  statusEl.textContent = "Loading image...";
  wrap.classList.remove("hidden");

  img.onload = () => {
    statusEl.textContent = "Click the pedestrian location.";
    tStart = performance.now();
    console.log("Image shown; timer started.");
  };

  img.onerror = () => {
    statusEl.textContent = "Image failed to load. Check the path.";
    console.error("Image load failed:", ONE_IMAGE_SRC);
  };

  img.src = ONE_IMAGE_SRC; // triggers loading + display
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
    startOneImageTrial();
  } finally {
    startBtn.disabled = false;
  }
});

img.addEventListener("click", (evt) => {
  if (tStart === null) return;

  const rtMs = Math.round(performance.now() - tStart);
  const { xNorm, yNorm } = clickToNormXY(evt);

  console.log({ rtMs, xNorm, yNorm });
  // statusEl.textContent = `Recorded: RT=${rtMs} ms, x=${xNorm.toFixed(3)}, y=${yNorm.toFixed(3)}`;
  statusEl.textContent = `Saving... RT=${rtMs} ms`;

  // Stop timing after first click (prevents re-clicks changing RT)
  tStart = null;

  // try {
  //   await saveResponse({ rtMs, xNorm, yNorm });
  //   statusEl.textContent = "Saved. Thank you.";
  // } catch (e) {
  //   console.error("Firestore write failed:", e);
  //   statusEl.textContent = "Error saving response (check console).";
  // }
  
});
// ---------------------- TESTED OK UNTIL HERE -------------------------------- //
// // Block 4: Write one response to Firestore

// import { collection, addDoc, serverTimestamp } 
//   from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// const studyId = "thesis_ped_localization_v1";
// const participantId = crypto.randomUUID();  // local anonymous ID

// async function saveResponse({ rtMs, xNorm, yNorm }) {
//   const docRef = await addDoc(collection(db, "responses"), {
//     studyId,
//     participantId,
//     imageId: "example_image",
//     condition: "debug_single_image",
//     rtMs,
//     xNorm,
//     yNorm,
//     ts: serverTimestamp(),
//   });

//   console.log("Saved response with ID:", docRef.id);
// }

// ---------------------- EVERYTHING BELOW IS NOT TESTED YET -------------------------------- //
// // Simple trial list (replace with your real assets + conditions)
// const trials = [
//   { imageId: "img01_fused", src: "./assets/Picture1.jpg", condition: "fused" },
//   { imageId: "img09_fused", src: "./assets/Picture9.jpg", condition: "fused" },
//   // ...
// ];

// const studyId = "thesis_ped_localization_v1";
// let participantId = crypto.randomUUID();          // anonymous local ID
// let userUid = null;
// let trialIndex = -1;
// let tStart = null;


// const nextBtn = document.getElementById("nextBtn");
// let pendingResponse = null;


// // async function ensureAnonAuth() {
// //   const cred = await signInAnonymously(auth);
// //   userUid = cred.user.uid;
// // }

// function showNextTrial() {
//   trialIndex += 1;
//   pendingResponse = null;
//   nextBtn.disabled = true;

//   if (trialIndex >= trials.length) {
//     statusEl.textContent = "Done. Thank you.";
//     wrap.classList.add("hidden");
//     nextBtn.classList.add("hidden");
//     return;
//   }

//   const tr = trials[trialIndex];
//   img.src = tr.src;

//   img.onload = () => {
//     wrap.classList.remove("hidden");
//     nextBtn.classList.remove("hidden");
//     statusEl.textContent = `Trial ${trialIndex + 1}/${trials.length}: click the pedestrian location, then press Next.`;
//     tStart = performance.now();
//   };
// }


// // function clickToNormXY(evt) {
// //   const rect = img.getBoundingClientRect();
// //   const x = (evt.clientX - rect.left) / rect.width;
// //   const y = (evt.clientY - rect.top) / rect.height;
// //   return { xNorm: Math.min(1, Math.max(0, x)), yNorm: Math.min(1, Math.max(0, y)) };
// // }

// img.addEventListener("click", async (evt) => {
//   if (tStart === null) return;
//   const rtMs = Math.round(performance.now() - tStart);
//   const { xNorm, yNorm } = clickToNormXY(evt);
//   const tr = trials[trialIndex];

//   // Store ONE record per trial
//   await addDoc(collection(db, "responses"), {
//     studyId,
//     participantId,
//     firebaseUid: userUid,            // optional; you can omit to reduce identifiers
//     trialIndex,
//     condition: tr.condition,
//     imageId: tr.imageId,
//     rtMs,
//     xNorm,
//     yNorm,
//     ts: serverTimestamp(),
//   });

//   tStart = null;
//   showNextTrial();
// });

// // startBtn.addEventListener("click", async () => {
// //   startBtn.disabled = true;
// //   statusEl.textContent = "Signing in...";
// //   await ensureAnonAuth();            // Anonymous auth is the key for rules-based writes :contentReference[oaicite:6]{index=6}
// //   statusEl.textContent = "Loading...";
// //   showNextTrial();
// // });

// // startBtn.addEventListener("click", async () => {
// //   startBtn.disabled = true;
// //   statusEl.textContent = "Signing in...";

// //   try {
// //     const cred = await signInAnonymously(auth);
// //     userUid = cred.user.uid;

// //     statusEl.textContent = "Loading...";
// //     showNextTrial();
// //   } catch (e) {
// //     console.error(e);
// //     statusEl.textContent = `Sign-in failed: ${e.code || e.message}`;
// //     startBtn.disabled = false;
// //   }
// // });


// img.addEventListener("click", (evt) => {
//   if (tStart === null) return;

//   const rtMs = Math.round(performance.now() - tStart);
//   const { xNorm, yNorm } = clickToNormXY(evt);
//   const tr = trials[trialIndex];

//   pendingResponse = { rtMs, xNorm, yNorm, condition: tr.condition, imageId: tr.imageId };
//   nextBtn.disabled = false;

//   // prevent re-click changing RT; allow if you prefer
//   tStart = null;

//   statusEl.textContent = `Recorded. Press Next.`;
// });

// nextBtn.addEventListener("click", async () => {
//   if (!pendingResponse) return;
//   nextBtn.disabled = true;

//   await addDoc(collection(db, "responses"), {
//     studyId,
//     participantId,
//     trialIndex,
//     condition: pendingResponse.condition,
//     imageId: pendingResponse.imageId,
//     rtMs: pendingResponse.rtMs,
//     xNorm: pendingResponse.xNorm,
//     yNorm: pendingResponse.yNorm,
//     ts: serverTimestamp(),
//   });

//   showNextTrial();
// });


