/* =========================================================
   NEXA BUILDER — COMPLETE APP.JS
   ========================================================= */

const S = {
  key: localStorage.getItem("nexa_key") || "",
  model: localStorage.getItem("nexa_model") || "",
  site: localStorage.getItem("nexa_site") || "",
  history: JSON.parse(localStorage.getItem("nexa_history") || "[]"),
  versions: JSON.parse(localStorage.getItem("nexa_versions") || "[]"),
  busy: false,
  steps: []
};

const STEPS = [
  ["brief", "Understanding your brief"],
  ["plan", "Planning the website structure"],
  ["design", "Designing the visual system"],
  ["build", "Building the website"],
  ["content", "Adding content and interactions"],
  ["audit", "Running quality check"],
  ["preview", "Rendering the live preview"]
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

function saveState() {
  localStorage.setItem("nexa_site", S.site || "");
  localStorage.setItem("nexa_model", S.model || "");
  localStorage.setItem(
    "nexa_history",
    JSON.stringify(S.history || [])
  );
  localStorage.setItem(
    "nexa_versions",
    JSON.stringify(S.versions || [])
  );
}

function toast(message) {
  let el = document.querySelector(".toast");

  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.style.display = "block";

  clearTimeout(el._timer);

  el._timer = setTimeout(() => {
    el.style.display = "none";
  }, 3500);
}

function step(id, status, note = "") {
  const found = S.steps.find(item => item[0] === id);

  if (found) {
    found[1] = status;
    found[2] = note;
  } else {
    S.steps.push([id, status, note]);
  }

  renderSteps();
}

function renderSteps() {
  const el = document.querySelector("#steps");

  if (!el) return;

  el.innerHTML = STEPS.map(([id, label]) => {
    const item = S.steps.find(x => x[0] === id);
    const status = item?.[1] || "";

    return `
      <div class="step ${esc(status)}">
        <span class="icon">
          ${
            status === "done"
              ? "✓"
              : status === "active"
                ? "•"
                : "○"
          }
        </span>

        <span>
          ${esc(label)}
          ${
            item?.[2]
              ? ` — ${esc(item[2])}`
              : ""
          }
        </span>
      </div>
    `;
  }).join("");
}


/* =========================================================
   GEMINI MODEL DISCOVERY
   ========================================================= */

async function models(key) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?key=" +
    encodeURIComponent(key)
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      `Gemini connection failed (HTTP ${response.status})`
    );
  }

  const available = (data.models || []).filter(model =>
    (model.supportedGenerationMethods || [])
      .includes("generateContent")
  );

  const preferred = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash"
  ];

  const selected =
    preferred
      .map(id =>
        available.find(
          model => model.name === "models/" + id
        )
      )
      .find(Boolean) ||
    available.find(model =>
      /flash/i.test(model.name)
    ) ||
    available[0];

  if (!selected) {
    throw new Error(
      "No compatible Gemini model was found."
    );
  }

  return selected.name.replace(/^models\//, "");
}


/* =========================================================
   RETRY SYSTEM
   ========================================================= */

function retryable(status, message = "") {
  const text = String(message).toLowerCase();

  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    text.includes("high demand") ||
    text.includes("overloaded") ||
    text.includes("temporarily unavailable") ||
    text.includes("resource exhausted")
  );
}

function delayFor(attempt) {
  return Math.min(
    1200 * Math.pow(2, attempt) +
    Math.floor(Math.random() * 600),
    10000
  );
}


/* =========================================================
   GEMINI REQUEST
   ========================================================= */

