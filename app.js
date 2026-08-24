/* =========================================================
   NEXA AI WEBSITE BUILDER
   COMPLETE APP.JS
========================================================= */

const S = {
  key: localStorage.getItem("nexa_key") || "",
  model: localStorage.getItem("nexa_model") || "",
  site: localStorage.getItem("nexa_site") || "",
  history: JSON.parse(
    localStorage.getItem("nexa_history") || "[]"
  ),
  busy: false,
  steps: []
};


/* =========================================================
   BUILD STEPS
========================================================= */

const STEPS = [
  ["brief", "Understanding your brief"],
  ["plan", "Planning the website structure"],
  ["design", "Designing the visual system"],
  ["build", "Building the website"],
  ["content", "Adding content and interactions"],
  ["audit", "Running quality check"],
  ["preview", "Rendering the live preview"]
];


/* =========================================================
   HELPERS
========================================================= */

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


const esc = value =>
  String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));


/* =========================================================
   BUILD STEP STATE
========================================================= */

function step(id, status, note = "") {

  let item =
    S.steps.find(x => x[0] === id);

  if (item) {

    item[1] = status;
    item[2] = note;

  } else {

    S.steps.push([
      id,
      status,
      note
    ]);

  }

  renderSteps();
}


/* =========================================================
   RENDER BUILD STEPS
========================================================= */

function renderSteps() {

  const element =
    document.querySelector("#steps");

  if (!element) return;

  element.innerHTML =
    STEPS.map(([id, label]) => {

      const item =
        S.steps.find(x => x[0] === id);

      const status =
        item?.[1] || "";

      const note =
        item?.[2] || "";

      const icon =
        status === "done"
          ? "✓"
          : status === "active"
            ? "•"
            : "○";

      return `
        <div class="step ${status}">
          <span class="icon">${icon}</span>
          <span>
            ${label}
            ${
              note
                ? ` — ${esc(note)}`
                : ""
            }
          </span>
        </div>
      `;

    }).join("");
}


/* =========================================================
   FIND AVAILABLE GEMINI MODEL
========================================================= */

async function models(key) {

  const response =
    await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?key=" +
      encodeURIComponent(key)
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {

    throw new Error(
      data.error?.message ||
      `Gemini connection failed (HTTP ${response.status})`
    );

  }

  const available =
    (data.models || []).filter(model =>
      (
        model.supportedGenerationMethods ||
        []
      ).includes("generateContent")
    );

  if (!available.length) {

    throw new Error(
      "No Gemini generateContent model is available for this API key."
    );

  }

  /*
    Prefer Flash models because Nexa needs
    fast website generation.
  */

  const flash =
    available.find(model =>
      /flash/i.test(model.name)
    );

  const selected =
    flash || available[0];

  return selected.name
    .replace(/^models\//, "");
}


/* =========================================================
   RETRY CHECK
========================================================= */

function retryable(
  status,
  message = ""
) {

  const text =
    String(message).toLowerCase();

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


/* =========================================================
   RETRY DELAY
========================================================= */

function delayFor(attempt) {

  return Math.min(
    1500 *
      Math.pow(2, attempt) +
      Math.floor(
        Math.random() * 500
      ),
    12000
  );
}


/* =========================================================
   GEMINI REQUEST
========================================================= */

async function requestGemini(
  model,
  prompt
) {

  const response =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(S.key)}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({

          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],

          generationConfig: {

            temperature: 0.8,

            maxOutputTokens: 60000

          }

        })
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {

    const error =
      new Error(
        data.error?.message ||
        `Gemini error HTTP ${response.status}`
      );

    error.status =
      response.status;

    throw error;
  }

  const text =
    data
      .candidates?.[0]
      ?.content?.parts
      ?.map(part =>
        part.text || ""
      )
      .join("") || "";

  if (!text.trim()) {

    throw new Error(
      "Gemini returned an empty response."
    );

  }

  return text;
}


