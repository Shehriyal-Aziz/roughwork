"use strict";

/* =====================================================================
   MCQ NOTES + TEST APP — shared/generic engine
   Works for ANY subject: the HTML page just needs to set
     window.MCQ_DATA_URL = "subject.json";
   before this script loads, and include the standard containers
   (#notes-content > #mcq-list, #toolbar, #test-panel, #toast, etc.)
   This file has NO subject-specific content — all questions,
   headings and footer text come from the JSON file.
   ===================================================================== */

const DATA_URL = window.MCQ_DATA_URL || "data.json";

// Derive a per-subject storage prefix from the data file name so different
// subjects (gk.json, physics.json, chemistry.json, ...) never share the
// same bookmark/note/dark-mode keys in localStorage. Works automatically
// for any future subject — no extra config needed per page.
const SUBJECT_KEY = (DATA_URL.split("/").pop() || "data")
  .replace(/\.json$/i, "")
  .toLowerCase();
const STORAGE_PREFIX = `mcq-${SUBJECT_KEY}`;

let mcqData = []; // flat array of {idx, qNum, tag, question, options, correctIndex, explanation}
let allCards = []; // DOM refs to each rendered .mcq-card

// One-time migration: older versions of this app stored everything under
// "gk-bm-*" / "gk-note-*" / "gk-dark" regardless of subject. Move the GK
// page's old keys onto the new subject-prefixed scheme so existing
// bookmarks/notes aren't lost, then leave the legacy keys alone for safety.
(function migrateLegacyGkKeys() {
  if (SUBJECT_KEY !== "gk") return;
  if (localStorage.getItem("mcq-gk-migrated") === "1") return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const oldKey = localStorage.key(i);
    if (!oldKey) continue;
    if (oldKey === "gk-dark") {
      if (localStorage.getItem("mcq-dark") === null) {
        localStorage.setItem("mcq-dark", localStorage.getItem(oldKey));
      }
    } else if (oldKey.startsWith("gk-bm-") || oldKey.startsWith("gk-note-")) {
      const newKey = `mcq-${oldKey}`;
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
      }
    }
  }
  localStorage.setItem("mcq-gk-migrated", "1");
})();

// =====================================================
//  BOOT
// =====================================================
init();

async function init() {
  restoreDarkMode();
  setupStaticListeners();

  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    applyMeta(data.meta || {});
    mcqData = (data.questions || []).map((q, idx) => ({ idx, ...q }));

    renderAllCards(mcqData);
    setupInputLimits(mcqData.length);
    injectTopicFilterBar();
  } catch (err) {
    console.error("Failed to load MCQ data:", err);
    const container = document.getElementById("mcq-list");
    if (container) {
      const warn = document.createElement("div");
      warn.className = "missing";
      warn.textContent = `⚠️ Could not load question data (${DATA_URL}). Please refresh the page or check your connection.`;
      container.appendChild(warn);
    }
    showToast("Failed to load questions");
  }
}

function applyMeta(meta) {
  if (meta.title) document.title = meta.title;

  const h1 = document.getElementById("page-title");
  if (h1 && meta.heading) h1.textContent = meta.heading;

  const descEl = document.getElementById("page-description");
  if (descEl && meta.description) descEl.textContent = meta.description;

  const footerEl = document.getElementById("page-footer");
  if (footerEl && meta.footer) footerEl.textContent = meta.footer;
}

function setupInputLimits(total) {
  const jumpInput = document.getElementById("jump-input");
  if (jumpInput) jumpInput.max = String(total);

  const testCount = document.getElementById("test-count");
  if (testCount) testCount.max = String(total);
}

// =====================================================
//  RENDER — build every .mcq-card from JSON data
// =====================================================
function renderAllCards(list) {
  const container = document.getElementById("mcq-list");
  if (!container) return;

  const frag = document.createDocumentFragment();
  allCards = [];

  list.forEach((data) => {
    const card = buildCard(data);
    allCards.push(card);
    frag.appendChild(card);
  });

  container.appendChild(frag);
}