async function requestGemini(model, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(S.key)}`,
    {
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
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 60000
        }
      })
    }
  );

  const data =
    await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error?.message ||
      `Gemini error HTTP ${response.status}`
    );

    error.status = response.status;

    throw error;
  }

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("") ||
    "";

  if (!text.trim()) {
    throw new Error(
      "Gemini returned an empty response."
    );
  }

  return text;
}


/* =========================================================
   AI GENERATION WITH FALLBACK
   ========================================================= */

async function generateAI(prompt) {
  if (!S.key) {
    throw new Error(
      "Gemini API key is not connected."
    );
  }

  const candidates = [
    S.model,
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash"
  ].filter(Boolean);

  const uniqueModels =
    [...new Set(candidates)];

  let lastError = null;

  for (const model of uniqueModels) {

    for (let attempt = 0; attempt < 4; attempt++) {

      try {
        const result =
          await requestGemini(
            model,
            prompt
          );

        S.model = model;

        localStorage.setItem(
          "nexa_model",
          model
        );

        return result;

      } catch (error) {

        lastError = error;

        if (
          retryable(
            error.status,
            error.message
          ) &&
          attempt < 3
        ) {
          await sleep(
            delayFor(attempt)
          );

          continue;
        }

        break;
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "All Gemini models failed."
    )
  );
}


/* =========================================================
   HTML CLEANING
   ========================================================= */

function cleanHTML(html) {
  let output =
    String(html || "")
      .replace(/^\uFEFF/, "")
      .replace(/^```html\s*/i, "")
      .replace(/^```HTML\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

  const doctypeIndex =
    output
      .toLowerCase()
      .indexOf("<!doctype html");

  const htmlIndex =
    output
      .toLowerCase()
      .indexOf("<html");

  if (doctypeIndex >= 0) {
    output =
      output.slice(doctypeIndex);
  } else if (htmlIndex >= 0) {
    output =
      "<!doctype html>\n" +
      output.slice(htmlIndex);
  }

  if (
    !output
      .toLowerCase()
      .includes("<html") ||
    !output
      .toLowerCase()
      .includes("</html>")
  ) {
    throw new Error(
      "AI returned incomplete website HTML."
    );
  }

  return output;
}

function validateHTML(html) {
  const text =
    String(html || "").toLowerCase();

  return [
    "<html",
    "</html>",
    "<head",
    "</head>",
    "<body",
    "</body>"
  ].every(token =>
    text.includes(token)
  );
}


/* =========================================================
   VERSION HISTORY
   ========================================================= */

function addVersion(
  site,
  label = "Website version"
) {
  if (!site) return;

  S.versions.unshift({
    id: Date.now().toString(),
    label,
    createdAt:
      new Date().toISOString(),
    html: site
  });

  S.versions =
    S.versions.slice(0, 15);

  localStorage.setItem(
    "nexa_versions",
    JSON.stringify(S.versions)
  );
}

function restoreVersion(id) {
  const version =
    S.versions.find(
      item => item.id === id
    );

  if (!version) {
    toast("Version not found.");
    return;
  }

  if (S.site) {
    addVersion(
      S.site,
      "Before restore"
    );
  }

  S.site = version.html;

  saveState();
  render();

  toast(
    "Previous version restored."
  );
}


/* =========================================================
   WEBSITE GENERATION
   ========================================================= */

async function callAI(userPrompt) {

  const instruction = `
You are Nexa AI Website Builder.

Act as a senior product designer,
frontend engineer, UX designer and
creative director.

Create a complete professional website
from the user's brief.

The website must look like a real
professional business website.

Infer and implement:

- brand identity
- navigation
- page structure
- professional copy
- sections
- calls to action
- realistic content
- useful interactions
- responsive desktop layout
- responsive mobile layout
- accessibility
- visual hierarchy
- tasteful animations
- hover states
- working buttons
- working navigation
- realistic forms
- professional spacing
- polished typography

Do not create a text dump.

Do not use Lorem ipsum.

Do not mention AI generation.

Do not add fake claims.

Use only:
- HTML
- CSS
- vanilla JavaScript

Do not depend on React,
Vue, Angular or other frameworks.

Return ONLY ONE complete HTML document.

Start with:
<!doctype html>

Do not use Markdown.
Do not use code fences.
Do not explain anything outside HTML.

USER BRIEF:

${userPrompt}
`;

  const first =
    cleanHTML(
      await generateAI(
        instruction
      )
    );

  if (!validateHTML(first)) {
    throw new Error(
      "Generated website failed validation."
    );
  }

  /*
    Second quality pass.
    It keeps the first design but checks
    functionality and responsive behavior.
  */

  const improvePrompt = `
You are Nexa AI Quality Engineer.

Improve the existing website below.

IMPORTANT:
Keep the same business,
brand direction and main design.

Do not turn it into another website.

Check and improve:

- responsive design
- mobile layout
- navigation
- buttons
- forms
- spacing
- typography
- accessibility
- JavaScript
- visual hierarchy
- usability
- obvious broken elements
- professional polish

Do not remove important sections.

Do not add fake claims.

Return ONLY the complete HTML.

Start with:
<!doctype html>

No Markdown.
No code fences.
No explanation.

CURRENT WEBSITE:

${first}
`;

  let finalSite = first;

  try {

    const improved =
      cleanHTML(
        await generateAI(
          improvePrompt
        )
      );

    if (validateHTML(improved)) {
      finalSite = improved;
    }

  } catch (error) {

    console.warn(
      "Quality pass skipped:",
      error
    );
  }

  return finalSite;
}


/* =========================================================
   EDIT EXISTING WEBSITE
   ========================================================= */

async function editAI(editPrompt) {

  if (!S.site) {
    throw new Error(
      "There is no website to edit yet."
    );
  }

  const instruction = `
You are Nexa AI Website Editor.

The user already has a complete website.

Modify the existing website according
to the user's new instruction.

Keep the existing:

- brand
- useful sections
- useful content
- navigation
- design language

unless the user specifically asks
to change them.

Actually implement the requested change.

Make sure:

- existing functionality works
- buttons work
- navigation works
- forms work
- mobile layout works
- desktop layout works
- responsive behavior works
- no broken HTML
- no broken JavaScript
- no placeholder text

Return ONLY the COMPLETE updated HTML.

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

  const result =
    cleanHTML(
      await generateAI(
        instruction
      )
    );

  if (!validateHTML(result)) {
    throw new Error(
      "Edited website failed validation."
    );
  }

  return result;
}


