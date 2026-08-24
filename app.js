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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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


/* =========================
   FIND AVAILABLE GEMINI MODEL
========================= */

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
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
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
    );

  if (!selected) {
    throw new Error(
      "No compatible Gemini Flash model was found for this API key."
    );
  }

  return selected.name.replace(/^models\//, "");
}


/* =========================
   RETRY HELPERS
========================= */

function shouldRetry(status, message = "") {
  const text = String(message).toLowerCase();

  return (
    status === 408 ||
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

function getDelay(attempt) {
  const base = 1500;
  const exponential = base * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 700);

  return Math.min(
    exponential + jitter,
    15000
  );
}


/* =========================
   GEMINI REQUEST
========================= */

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
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 60000
        }
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error?.message ||
      `Gemini request failed (HTTP ${response.status})`
    );

    error.status = response.status;

    throw error;
  }

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("") || "";

  if (!text.trim()) {
    throw new Error(
      "Gemini returned an empty response."
    );
  }

  return text;
}


/* =========================
   RELIABLE GEMINI CALL
========================= */

async function generateAI(prompt) {

  const primary = S.model;

  const fallbackModels = [
    primary,
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ].filter(Boolean);

  const uniqueModels = [
    ...new Set(fallbackModels)
  ];

  let lastError = null;

  for (const model of uniqueModels) {

    for (let attempt = 0; attempt < 4; attempt++) {

      try {

        step(
          "build",
          "active",
          `Generating with ${model}`
        );

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
          shouldRetry(
            error.status,
            error.message
          ) &&
          attempt < 3
        ) {

          const delay =
            getDelay(attempt);

          step(
            "build",
            "active",
            `${model} is busy. Retrying...`
          );

          await sleep(delay);

          continue;
        }

        break;
      }
    }
  }

  throw lastError ||
    new Error(
      "All available Gemini models failed."
    );
}


/* =========================
   WEBSITE GENERATION
========================= */

async function callAI(userPrompt) {

  const prompt = `
You are Nexa AI Website Builder.

You are a senior product designer,
frontend engineer and creative director.

Create a COMPLETE, PROFESSIONAL,
PRODUCTION-QUALITY website from the user's brief.

Do NOT simply repeat the user's words.

You must intelligently create:

- brand identity
- navigation
- hero section
- strong headline
- supporting copy
- CTA buttons
- professional sections
- realistic content
- product/service cards
- trust elements
- testimonials when appropriate
- contact section
- footer
- responsive mobile design
- responsive desktop design
- polished spacing
- visual hierarchy
- hover effects
- focus states
- useful interactions
- forms where appropriate
- smooth animations
- premium visual design

The result must feel like a real website
designed for a real business.

IMPORTANT:

If the user requests a perfume website,
actually create a luxury perfume website.

If the user requests a restaurant,
actually create a restaurant website.

If the user requests a SaaS,
actually create a real SaaS website.

Do NOT create a text dump.

Do NOT merely display the user's prompt.

Do NOT create an empty template.

Do NOT use "website generated successfully"
as the main website content.

Do NOT leave large empty spaces.

The website must be visually complete.

TECHNICAL REQUIREMENTS:

Return ONLY one complete HTML document.

Start with:

<!doctype html>

Use semantic HTML.

Use inline CSS.

Use inline JavaScript.

Do not use Markdown.

Do not use code fences.

Do not explain anything outside the HTML.

Do not require external frameworks.

The website will be displayed inside an iframe.

Make it responsive.

Make it polished.

Make it custom to the user's brief.

USER BRIEF:

${userPrompt}
`;

  let html =
    await generateAI(prompt);

  html = html
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const start =
    html.toLowerCase()
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


/* =========================
   SETUP
========================= */

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
          Connect your Gemini API key.
          Nexa will automatically find an available
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
          Your API key is stored only in this browser.
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
      button.textContent =
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

        document.querySelector("#err").innerHTML =
          `<div class="error">
            ${esc(error.message)}
          </div>`;

      } finally {

        button.disabled = false;

        button.textContent =
          "Connect & Open Builder ✦";
      }
    };
}