function buildCard(data) {
  const card = document.createElement("div");
  card.className = "mcq-card";
  card.id = `card-q${data.qNum}`;

  // ---- header row: tag + collapse toggle (left), bookmark + note (right) ----
  const headerDiv = document.createElement("div");
  headerDiv.className = "card-header";

  const leftDiv = document.createElement("div");
  leftDiv.className = "card-header-left";

  const tagEl = document.createElement("span");
  tagEl.className = "tag";
  tagEl.textContent = data.tag || `MCQ ${data.qNum}`;
  leftDiv.appendChild(tagEl);

  const colBtn = document.createElement("button");
  colBtn.className = "collapse-toggle";
  colBtn.textContent = "▼ Hide";
  colBtn.onclick = () => toggleCard(card, colBtn);
  leftDiv.appendChild(colBtn);

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "card-actions";

  const bmBtn = document.createElement("button");
  bmBtn.className = "icon-btn";
  bmBtn.title = "Bookmark this question";
  bmBtn.innerHTML = "🔖";
  bmBtn.onclick = () => toggleBookmark(data.qNum, card, bmBtn);
  actionsDiv.appendChild(bmBtn);

  const noteBtn = document.createElement("button");
  noteBtn.className = "icon-btn";
  noteBtn.title = "Add/edit note";
  noteBtn.innerHTML = "📝";
  noteBtn.onclick = () => toggleNoteEditor(data.qNum, card);
  actionsDiv.appendChild(noteBtn);

  headerDiv.appendChild(leftDiv);
  headerDiv.appendChild(actionsDiv);
  card.appendChild(headerDiv);

  // ---- question text (always visible, outside the collapsible body) ----
  const questionEl = document.createElement("div");
  questionEl.className = "mcq-question";
  questionEl.textContent = data.question || "(no question text)";
  card.appendChild(questionEl);

  // ---- collapsible body: options + explanation + notes ----
  const body = document.createElement("div");
  body.className = "collapsible";

  const optUl = document.createElement("ul");
  optUl.className = "options";
  (data.options || []).forEach((opt, i) => {
    const li = document.createElement("li");
    li.textContent = opt.text;
    if (i === data.correctIndex || opt.correct) li.classList.add("correct");
    optUl.appendChild(li);
  });
  body.appendChild(optUl);

  if (data.explanation) {
    const expDiv = document.createElement("div");
    expDiv.className = "explanation";
    expDiv.textContent = data.explanation;
    body.appendChild(expDiv);
  }

  // ---- user note area ----
  const noteArea = document.createElement("div");
  noteArea.className = "user-note-area";
  noteArea.id = `note-area-${data.qNum}`;

  const noteDisplay = document.createElement("div");
  noteDisplay.className = "user-note-display";
  noteDisplay.id = `note-display-${data.qNum}`;
  noteDisplay.style.display = "none";

  const noteTA = document.createElement("textarea");
  noteTA.className = "user-note-textarea";
  noteTA.id = `note-ta-${data.qNum}`;
  noteTA.placeholder = "Type your note here…";

  const noteBtns = document.createElement("div");
  noteBtns.className = "note-btns";
  noteBtns.id = `note-btns-${data.qNum}`;
  noteBtns.style.display = "none";

  const saveNoteBtn = document.createElement("button");
  saveNoteBtn.className = "btn btn-primary";
  saveNoteBtn.style.fontSize = "0.78em";
  saveNoteBtn.textContent = "💾 Save";
  saveNoteBtn.onclick = () => saveNote(data.qNum);

  const delNoteBtn = document.createElement("button");
  delNoteBtn.className = "btn btn-danger";
  delNoteBtn.style.fontSize = "0.78em";
  delNoteBtn.textContent = "🗑 Delete";
  delNoteBtn.onclick = () => deleteNote(data.qNum);

  const cancelNoteBtn = document.createElement("button");
  cancelNoteBtn.className = "btn btn-secondary";
  cancelNoteBtn.style.fontSize = "0.78em";
  cancelNoteBtn.textContent = "Cancel";
  cancelNoteBtn.onclick = () => closeNoteEditor(data.qNum);

  noteBtns.append(saveNoteBtn, delNoteBtn, cancelNoteBtn);
  noteArea.append(noteDisplay, noteTA, noteBtns);
  body.appendChild(noteArea);

  card.appendChild(body);

  // ---- restore saved state ----
  loadBookmark(data.qNum, card, bmBtn);
  loadNote(data.qNum, noteDisplay);

  return card;
}