/* =========================================================
   SETUP
   ========================================================= */

function setup() {

  document.querySelector("#app")
    .innerHTML = `

    <div class="setup">

      <div class="card">

        <div class="logo">
          ✦
        </div>

        <div
          class="eyebrow"
          style="margin-top:18px"
        >
          ONE-TIME SETUP
        </div>

        <h1>
          Connect your AI
        </h1>

        <p class="muted">
          Connect your Gemini API key.
          Nexa will automatically find
          a compatible model.
        </p>

        <b>
          Gemini API Key
        </b>

        <input
          id="key"
          class="key"
          type="password"
          placeholder="AIza..."
          autocomplete="off"
          spellcheck="false"
        >

        <button
          id="connect"
          class="btn purple"
          style="
            width:100%;
            margin-top:12px
          "
        >
          Connect & Open Builder ✦
        </button>

        <div id="err"></div>

        <p
          class="muted"
          style="
            font-size:12px;
            margin-top:14px
          "
        >
          Your key stays in this browser.
        </p>

      </div>

    </div>
  `;

  const keyInput =
    document.querySelector("#key");

  const connectButton =
    document.querySelector("#connect");

  connectButton.onclick =
    async () => {

      const key =
        keyInput.value.trim();

      if (!key) {

        document.querySelector("#err")
          .innerHTML = `
            <div class="error">
              Please enter your Gemini API key.
            </div>
          `;

        return;
      }

      connectButton.disabled = true;

      connectButton.textContent =
        "Connecting…";

      try {

        const model =
          await models(key);

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

        document.querySelector("#err")
          .innerHTML = `
            <div class="error">
              ${esc(error.message)}
            </div>
          `;

      } finally {

        connectButton.disabled = false;

        connectButton.textContent =
          "Connect & Open Builder ✦";
      }
    };

  keyInput.addEventListener(
    "keydown",
    event => {

      if (event.key === "Enter") {
        connectButton.click();
      }

    }
  );
}


/* =========================================================
   BUILDER
   ========================================================= */

function builder() {

  document.querySelector("#app")
    .innerHTML = `

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
            ${S.site ? "" : "disabled"}
          >
            Preview
          </button>

          <button
            id="historyTop"
            class="btn"
            ${S.versions.length ? "" : "disabled"}
          >
            History
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
            Build a real website from a prompt.
          </div>

          <p class="muted">
            Create a website or edit your
            existing website with AI.
          </p>

          <textarea
            id="prompt"
            class="prompt"
            placeholder="${
              S.site
                ? "Tell Nexa what you want to change..."
                : "Create a premium perfume website for Noir Essence..."
            }"
          ></textarea>


          <div class="build">

            <button
              id="build"
              class="btn primary"
            >
              ${
                S.site
                  ? "Edit Website ✦"
                  : "Build ✦"
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
            S.versions.length
              ? `
                <div
                  class="status"
                  style="margin-top:12px"
                >

                  <div class="status-head">
                    <b>
                      Recent versions
                    </b>
                  </div>

                  <div>

                    ${S.versions
                      .slice(0, 5)
                      .map(version => `
                        <div
                          class="step"
                          style="cursor:pointer"
                          data-version="${esc(version.id)}"
                        >

                          <span class="icon">
                            ↶
                          </span>

                          <span>

                            ${esc(version.label)}

                            <small
                              style="
                                display:block;
                                opacity:.6
                              "
                            >
                              ${esc(
                                new Date(
                                  version.createdAt
                                ).toLocaleString()
                              )}
                            </small>

                          </span>

                        </div>
                      `)
                      .join("")}

                  </div>

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
                ${S.site ? "" : "disabled"}
              >
                Open
              </button>

              <button
                id="export"
                class="btn"
                ${S.site ? "" : "disabled"}
              >
                Export
              </button>

              <button
                id="public"
                class="btn purple"
            