/* =========================================================
   AI GENERATION WITH RETRIES
========================================================= */

async function generateAI(prompt) {

  /*
    First use the currently selected model.
    If it fails, discover another available model.
  */

  let modelList = [];

  if (S.model) {
    modelList.push(S.model);
  }

  try {

    const discovered =
      await models(S.key);

    if (discovered) {
      modelList.push(discovered);
    }

  } catch (_) {
    /*
      Ignore discovery failure here.
      Existing model may still work.
    */
  }

  const uniqueModels =
    [...new Set(
      modelList.filter(Boolean)
    )];

  if (!uniqueModels.length) {

    throw new Error(
      "No usable Gemini model was found."
    );

  }

  let lastError = null;

  for (
    const model of uniqueModels
  ) {

    for (
      let attempt = 0;
      attempt < 4;
      attempt++
    ) {

      try {

        const result =
          await requestGemini(
            model,
            prompt
          );

        S.model =
          model;

        localStorage.setItem(
          "nexa_model",
          model
        );

        return result;

      } catch (error) {

        lastError =
          error;

        console.error(
          "Nexa Gemini error:",
          error
        );

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
      "All Gemini attempts failed."
    )
  );
}


/* =========================================================
   CLEAN GENERATED HTML
========================================================= */

function cleanHTML(html) {

  let output =
    String(html)

      .replace(
        /^```html\s*/i,
        ""
      )

      .replace(
        /^```\s*/,
        ""
      )

      .replace(
        /```\s*$/i,
        ""
      )

      .trim();

  const doctypeIndex =
    output
      .toLowerCase()
      .indexOf("<!doctype html");

  if (doctypeIndex >= 0) {

    output =
      output.slice(
        doctypeIndex
      );

  }

  if (
    !output
      .toLowerCase()
      .includes("<html")
  ) {

    throw new Error(
      "AI returned incomplete website HTML."
    );

  }

  if (
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


/* =========================================================
   CREATE NEW WEBSITE
========================================================= */

async function callAI(
  userPrompt
) {

  const instruction = `
You are Nexa AI Website Builder.

You are a senior product designer,
frontend engineer, UX designer and
creative director.

Build a COMPLETE professional website
from the user's brief.

Do not simply repeat the brief.

Infer and create:

- brand identity
- navigation
- professional layout
- strong hero section
- realistic copy
- useful sections
- clear CTA hierarchy
- features
- services when appropriate
- testimonials when appropriate
- pricing when appropriate
- FAQ when appropriate
- footer
- useful interactions
- hover states
- responsive behavior
- mobile navigation
- desktop layout
- accessibility
- polished spacing
- professional typography
- modern visual hierarchy
- subtle animations

The website must feel like a real
production website.

Do NOT make a simple text dump.

Do NOT create an empty page.

Do NOT use placeholder text such as
"Lorem ipsum".

Do NOT mention that you are an AI.

Return ONLY one complete HTML document.

The response MUST start with:

<!doctype html>

Use:

- HTML
- inline CSS
- inline JavaScript

Do not require React.

Do not require Next.js.

Do not require Tailwind.

Do not use external framework dependencies.

Avoid external dependencies whenever possible.

Make the website work as a standalone
HTML document.

USER WEBSITE BRIEF:

${userPrompt}
`;

  const result =
    await generateAI(
      instruction
    );

  return cleanHTML(result);
}


/* =========================================================
   EDIT EXISTING WEBSITE
========================================================= */

async function editAI(
  editPrompt
) {

  if (!S.site) {

    throw new Error(
      "There is no website to edit yet."
    );

  }

  const instruction = `
You are Nexa AI Website Editor.

The user already has a complete website.

Modify the existing website according
to the user's edit request.

IMPORTANT:

Do NOT replace the website with an
unrelated design.

Keep the existing:

- brand identity
- navigation
- useful content
- design language
- layout structure

unless the user explicitly asks
to change them.

Actually implement the requested
changes.

Improve the result where necessary.

Make sure:

- HTML remains valid
- CSS remains valid
- JavaScript remains valid
- buttons work
- navigation works
- forms work when present
- responsive design remains good
- mobile layout remains good
- desktop layout remains good
- no broken sections
- no placeholder text
- no unnecessary blank areas
- professional visual hierarchy
- existing useful content is preserved

Return ONLY the complete updated
HTML document.

Start with:

<!doctype html>

USER EDIT REQUEST:

${editPrompt}

CURRENT WEBSITE:

${S.site}
`;

  const result =
    await generateAI(
      instruction
    );

  return cleanHTML(result);
}


/* =========================================================
   SETUP SCREEN
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
            an available model.
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
            Your key stays in this browser.
            Keep your builder private.
          </p>

        </div>

      </div>
    `;

  const button =
    document.querySelector(
      "#connect"
    );

  button.onclick =
    async () => {

      const input =
        document.querySelector(
          "#key"
        );

      const key =
        input.value.trim();

      if (!key) {

        document.querySelector(
          "#err"
        ).innerHTML =
          `<div class="error">
            Please enter your Gemini API key.
          </div>`;

        return;
      }

      button.disabled =
        true;

      button.textContent =
        "Connecting…";

      try {

        const model =
          await models(key);

        S.key =
          key;

        S.model =
          model;

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

        console.error(
          error
        );

        document.querySelector(
          "#err"
        ).innerHTML =
          `<div class="error">
            ${esc(error.message)}
          </div>`;

      } finally {

        button.disabled =
          false;

        button.textContent =
          "Connect & Open Builder ✦";
      }
    };
}


/* =========================================================
   BUILDER SCREEN
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
                S.site
                  ? "Edit your website with AI."
                  : "Build a real website from a prompt."
              }
            </div>

            <p class="muted">
              ${
                S.site
                  ? "Tell Nexa what you want to change and AI will update the existing website."
                  : "Nexa understands your brief, designs the website and generates the complete site."
              }
            </p>

            <textarea
              id="prompt"
              class="prompt"
              placeholder="${
                S.site
                  ? "Example: Add a pricing section, change the colors to black and gold, and improve the mobile layout."
                  : "Example: Create a premium perfume website for Noir Essence with a luxury black and gold design."
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

                <span class="dot">
                </span>

              </div>

              <div id="steps">
              </div>

            </div>

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
                  ${S.site ? "" : "disabled"}
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
                  S.site
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
                            Your finished website appears here
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


  if (S.site) {

    const frame =
      document.querySelector(
        "#frame"
      );

    if (frame) {

      frame.srcdoc =
        S.site;

    }

  }


  document.querySelector(
    "#build"
  ).onclick =
    buildOrEdit;


  document.querySelector(
    "#previewTop"
  ).onclick =
    () => {

      if (!S.site) return;

      location.hash =
        "#preview";

      render();
    };


  document.querySelector(
    "#open"
  ).onclick =
    () => {

      if (!S.site) return;

      location.hash =
        "#preview";

      render();
    };


  document.querySelector(
    "#export"
  ).onclick =
    exportSite;


  document.querySelector(
    "#public"
  ).onclick =
    publish;


  document.querySelector(
    "#reset"
  ).onclick =
    () => {

      const confirmReset =
        confirm(
          "Reset your Gemini connection?"
        );

      if (!confirmReset) return;

      localStorage.removeItem(
        "nexa_key"
      );

      localStorage.removeItem(
        "nexa_model"
      );

      S.key =
        "";

      S.model =
        "";

      render();
    };
}


/* =========================================================
   BUILD OR EDIT WEBSITE
========================================================= */

async function buildOrEdit() {

  if (S.busy) return;

  const input =
    document.querySelector(
      "#prompt"
    );

  const prompt =
    input?.value?.trim