// =====================================================
//  COLLAPSE / EXPAND
// =====================================================
function setCardCollapsed(card, collapsed) {
  const body = card.querySelector(".collapsible");
  const btn = card.querySelector(".collapse-toggle");
  if (!body || !btn) return;
  if (collapsed) {
    body.style.maxHeight = body.scrollHeight + "px"; // trigger from expanded
    requestAnimationFrame(() => {
      body.style.maxHeight = body.scrollHeight + "px";
      requestAnimationFrame(() => {
        body.classList.add("collapsed");
      });
    });
    btn.textContent = "▶ Show";
  } else {
    body.classList.remove("collapsed");
    body.style.maxHeight = body.scrollHeight + "px";
    setTimeout(() => {
      body.style.maxHeight = "none";
    }, 320);
    btn.textContent = "▼ Hide";
  }
}

function toggleCard(card, btn) {
  const body = card.querySelector(".collapsible");
  if (!body) return;
  const isCollapsed = body.classList.contains("collapsed");
  setCardCollapsed(card, !isCollapsed);
}

function collapseAll() {
  allCards.forEach((c) => setCardCollapsed(c, true));
  showToast("All explanations collapsed");
}

function expandAll() {
  allCards.forEach((c) => setCardCollapsed(c, false));
  showToast("All explanations expanded");
}

// =====================================================
//  TOPIC FILTER BAR (Notes view) — only appears when the
//  JSON's questions carry a "topic" field.
// =====================================================
function injectTopicFilterBar() {
  const list = document.getElementById("mcq-list");
  if (!list || !list.parentElement) return;

  const topics = [...new Set(mcqData.map((d) => d.topic).filter(Boolean))];
  if (!topics.length) return;

  const bar = document.createElement("div");
  bar.id = "topic-filter-bar";
  bar.style.cssText =
    "display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;";

  function makeChip(label, value, isActive) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "btn btn-secondary topic-chip";
    chip.dataset.topic = value;
    chip.textContent = label;
    chip.style.cssText = `font-size: 0.85em; padding: 6px 14px; border-radius: 20px;${
      isActive ? " outline: 2px solid var(--btn-primary);" : ""
    }`;
    chip.onclick = () => filterByTopic(value);
    return chip;
  }

  bar.appendChild(makeChip(`📚 All (${mcqData.length})`, "all", true));
  topics.forEach((topic) => {
    const count = mcqData.filter((d) => d.topic === topic).length;
    bar.appendChild(makeChip(`${topic} (${count})`, topic, false));
  });

  list.parentElement.insertBefore(bar, list);
}

function filterByTopic(topic) {
  document.querySelectorAll(".topic-chip").forEach((chip) => {
    chip.style.outline =
      chip.dataset.topic === topic ? "2px solid var(--btn-primary)" : "none";
  });

  allCards.forEach((card, i) => {
    const data = mcqData[i];
    const show = topic === "all" || data.topic === topic;
    card.style.display = show ? "" : "none";
  });

  showToast(topic === "all" ? "Showing all questions" : `Filtered: ${topic}`);
}

// =====================================================
//  JUMP TO QUESTION
// =====================================================
function jumpToQ() {
  const val = parseInt(document.getElementById("jump-input").value);
  if (!val) {
    showToast("Enter a question number");
    return;
  }

  const target = document.getElementById(`card-q${val}`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.style.transition = "box-shadow 0.2s";
    target.style.boxShadow = "0 0 0 3px #3b82f6";
    setTimeout(() => {
      target.style.boxShadow = "";
    }, 1500);
    showToast(`Jumped to Q${val}`);
  } else {
    showToast(`Q${val} not found`);
  }
}

// =====================================================
//  DARK MODE
// =====================================================
function toggleDark() {
  const on = document.body.classList.toggle("dark");
  localStorage.setItem("mcq-dark", on ? "1" : "0"); // shared UI preference across all subjects
  const dt = document.getElementById("dark-toggle");
  if (dt) dt.textContent = on ? "☀️ Light Mode" : "🌙 Dark Mode";
  const dtTest = document.getElementById("dark-toggle-test");
  if (dtTest) dtTest.textContent = on ? "☀️" : "🌙";
}

function restoreDarkMode() {
  if (localStorage.getItem("mcq-dark") === "1") {
    document.body.classList.add("dark");
    const dt = document.getElementById("dark-toggle");
    if (dt) dt.textContent = "☀️ Light Mode";
  }
}

