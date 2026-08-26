"use strict";

/* =========================================================
   NEXA AI WEBSITE BUILDER — COMPLETE APP.JS
   ========================================================= */

const S = {
  key: localStorage.getItem("nexa_key") || "",
  model: localStorage.getItem("nexa_model") || "",
  site: localStorage.getItem("nexa_site") || "",
  prompt: localStorage.getItem("nexa_prompt") || "",
  history: readJSON("nexa_history", []),
  busy: false,
  steps: []
};

const STEPS = [
  ["brief", "Understanding your brief"],
  ["plan", "Planning website structure"],
  ["design", "Designing visual system"],
  ["build", "Building the website"],
  ["content", "Adding content and interactions"],
  ["audit", "Running quality check"],
  ["preview", "Rendering the live preview"]
];

function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function toast(message, error = false) {
  document.querySelector(".nexa-toast")?.remove();

  const el = document.createElement("div");
  el.className = "nexa-toast";
  el.textContent = message;

  el.style.cssText = `
    position:fixed;
    left:50%;
    bottom:24px;
    transform:translateX(-50%);
    z-index:99999;
    max-width:90%;
    padding:12px 18px;
    border-radius:12px;
    color:#fff;
    background:${error ? "#dc3545" : "#171923"};
    box-shadow:0 12px 40px rgba(0,0,0,.35);
    font:500 14px system-ui,sans-serif;
  `;

  document.body.appendChild(el);

  setTimeout(() => el.remove(), 3500);
}

function saveState() {
  localStorage.setItem("nexa_key", S.key);
  localStorage.setItem("nexa_model", S.model);
  localStorage.setItem("nexa_site", S.site);
  localStorage.setItem("nexa_prompt", S.prompt);
  localStorage.setItem("nexa_history", JSON.stringify(S.history.slice(0, 20)));
}

function step(id, status, note = "") {
  const existing = S.steps.find(x => x[0] === id);

  if (existing) {
    existing[1] = status;
    existing[2] = note;
  } else {
    S.steps.push([id, status, note]);
  }

  renderSteps();
}

function renderSteps() {
  const box = document.querySelector("#steps");
  if (!box) return;

  box.innerHTML = STEPS.map(([id, label]) => {
    const item = S.steps.find(x => x[0] === id);
    const status = item?.[1] || "";
    const note = item?.[2] || "";

    let icon = "○";

    if (status === "active") icon = "•";
    if (status === "done") icon = "✓";
    if (status === "error") icon = "!";

    return `
      <div class="step ${status}">
        <span class="icon">${icon}</span>
        <span>
          ${esc(label)}
          ${note ? ` — ${esc(note)}` : ""}
        </span>
      </div>
    `;
  }).join("");
}


/* =========================================================
   GEMINI MODEL DISCOVERY
   ========================================================= */

async function findModel(key) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?key=" +
    encodeURIComponent(key)
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      `Gemini connection failed: HTTP ${response.status}`
    );
  }

  const models = (data.models || []).filter(model =>
    Array.isArray(model.supportedGenerationMethods) &&
    model.supportedGenerationMethods.includes("generateContent")
  );

  if (!models.length) {
    throw new Error(
      "No Gemini model with generateContent is available for this API key."
    );
  }

  const flash = models.find(model =>
    /flash/i.test(model.name)
  );

  const selected = flash || models[0];

  return selected.name.replace(/^models\//, "");
}


/* =========================================================
   GEMINI REQUEST
   ========================================================= */

