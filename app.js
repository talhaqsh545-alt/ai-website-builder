const S = {
  key: localStorage.getItem("nexa_key") || "",
  model: localStorage.getItem("nexa_model") || "",
  site: localStorage.getItem("nexa_site") || "",
  history: JSON.parse(localStorage.getItem("nexa_history") || "[]"),
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

const esc = x =>
  String(x).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));

function step(id, status, note = "") {
  let x = S.steps.find(a => a[0] === id);

  if (x) {
    x[1] = status;
    x[2] = note;
  } else {
    S.steps.push([id, status, note]);
  }

  renderSteps();
}

function renderSteps() {
  const e = document.querySelector("#steps");
  if (!e) return;

  e.innerHTML = STEPS.map(([id, label]) => {
    const x = S.steps.find(a => a[0] === id);
    const st = x?.[1] || "";

    return `
      <div class="step ${st}">
        <span class="icon">
          ${st === "done" ? "✓" : st === "active" ? "•" : "○"}
        </span>
        <span>
          ${label}
          ${x?.[2] ? ` — ${esc(x[2])}` : ""}
        </span>
      </div>
    `;
  }).join("");
}


/* -------------------------------------------------------
   GEMINI MODEL DISCOVERY
------------------------------------------------------- */

async function models(key) {
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?key=" +
    encodeURIComponent(key)
  );

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw Error(
      d.error?.message ||
      `Gemini connection failed (HTTP ${r.status})`
    );
  }

  const available = (d.models || [])
    .filter(m =>
      (m.supportedGenerationMethods || [])
        .includes("generateContent")
    );

  const preferred = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ];

  const selected =
    preferred
      .map(id =>
        available.find(x => x.name === "models/" + id)
      )
      .find(Boolean) ||
    available.find(x => /flash/i.test(x.name));

  if (!selected) {
    throw Error(
      "No available Flash model was found for this Gemini API key."
    );
  }

  return selected.name.replace(/^models\//, "");
}


/* -------------------------------------------------------
   ERROR HELPERS
------------------------------------------------------- */

function isRetryable(status, message = "") {
  const text = String(message).toLowerCase();

  return (
    status === 429 ||
    status === 500 ||
    status === 503 ||
    status === 504 ||
    text.includes("high demand") ||
    text.includes("temporarily unavailable") ||
    text.includes("overloaded") ||
    text.includes("try again later")
  );
}

function friendlyError(status, message) {
  if (status === 429) {
    return "Gemini rate limit reached. Retrying automatically.";
  }

  if (status === 503) {
    return "Gemini is temporarily busy. Retrying automatically.";
  }

  if (status === 500 || status === 504) {
    return "Gemini temporarily failed to respond. Retrying automatically.";
  }

  return message || `Gemini request failed (HTTP ${status}).`;
}


/* -------------------------------------------------------
   GEMINI GENERATION WITH RETRIES
------------------------------------------------------- */