// =====================================================
//  BOOKMARKS
// =====================================================
function toggleBookmark(qNum, card, btn) {
  const key = `${STORAGE_PREFIX}-bm-${qNum}`;
  const isOn = localStorage.getItem(key) === "1";
  if (isOn) {
    localStorage.removeItem(key);
    card.classList.remove("bookmarked");
    btn.classList.remove("active");
    showToast(`Q${qNum} bookmark removed`);
  } else {
    localStorage.setItem(key, "1");
    card.classList.add("bookmarked");
    btn.classList.add("active");
    showToast(`Q${qNum} bookmarked ⭐`);
  }
}

function loadBookmark(qNum, card, btn) {
  if (localStorage.getItem(`${STORAGE_PREFIX}-bm-${qNum}`) === "1") {
    card.classList.add("bookmarked");
    btn.classList.add("active");
  }
}

// =====================================================
//  NOTES
// =====================================================
function toggleNoteEditor(qNum, card) {
  const ta = document.getElementById(`note-ta-${qNum}`);
  const btns = document.getElementById(`note-btns-${qNum}`);
  const isOpen = ta.style.display === "block";
  if (isOpen) {
    closeNoteEditor(qNum);
  } else {
    ta.value = localStorage.getItem(`${STORAGE_PREFIX}-note-${qNum}`) || "";
    ta.style.display = "block";
    btns.style.display = "flex";
    ta.focus();
    const body = card.querySelector(".collapsible");
    if (body && body.classList.contains("collapsed")) {
      setCardCollapsed(card, false);
    }
  }
}

function saveNote(qNum) {
  const ta = document.getElementById(`note-ta-${qNum}`);
  const disp = document.getElementById(`note-display-${qNum}`);
  const text = ta.value.trim();
  if (text) {
    localStorage.setItem(`${STORAGE_PREFIX}-note-${qNum}`, text);
    disp.textContent = "📝 " + text;
    disp.style.display = "block";
    showToast("Note saved!");
  } else {
    deleteNote(qNum);
    return;
  }
  closeNoteEditor(qNum);
}

function deleteNote(qNum) {
  localStorage.removeItem(`${STORAGE_PREFIX}-note-${qNum}`);
  const disp = document.getElementById(`note-display-${qNum}`);
  if (disp) {
    disp.textContent = "";
    disp.style.display = "none";
  }
  closeNoteEditor(qNum);
  showToast("Note deleted");
}

function closeNoteEditor(qNum) {
  const ta = document.getElementById(`note-ta-${qNum}`);
  const btns = document.getElementById(`note-btns-${qNum}`);
  if (ta) ta.style.display = "none";
  if (btns) btns.style.display = "none";
}

function loadNote(qNum, disp) {
  const saved = localStorage.getItem(`${STORAGE_PREFIX}-note-${qNum}`);
  if (saved) {
    disp.textContent = "📝 " + saved;
    disp.style.display = "block";
  }
}

// =====================================================
//  TEST MODE
// =====================================================
let testQueue = [];
let testCurrent = 0;
let testAnswers = {};
let testTotal = 0;
let kbFocusIdx = -1; // keyboard-highlighted option index

function enterTestMode() {
  if (!mcqData.length) {
    showToast("Questions are still loading, try again in a moment");
    return;
  }
  ensureTopicSelect();
  document.body.classList.add("test-mode");
  document.getElementById("test-setup").style.display = "block";
  document.getElementById("test-active").style.display = "none";
  document.getElementById("test-results").style.display = "none";
}

// =====================================================
//  TOPIC FILTER (only appears when the JSON's questions
//  carry a "topic" field — e.g. subject/english/english.json.
//  Subjects without a "topic" field are unaffected.)
// =====================================================
function ensureTopicSelect() {
  if (document.getElementById("test-topic")) return; // already injected

  const topics = [...new Set(mcqData.map((d) => d.topic).filter(Boolean))];
  if (!topics.length) return; // this subject has no topics — nothing to do

  const countLabel = document.getElementById("test-count")?.closest("label");
  const row = countLabel?.parentElement;
  if (!row) return;

  const label = document.createElement("label");
  label.style.cssText =
    "display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; font-weight: 600;";
  label.textContent = "Topic";

  const select = document.createElement("select");
  select.id = "test-topic";
  select.style.cssText =
    "padding: 6px 10px; border-radius: 7px; border: 1.5px solid var(--input-border); background: var(--input-bg); color: var(--text); font-size: 1em; outline: none; cursor: pointer;";

  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = `📚 All Topics (${mcqData.length})`;
  select.appendChild(allOpt);

  topics.forEach((topic) => {
    const count = mcqData.filter((d) => d.topic === topic).length;
    const opt = document.createElement("option");
    opt.value = topic;
    opt.textContent = `${topic} (${count})`;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    const max = select.value === "all"
      ? mcqData.length
      : mcqData.filter((d) => d.topic === select.value).length;
    const testCount = document.getElementById("test-count");
    if (testCount) {
      testCount.max = String(max);
      if (parseInt(testCount.value) > max) testCount.value = String(max);
    }
  });

  label.appendChild(select);
  row.insertBefore(label, countLabel); // Topic first, then Count, then Order
}