async function requestGemini(model, prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=` +
    `${encodeURIComponent(S.key)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 60000
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error?.message ||
      `Gemini error: HTTP ${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("") || "";

  if (!text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}


/* =========================================================
   AI GENERATION WITH RETRY
   ========================================================= */

function shouldRetry(error) {
  const message = String(error?.message || "").toLowerCase();

  return [
    408,
    429,
    500,
    502,
    503,
    504
  ].includes(error?.status) ||
    message.includes("overloaded") ||
    message.includes("high demand") ||
    message.includes("temporarily unavailable");
}

async function generateAI(prompt) {
  if (!S.key) {
    throw new Error("Gemini API key is not connected.");
  }

  let model = S.model;

  if (!model) {
    model = await findModel(S.key);
    S.model = model;
    localStorage.setItem("nexa_model", model);
  }

  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await requestGemini(model, prompt);
    } catch (error) {
      lastError = error;

      if (!shouldRetry(error) || attempt === 2) {
        break;
      }

      await sleep(
        1200 * Math.pow(2, attempt) +
        Math.floor(Math.random() * 500)
      );
    }
  }

  throw lastError || new Error("Gemini request failed.");
}


/* =========================================================
   CLEAN AI HTML
   ========================================================= */

function cleanHTML(value) {
  let html = String(value || "")
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const start = html
    .toLowerCase()
    .indexOf("<!doctype html");

  if (start >= 0) {
    html = html.slice(start);
  }

  if (
    !html.toLowerCase().includes("<html") ||
    !html.toLowerCase().includes("</html>")
  ) {
    throw new Error(
      "AI returned incomplete website HTML."
    );
  }

  return html;
}


/* =========================================================
   CREATE WEBSITE
   ========================================================= */

async function createWebsite(userPrompt) {
  const instruction = `
You are Nexa AI Website Builder.

You are a senior product designer,
UX designer, frontend engineer and creative director.

Create a COMPLETE, CUSTOM and professional
production-quality website from the user's brief.

Do not simply repeat the user's prompt.

Infer and create:

- brand identity
- navigation
- page structure
- hero section
- professional copy
- services or products
- benefits
- social proof
- testimonials when appropriate
- FAQ
- contact section
- forms when useful
- strong CTAs
- footer
- responsive mobile layout
- desktop layout
- accessibility
- hover states
- focus states
- useful interactions
- subtle animations
- polished spacing
- visual hierarchy

The result must feel like a real professional
website made for the specific business.

Do NOT create a generic template.
Do NOT create a text dump.
Do NOT merely describe a website.

Return ONLY ONE COMPLETE HTML DOCUMENT.

Start exactly with:

<!doctype html>

Use inline CSS and inline JavaScript.

No Markdown.
No code fences.
No explanation.
No external framework dependency.

USER BRIEF:

${userPrompt}
`;

  const result = await generateAI(instruction);

  return cleanHTML(result);
}


/* =========================================================
   EDIT EXISTING WEBSITE
   ========================================================= */

async function editWebsite(editPrompt) {
  if (!S.site) {
    throw new Error("There is no existing website to edit.");
  }

  const instruction = `
You are Nexa AI Website Editor.

The user already has a complete website.

Modify the EXISTING website according to
the user's edit request.

IMPORTANT:

Do not create a completely unrelated website.

Keep the existing:

- brand
- useful sections
- navigation
- content
- design language
- working functionality

unless the user specifically asks to change them.

Actually implement the requested changes.

Check:

- desktop layout
- mobile layout
- responsive behavior
- buttons
- navigation
- forms
- animations
- accessibility
- spacing
- typography
- JavaScript
- broken elements

Return ONLY the complete updated HTML document.

Start with:

<!doctype html>

No Markdown.
No code fences.
No explanation.

USER EDIT REQUEST:

${editPrompt}

CURRENT WEBSITE:

${S.site}
`;

  const result = await generateAI(instruction);

  return cleanHTML(result);
}


/* =========================================================
   SETUP SCREEN
   ========================================================= */

function setup() {
  const app = document.querySelector("#app");

  if (!app) return;

  app.innerHTML = `
    <div class="setup">

      <div class="card">

        <div class="logo">✦</div>

        <div
          class="eyebrow"
          style="margin-top:18px"
        >
          ONE-TIME SETUP
        </div>

        <h1>Connect your AI</h1>

        <p class="muted">
          Connect your Gemini API key.
          Nexa will automatically find
          a compatible AI model.
        </p>

        <b>Gemini API Key</b>

        <input
          id="key"
          class="key"
          type="password"
          placeholder="AIza..."
          autocomplete="off"
        >

        <button
          id="connect"
          class="btn purple"
          style="width:100%;margin-top:12px"
        >
          Connect & Open Builder ✦
        </button>

        <div id="err"></div>

        <p
          class="muted"
          style="font-size:12px;margin-top:14px"
        >
          Your API key is stored locally
          in this browser.
        </p>

      </div>

    </div>
  `;

  document.querySelector("#connect").onclick =
    async () => {

      const input =
        document.querySelector("#key");

      const key =
        input?.value.trim();

      if (!key) {
        toast(
          "Please enter your Gemini API key.",
          true
        );
        return;
      }

      const button =
        document.querySelector("#connect");

      button.disabled = true;
      button.textContent = "Connecting…";

      try {

        const model =
          await findModel(key);

        S.key = key;
        S.model = model;

        localStorage.setItem(
          "nexa_key",
          key
        );

        localStorage.setItem(
          "nexa_model",
          model
        );

        render();

      } catch (error) {

        document.querySelector("#err").innerHTML =
          `
            <div class="error">
              ${esc(error.message)}
            </div>
          `;

      } finally {

        button.disabled = false;

        button.textContent =
          "Connect & Open Builder ✦";
      }
    };
}


/* =========================================================
   BUILDER
   ========================================================= */

function builder() {
  const app = document.querySelector("#app");

  if (!app) return;

  const hasWebsite =
    Boolean(S.site);

  app.innerHTML = `
    <div class="app">

      <header class="top">

        <div class="brand">

          <span class="logo">
            ✦
          </span>

          Nexa Builder

          <span class="pill">
            AI
          </span>

        </div>

        <div>

          <button
            id="previewTop"
            class="btn primary"
            ${hasWebsite ? "" : "disabled"}
          >
            Preview
          </button>

          <button
            id="reset"
            class="btn"
          >
            Reset Key
          </button>

        </div>

      </header>


      <main class="main">

        <section class="left">

          <div class="eyebrow">
            AI WEBSITE BUILDER
          </div>

          <div class="title">

            ${
              hasWebsite
                ? "Improve your website with AI."
                : "Build a real website from a prompt."
            }

          </div>

          <p class="muted">

            ${
              hasWebsite
                ? "Tell Nexa what you want to change and it will edit your existing website."
                : "Nexa understands, plans, designs, builds, checks and previews your website."
            }

          </p>

          <textarea
            id="prompt"
            class="prompt"
            placeholder="${
              hasWebsite
                ? "Example: Add a premium booking section..."
                : "Example: Create a premium dental clinic website..."
            }"
          >${esc(S.prompt)}</textarea>

          <div class="build">

            <button
              id="build"
              class="btn primary"
            >

              ${
                hasWebsite
                  ? "Edit Website ✦"
                  : "Build Website ✦"
              }

            </button>

          </div>

          <div class="status">

            <div class="status-head">

              <b>
                Build progress
              </b>

              <span class="dot"></span>

            </div>

            <div id="steps"></div>

          </div>

          ${
            S.history.length
              ? `
                <div class="history">

                  <b>
                    Recent prompts
                  </b>

                  ${S.history
                    .slice(0, 5)
                    .map(
                      (item, index) => `
                        <button
                          class="history-item"
                          data-index="${index}"
                        >
                          ${esc(item)}
                        </button>
                      `
                    )
                    .join("")}

                </div>
              `
              : ""
          }

        </section>


        <section class="workspace">

          <div class="workspace-top">

            <b>
              Website Preview
            </b>

            <div class="tools">

              <button
                id="open"
                class="btn"
                ${hasWebsite ? "" : "disabled"}
              >
                Open
              </button>

              <button
                id="export"
                class="btn"
                ${hasWebsite ? "" : "disabled"}
              >
                Export
              </button>

              <button
                id="public"
                class="btn purple"
                ${hasWebsite ? "" : "disabled"}
              >
                Public
              </button>

            </div>

          </div>


          <div class="preview">

            <div
              class="framebox"
              id="box"
            >

              ${
                hasWebsite
                  ? `
                    <iframe
                      id="frame"
                      class="frame"
                      sandbox="allow-scripts allow-forms allow-modals"
                      title="Generated website preview"
                    ></iframe>
                  `
                  : `
                    <div class="empty">

                      <div>

                        <h2>
                          Your finished website
                          appears here
                        </h2>

                        <p>
                          Build a website to begin.
                        </p>

                      </div>

                    </div>
                  `
              }

            </div>

          </div>

        </section>

      </main>

    </div>
  `;

  renderSteps();


  /* Preview existing website */

  if (hasWebsite) {

    const frame =
      document.querySelector("#frame");

    if (frame) {
      frame.srcdoc = S.site;
    }

  }


  /* Prompt */

  const prompt =
    document.querySelector("#prompt");

  if (prompt) {

    prompt.oninput = () => {

      S.prompt = prompt.value;

      localStorage.setItem(
        "nexa_prompt",
        S.prompt
      );

    };

  }


  /* Build */

  document.querySelector("#build")
    .onclick = buildOrEdit;


  /* Preview */

  document.querySelector("#previewTop")
    .onclick = () => {

      if (!S.site) return;

      location.hash = "#preview";

      render();
    };


  document.querySelector("#open")
    .onclick = () => {

      if (!S.site) return;

      location.hash = "#preview";

      render();
    };


  /* Export */

  document.querySelector("#export")
    .onclick = exportSite;


  /* Public */

  document.querySelector("#public")
    .onclick = publish;


  /* Reset */

  document.querySelector("#reset")
    .onclick = () => {

      localStorage.removeItem(
        "nexa_key"
      );

      localStorage.removeItem(
        "nexa_model"
      );

      S.key = "";
      S.model = "";

      render();
    };


  /* History */

  document
    .querySelectorAll(".history-item")
    .forEach(button => {

      button.onclick = () => {

        const index =
          Number(button.dataset.index);

        const item =
          S.history[index];

        if (!item || !prompt) return;

        prompt.value = item;

        S.prompt = item;

        localStorage.setItem(
          "nexa_prompt",
          item
        );

        prompt.focus();
      };

    });
}


/* =========================================================
   BUILD OR EDIT
   ========================================================= */

async function buildOrEdit() {

  if (S.busy) return;

  const input =
    document.querySelector("#prompt");

  const prompt =
    input?.value.trim();

  if (!prompt) {

    toast(
      S.site
        ? "Tell Nexa what you want to change."
        : "Describe the website you want to build.",
      true
    );

    return;
  }

  S.busy = true;
  S.prompt = prompt;
  S.steps = [];

  saveState();
  renderSteps();

  try {

    /* ================= CREATE ================= */

    if (!S.site) {

      step(
        "brief",
        "active",
        "understanding requirements"
      );

      await sleep(300);

      step(
        "brief",
        "done",
        "requirements understood"
      );


      step(
        "plan",
        "active",
        "planning website structure"
      );

      await sleep(400);

      step(
        "plan",
        "done",
        "structure planned"
      );


      step(
        "design",
        "active",
        "creating visual system"
      );

      await sleep(400);

      step(
        "design",
        "done",
        "visual system ready"
      );


      step(
        "build",
        "active",
        "generating complete website"
      );

      S.site =
        await createWebsite(prompt);

      step(
        "build",
        "done",
        "website generated"
      );


      step(
        "conten