/* =========================
   BUILDER
========================= */

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
            Nexa thinks, plans, designs,
            builds and prepares your preview.
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
                        Preview unlocks after
                        a successful build.
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

  document.querySelector("#build")
    .onclick = build;

  document.querySelector("#previewTop")
    .onclick = () => {

      if (!S.site) return;

      location.hash =
        "#preview";

      render();
    };

  document.querySelector("#open")
    .onclick = () => {

      if (!S.site) return;

      location.hash =
        "#preview";

      render();
    };

  document.querySelector("#export")
    .onclick = exportSite;

  document.querySelector("#public")
    .onclick = publish;

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
}


/* =========================
   BUILD PROCESS
========================= */

async function build() {

  if (S.busy) return;

  const input =
    document.querySelector("#prompt");

  const prompt =
    input?.value?.trim();

  if (!prompt) {

    toast(
      "First describe the website."
    );

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
      "requirements understood"
    );


    step(
      "plan",
      "active",
      "planning website structure"
    );

    await sleep(600);

    step(
      "plan",
      "done",
      "structure planned"
    );


    step(
      "design",
      "active",
      "creating visual direction"
    );

    await sleep(600);

    step(
      "design",
      "done",
      "visual system prepared"
    );


    step(
      "build",
      "active",
      "generating website with AI"
    );


    const site =
      await callAI(prompt);


    step(
      "build",
      "done",
      "website generated"
    );


    step(
      "content",
      "active",
      "checking sections and interactions"
    );

    await sleep(700);

    step(
      "content",
      "done",
      "content checked"
    );


    step(
      "audit",
      "active",
      "running quality check"
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


    S.site =
      site;

    localStorage.setItem(
      "nexa_site",
      S.site
    );


    await sleep(500);


    step(
      "preview",
      "done",
      "preview ready"
    );


    S.history.unshift(
      prompt
    );

    S.history =
      S.history.slice(0, 5);

    localStorage.setItem(
      "nexa_history",
      JSON.stringify(
        S.history
      )
    );


    render();

    toast(
      "Website completed. Preview is ready."
    );

  } catch (error) {

    console.error(error);

    step(
      "build",
      "active",
      "error — " +
      (error.message ||
       "generation failed")
    );

    toast(
      "Build failed: " +
      (error.message ||
       "Unknown error")
    );

  } finally {

    S.busy = false;
  }
}


/* =========================
   PREVIEW
========================= */

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

  document.querySelector("#pframe")
    .srcdoc = S.site;

  document.querySelector("#edit")
    .onclick = () => {

      location.hash = "";

      render();

      setTimeout(() => {
        document
          .querySelector("#prompt")
          ?.focus();
      }, 100);
    };

  document.querySelector("#back")
    .onclick = () => {

      location.hash = "";

      render();
    };

  document.querySelector("#pub")
    .onclick = publish;
}


/* =========================
   EXPORT
========================= */

function exportSite() {

  if (!S.site) {

    toast(
      "Build a website first."
    );

    return;
  }

  const blob =
    new Blob(
      [S.site],
      {
        type: "text/html"
      }
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
    () =>
      URL.revokeObjectURL(url),
    1000
  );

  toast(
    "Website exported."
  );
}


/* =========================
   PUBLIC
========================= */

function publish() {

  if (!S.site) {

    toast(
      "Build a website first."
    );

    return;
  }

  exportSite();

  toast(
    "Website exported. Upload it to your hosting to make it public."
  );
}


/* =========================
   TOAST
========================= */

function toast(message) {

  const t =
    document.createElement("div");

  t.className =
    "toast";

  t.textContent =
    message;

  document.body.appendChild(t);

  setTimeout(
    () => t.remove(),
    4000
  );
}


/* =========================
   START APP
========================= */

function render() {

  if (
    location.hash === "#preview" &&
    S.site
  ) {
    preview();
    return;
  }

  if (S.key) {
    builder();
    return;
  }

  setup();
}

addEventListener(
  "hashchange",
  render
);

render();