function exitTestMode() {
  document.body.classList.remove("test-mode");
  document.getElementById("test-active").style.display = "none";
  document.getElementById("test-results").style.display = "none";
  document.getElementById("test-setup").style.display = "block";
}

function startTest() {
  const order = document.getElementById("test-order").value;
  const topicSel = document.getElementById("test-topic");
  const topic = topicSel ? topicSel.value : "all";

  let pool = mcqData.filter((d) => d.correctIndex >= 0);
  if (topic && topic !== "all") {
    pool = pool.filter((d) => d.topic === topic);
  }

  const max = pool.length || 1;
  const count = Math.min(
    max,
    Math.max(1, parseInt(document.getElementById("test-count").value) || 20),
  );

  if (order === "shuffle") {
    pool = pool.sort(() => Math.random() - 0.5);
  }

  testQueue = pool.slice(0, count);
  testTotal = testQueue.length;
  testCurrent = 0;
  testAnswers = {};

  document.getElementById("test-setup").style.display = "none";
  document.getElementById("test-active").style.display = "block";
  document.getElementById("test-results").style.display = "none";

  renderTestQuestion();
}

function renderTestQuestion() {
  const data = testQueue[testCurrent];
  const label = document.getElementById("test-progress-label");
  const qTag = document.getElementById("test-q-tag");
  const qText = document.getElementById("test-question");
  const optUl = document.getElementById("test-options");
  const expDiv = document.getElementById("test-explanation");
  const btnNext = document.getElementById("btn-next");
  const btnPrev = document.getElementById("btn-prev");
  const btnFinish = document.getElementById("btn-finish");

  label.textContent = `Question ${testCurrent + 1} of ${testTotal}`;
  qTag.textContent = data.tag;
  qText.textContent = data.question;
  expDiv.style.display = "none";
  expDiv.textContent = data.explanation || "";
  kbFocusIdx = -1; // reset keyboard focus on each new question

  const dtTest = document.getElementById("dark-toggle-test");
  if (dtTest)
    dtTest.textContent = document.body.classList.contains("dark")
      ? "☀️"
      : "🌙";

  optUl.innerHTML = "";
  const answered = testAnswers[testCurrent];
  const isAnswered = answered !== undefined;

  // Cards with only 1 option — show as "Reveal Answer" card
  if (data.options.length === 1) {
    const li = document.createElement("li");
    if (isAnswered) {
      li.textContent = data.options[0].text;
      li.classList.add("selected-correct", "locked");
    } else {
      li.textContent = "👁 Click to Reveal Answer";
      li.style.cursor = "pointer";
      li.style.fontStyle = "italic";
      li.style.color = "var(--btn-primary)";
      li.onclick = () => answerQuestion(0);
    }
    optUl.appendChild(li);
  } else {
    data.options.forEach((opt, i) => {
      const li = document.createElement("li");
      li.textContent = opt.text;

      if (isAnswered) {
        li.classList.add("locked");
        if (i === data.correctIndex) {
          li.classList.add(
            answered === i ? "selected-correct" : "reveal-correct",
          );
        } else if (i === answered && answered !== data.correctIndex) {
          li.classList.add("selected-wrong");
        }
      } else {
        li.onclick = () => answerQuestion(i);
      }
      optUl.appendChild(li);
    });
  }

  if (isAnswered) {
    expDiv.style.display = "block";
  }

  btnPrev.disabled = testCurrent === 0;
  const isLast = testCurrent === testTotal - 1;
  btnNext.style.display = isLast ? "none" : "inline-block";
  btnFinish.style.display = isLast ? "inline-block" : "none";
}

function answerQuestion(choiceIdx) {
  testAnswers[testCurrent] = choiceIdx;
  renderTestQuestion();
}