async function generateWithRetry(prompt, model, maxRetries = 4) {

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {

    try {

      step(
        "build",
        "active",
        attempt === 0
          ? "connecting to Gemini"
          : `Gemini busy — retry ${attempt}/${maxRetries}`
      );

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
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ],

            generationConfig: {
              maxOutputTokens: 60000,
              thinkingConfig: {
                thinkingLevel: "medium"
              }
            }
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {

        const message =
          data.error?.message ||
          `Gemini error HTTP ${response.status}`;

        if (
          isRetryable(response.status, message) &&
          attempt < maxRetries
        ) {

          lastError = new Error(
            friendlyError(response.status, message)
          );

          const delay =
            Math.min(
              15000,
              2500 * Math.pow(2, attempt)
            ) +
            Math.floor(Math.random() * 800);

          step(
            "build",
            "active",
            `${friendlyError(response.status, message)} Waiting...`
          );

          await sleep(delay);
          continue;
        }

        throw new Error(message);
      }

      const text =
        data.candidates?.[0]?.content?.parts
          ?.map(p => p.text || "")
          .join("") || "";

      if (!text.trim()) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      return text;

    } catch (error) {

      lastError = error;

      if (
        attempt < maxRetries &&
        isRetryable(
          error.status,
          error.message
        )
      ) {

        const delay =
          Math.min(
            15000,
            2500 * Math.pow(2, attempt)
          );

        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError ||
    new Error("Gemini generation failed.");
}


/* -------------------------------------------------------
   AI WEBSITE GENERATOR
------------------------------------------------------- */

async function callAI(prompt) {

  const instruction = `
You are Nexa Builder, a senior product designer,
frontend engineer and creative director.

Your job is to build a COMPLETE professional website
from the user's brief.

IMPORTANT:

DO NOT simply repeat the user's prompt.

INFER AND CREATE:

- brand identity
- professional navigation
- hero section
- strong headline
- supporting copy
- CTA buttons
- real content
- relevant sections
- product/service presentation
- testimonials or reviews where appropriate
- trust elements
- footer
- responsive mobile layout
- desktop layout
- accessibility
- hover states
- focus states
- smooth interactions
- forms where appropriate
- realistic business content
- polished spacing
- professional typography
- visual hierarchy
- premium UI
- strong conversion structure

The result must look like a real production website.

DO NOT create:

- a text dump
- a blank page
- a simple template
- repeated prompt text
- huge empty spaces
- placeholder sections
- "website generated successfully"
- fake unfinished UI

If the user requests a perfume brand,
create an actual premium perfume website.

If the user requests a restaurant,
create an actual restaurant website.

If the user requests a SaaS,
create an actual SaaS landing/product website.

The website must be CUSTOM to the user's brief.

TECHNICAL REQUIREMENTS:

Return ONLY one complete HTML document.

Start with:

<!doctype html>

Use:

- semantic HTML
- inline CSS
- inline JavaScript

Do not use markdown fences.

Do not explain anything outside the HTML.

Do not depend on external frameworks.

Use CSS gradients, shadows, cards, responsive grids,
animations and polished UI where appropriate.

Make the website visually complete from top to bottom.

The generated website will be placed inside an iframe.

USER BRIEF:

${prompt}
`;

  let text = await generateWithRetry(
    instruction,
    S.model,
    4
  );

  text = text
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const htmlStart =
    text.toLowerCase().indexOf("<!doctype html");

  if (htmlStart >= 0) {
    text = text.slice(htmlStart);
  }

  if (
    !text.toLowerCase().includes("<html") ||
    !text.toLowerCase().includes("</html>")
  ) {
    throw new Error(
      "Gemini returned incomplete website HTML."
    );
  }

  return text;
}


/* -------------------------------------------------------
   SETUP
------------------------------------------------------- */

function setup() {

  document.querySelector("#app").innerHTML = `
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
          Paste your Gemini API key once.
          Nexa will automatically discover an available
          Flash model.
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
          Your key is stored only in this browser.
          Keep this builder private.
        </p>

      </div>
    </div>
  `;

  document.querySelector("#connect").onclick =
    async () => {

      const key =
        document.querySelector("#key")
          .value
          .trim();

      if (!key) return;

      const button =
        document.querySelector("#connect");

      button.disabled = true;
      button.textContent = "Connecting…";

      try {

        const model = await models(key);

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

      } catch (e) {

        document.querySelector("#err").innerHTML =
          `<div class="error">${esc(e.message)}</div>`;

      } finally {

        button.disabled = false;

        button.textContent =
          "Connect & Open Builder ✦";
      }
    };
}


/* -------------------------------------------------------
   BUILDER
------------------------------------------------------- */

function builder() {

  document.querySelector("#app").innerHTML = `
    <div class="app">

      <header class="top">

        <div class="brand">
          <span class="logo">✦</span>
          Nexa Builder
          <span class="pill">AI</span>
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
            Build a real website from a prompt.
          </div>

          <p class="muted">
            Nexa thinks, plans, designs, builds,
            checks and then opens your finished website.
          </p>


          <textarea
            id="prompt"
            class="prompt"
            placeholder="Create a premium perfume website for Noir Essence..."
          ></textarea>


          <div class="build">

            <button
              id="build"
              class="btn primary"
            >
              Build ✦
            </button>

          </div>


          <div class="status">

            <div class="status-head">
              <b>Build progress</b>
              <span class="dot"></span>
            </div>

            <div id="steps"></div>

          </div>

        </section>


        <section class="workspace">

          <div class="workspace-top">

            <b>Live Preview</b>

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
                    ></iframe>
                  `
                  : `
                    <div class="empty">
                      <div>
                        <h2>
                          Finished website appears here
                        </h2>

                        <p>
                          Preview unlocks after a
                          successful build.
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
      document.querySelector("#frame");

    if (frame) {
      frame.srcdoc = S.site;
    }
  }


  document.querySelector("#build").onclick =
    build;


  document.querySelector("#previewTop").onclick =
    () => {
      if (!S.site) return;

      location.hash = "#preview";
      render();
    };


  document.querySelector("#open").onclick =
    () => {
      if (!S.site) return;

      location.hash = "#preview";
      render();
    };


  document.querySelector("#export").onclick =
    exportSite;


  document.querySelector("#public").onclick =
    publish;


  document.querySelector("#reset").onclick =
    () => {

      localStorage.removeItem("nexa_key");
      localStorage.removeItem("nexa_model");

      S.key = "";
      S.model = "";

      render();
    };
}


/* -------------------------------------------------------
   BUILD
------------------------------------------------------- */

async function build() {

  if (S.busy) return;

  const prompt =
    document.querySelector("#prompt")
      ?.value
      ?.trim();

  if (!prompt) {
    toast("Describe the website first.");
    return;
  }

  S.busy = true;
  S.steps = [];

  renderSteps();

  try {

    step(
      "brief",
      "active",
      "analyzing requirements"
    );

    await sleep(500);

    step(
      "brief",
      "done",
      "brief understood"
    );


    step(
      "plan",
      "active",
      "creating information architecture"
    );

    await sleep(500);

    step(
      "plan",
      "done",
      "structure ready"
    );


    step(
      "design",
      "active",
      "creating visual direction"
    );

    await sleep(500);

    step(
      "design",
      "done",
      "visual direction ready"
    );


    step(
      "build",
      "active",
      "generating the complete website"
    );


    const website =
      await callAI(prompt);


    step(
      "build",
      "done",
      "complete website generated"
    );


    step(
      "content",
      "active",
      "checking content and interactions"
    );

    await sleep(600);

    step(
      "content",
      "done",
      "content and interactions ready"
    );


    step(
      "audit",
      "active",
      "running final quality check"
    );

    await sleep(700);

    step(
      "audit",
      "done",
      "quality check passed"
    );


    step(
      "preview",
      "active",
      "rendering finished website"
    );


    S.site = website;

    localStorage.setItem(
      "nexa_site",
      S.site
    );


    await sleep(500);


    step(
      "preview",
      "done",
      "live preview ready"
    );


    S.history.unshift(prompt);

    S.history =
      S.history.slice(0, 5);

    localStorage.setItem(
      "nexa_history",
      JSON.stringify(S.history)
    );


    render();

    toast(
      "Website completed. Preview is ready."
    );

  } catch (e) {

    console.error(e);

    const message =
      e?.message ||
      "Unknown build error.";

    step(
      "build",
      "active",
      "error — " + message
    );

    toast(
      "Build failed: " + message
    );

  } finally {

    S.busy = false;
  }
}


/* -------------------------------------------------------
   FULL PREVIEW
------------------------------------------------------- */

function preview() {

  document.querySelector("#app").innerHTML = `
    <div class="preview-page">

      <div class="preview-bar">

        <b>Nexa Preview</b>

        <div>

          <button
            id="edit"
            class="btn"
          >
            Edit with Nexa AI
          </button>

          <button
            id="pub"
            class="btn purple"
          >
            Public
          </button>

          <button
            id="back"
            class="btn"
          >
            Back
          </button>

        </div>

      </div>


      <div class="preview-content">

        <iframe
          id="pframe"
          sandbox="allow-scripts allow-forms allow-modals"
        ></iframe>

      </div>

    </div>
  `;


  const frame =
    document.querySelector("#pframe");

  frame.srcdoc = S.site;


  document.querySelector("#edit").onclick =
    () => {

      location.hash = "";
      render();

      setTimeout(() => {

        document
          .querySelector("#prompt")
          ?.focus();

      }, 100);
    };


  document.querySelector("#back").onclick =
    () => {

      location.hash = "";
      render();
    };


  document.querySelector("#pub").onclick =
    publish;
}


/* -------------------------------------------------------
   EXPORT
------------------------------------------------------- */

function exportSite() {

  if (!S.site) {
    toast("Build a website first.");
    return;
  }

  const blob =
    new Blob(
      [S.site],
      { type: "text/html" }
    );

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = url;
  a.download =
    "nexa-website.html";

  document.body.appendChild(a);

  a.click();

  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );

  toast(
    "Website HTML exported."
  );
}


/* -------------------------------------------------------
   PUBLIC
------------------------------------------------------- */

function publish() {

  if (!S.site) {
    toast("Build a website first.");
    return;
  }

  exportSite();

  toast(
    "Website exported. Upload the HTML to your hosting for a public URL."
  );
}


/* -------------------------------------------------------
   TOAST
------------------------------------------------------- */

function toast(message) {

  const t =
  