function testNav(dir) {
  testCurrent = Math.max(0, Math.min(testTotal - 1, testCurrent + dir));
  renderTestQuestion();
}

function finishTest() {
  let correct = 0;
  testQueue.forEach((data, i) => {
    if (testAnswers[i] === data.correctIndex) correct++;
  });

  document.getElementById("test-active").style.display = "none";
  document.getElementById("test-results").style.display = "block";

  const pct = Math.round((correct / testTotal) * 100);
  const circle = document.getElementById("score-display");
  circle.innerHTML = `${pct}%<span>${correct} / ${testTotal}</span>`;

  const msg = document.getElementById("result-msg");
  const det = document.getElementById("result-detail");
  if (pct >= 80) {
    msg.textContent = "🎉 Excellent Work!";
  } else if (pct >= 60) {
    msg.textContent = "👍 Good Job!";
  } else if (pct >= 40) {
    msg.textContent = "📖 Keep Studying!";
  } else {
    msg.textContent = "💪 Don't Give Up!";
  }
  det.textContent = `You answered ${correct} out of ${testTotal} questions correctly (${pct}%).`;
}

function retryTest() {
  testCurrent = 0;
  testAnswers = {};
  if (document.getElementById("test-order")?.value === "shuffle") {
    testQueue = testQueue.sort(() => Math.random() - 0.5);
  }
  document.getElementById("test-results").style.display = "none";
  document.getElementById("test-active").style.display = "block";
  renderTestQuestion();
}

// =====================================================
//  TEST JUMP
// =====================================================
function testJump() {
  const val = parseInt(document.getElementById("test-jump-input").value);
  if (!val || val < 1) {
    showToast("Enter a valid question number");
    return;
  }
  const idx = testQueue.findIndex((d) => d.qNum === val);
  if (idx === -1) {
    showToast(`Q${val} isn't in this test session`);
    return;
  }
  testCurrent = idx;
  renderTestQuestion();
  showToast(`Jumped to Q${val}`);
}

// =====================================================
//  KEYBOARD NAVIGATION (test mode only)
// =====================================================
function getTestOptions() {
  return Array.from(document.querySelectorAll("#test-options li"));
}

function updateKbFocus(items) {
  items.forEach((li, i) => {
    li.classList.toggle("kb-focus", i === kbFocusIdx);
  });
}

// =====================================================
//  STATIC LISTENERS — elements that exist in the base HTML
//  (independent of the fetched question data)
// =====================================================
function setupStaticListeners() {
  const jumpInput = document.getElementById("jump-input");
  if (jumpInput) {
    jumpInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") jumpToQ();
    });
  }

  const testJumpInput = document.getElementById("test-jump-input");
  if (testJumpInput) {
    testJumpInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        testJump();
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    if (!document.body.classList.contains("test-mode")) return;
    const testActive = document.getElementById("test-active");
    if (!testActive || testActive.style.display === "none") return;

    if (document.activeElement === document.getElementById("test-jump-input"))
      return;

    const answered = testAnswers[testCurrent] !== undefined;
    const items = getTestOptions();
    const optCount = items.length;

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (optCount === 0) break;
        kbFocusIdx = kbFocusIdx <= 0 ? optCount - 1 : kbFocusIdx - 1;
        updateKbFocus(items);
        break;

      case "ArrowDown":
        e.preventDefault();
        if (optCount === 0) break;
        kbFocusIdx = kbFocusIdx >= optCount - 1 ? 0 : kbFocusIdx + 1;
        updateKbFocus(items);
        break;

      case "Enter":
        e.preventDefault();
        if (answered) {
          const isLast = testCurrent === testTotal - 1;
          if (isLast) finishTest();
          else testNav(1);
        } else if (kbFocusIdx >= 0 && kbFocusIdx < optCount) {
          answerQuestion(kbFocusIdx);
        } else if (optCount === 1) {
          answerQuestion(0);
        }
        break;

      case "ArrowLeft":
      case "Backspace":
        if (
          e.key === "Backspace" &&
          document.activeElement.tagName === "INPUT"
        )
          break;
        e.preventDefault();
        testNav(-1);
        break;

      case "ArrowRight":
        e.preventDefault();
        testNav(1);
        break;
    }
  });
}

// =====================================================
//  TOAST
// =====================================================
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// =====================================================
//  PWA SERVICE WORKER
// =====================================================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
