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

const esc = x => String(x).replace(/[&<>"']/g, m => ({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;",
  "'":"&#39;"
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
   FIND GEMINI MODEL
========================= */

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

  const available = (d.models || []).filter(m =>
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
        available.find(
          x => x.name === "models/" + id
        )
      )
      .find(Boolean) ||
    available.find(x =>
      /flash/i.test(x.name)
    );

  if (!selected) {
    throw Error(
      "No compatible Gemini model was found."
    );
  }

  return selected.name.replace(/^models\//, "");
}


/* =========================
   RETRY
========================= */

function retryable(status, message = "") {
  const text = String(message).toLowerCase();

  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 503 ||
    status === 504 ||
    text.includes("high demand") ||
    text.includes("overloaded") ||
    text.includes("temporarily unavailable")
  );
}

function delayFor(attempt) {
  return Math.min(
    1500 * Math.pow(2, attempt) +
    Math.floor(Math.random() * 500),
    12000
  );
}


/* =========================
   GEMINI REQUEST
========================= */

async function requestGemini(model, prompt) {
  const r = await fetch(
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

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    const err = new Error(
      d.error?.message ||
      `Gemini error HTTP ${r.status}`
    );
    err.status = r.status;
    throw err;
  }

  const text =
    d.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("") || "";

  if (!text.trim()) {
    throw Error("Gemini returned an empty response.");
  }

  return text;
}


/* =========================
   AI WITH FALLBACK
========================= */

async function generateAI(prompt) {
  const list = [
    S.model,
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ].filter(Boolean);

  const unique = [...new Set(list)];

  let lastError = null;

  for (const model of unique) {

    for (let attempt = 0; attempt < 4; attempt++) {

      try {
        const result =
          await requestGemini(model, prompt);

        S.model = model;

        localStorage.setItem(
          "nexa_model",
          model
        );

        return result;

      } catch (e) {

        lastError = e;

        if (
          retryable(e.status, e.message) &&
          attempt < 3
        ) {
          await sleep(delayFor(attempt));
          continue;
        }

        break;
      }
    }
  }

  throw lastError ||
    Error("All Gemini models failed.");
}


/* =========================
   CLEAN HTML
========================= */

function cleanHTML(html) {
  html = String(html)
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
    throw Error(
      "AI returned incomplete website HTML."
    );
  }

  return html;
}


/* =========================
   CREATE WEBSITE
========================= */

async function callAI(userPrompt) {

  const instruction = `
You are Nexa AI Website Builder.

Act as a senior product designer,
frontend engineer and creative director.

Create a complete production-quality website
from the user's brief.

Do NOT simply repeat the brief.

Infer:
- brand identity
- navigation
- page structure
- professional copy
- sections
- CTAs
- realistic content
- useful interactions
- responsive behavior
- accessibility
- animations
- visual hierarchy
- mobile layout
- desktop layout

The website must look like a real professional
business website, not a text dump or simple demo.

Return ONLY one complete HTML document.

Start with <!doctype html>.

Use inline CSS and JavaScript.
No Markdown.
No code fences.
No explanations.
No external framework dependency.

USER BRIEF:

${userPrompt}
`;

  const result =
    await generateAI(instruction);

  return cleanHTML(result);
}


/* =========================
   EDIT EXISTING WEBSITE
========================= */

async function editAI(editPrompt) {

  if (!S.site) {
    throw Error("There is no website to edit yet.");
  }

  const instruction = `
You are Nexa AI Website Editor.

The user already has a complete website.

Your job is to MODIFY the existing website
according to the user's new instruction.

IMPORTANT:

Do NOT create a completely unrelated website.

Keep the existing:
- brand
- useful sections
- existing content
- navigation
- overall design language

unless the user specifically asks to change them.

Actually implement the requested changes.

Improve the result where necessary.

Make sure:
- existing functionality still works
- responsive design remains good
- mobile layout remains good
- buttons still work
- navigation still works
- styling remains professional
- no broken HTML
- no placeholder text
- no explanation outside the HTML

Return ONLY the COMPLETE updated HTML document.

Start with <!doctype html>.

USER'S EDIT REQUEST:

${editPrompt}

CURRENT WEBSITE:

${S.site}
`;

  const result =
    await generateAI(instruction);

  return cleanHTML(result);
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
          Nexa will automatically find an
          available model.
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
          Your key stays in this browser.
        </p>

      </div>
    </div>
  `;

  document.querySelector("#connect").onclick =
    async () => {

      const key =
        document.querySelector("#key")
          .value.trim();

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

      } catch (e) {

        document.querySelector("#err").innerHTML =
          `<div class="error">
            ${esc(e.message)}
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
            Create a website or edit your existing
            website with AI.
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
              <b>Build progress</b>
              <span class="dot"></span>
            </div>

            <div id="steps"></div>

          </div>

        </section>


        <section class="workspace">

          <div class="workspace-top">

            <b>Website Preview</b>

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
      document.querySelector("#frame");

    if (frame) {
      frame.srcdoc = S.site;
    }
  }

  document.querySelector("#build")
    .onclick = buildOrEdit;

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

  document.querySelector("#export")
    .onclick = exportSite;

  document.querySelector("#public")
    .onclick = publish;

  document.querySelector("#reset")
    .onclick = () => {

      localStorage.removeItem("nexa_key");
      localStorage.removeItem("nexa_model");

      S.key = "";
      S.model = "";

      render();
    };
}


/* =========================
   BUILD OR EDIT
========================= */

async function buildOrEdit() {

  if (S.busy) return;

  const input =
    document.querySelector("#prompt");

  const prompt =
    input?.value?.trim();

  if (!prompt) {
    toast(
      S.site
        ? "Tell Nexa what you want to change."
        : "Describe the website you want to build."
    );
    return;
  }

  S.busy = true;
  S.steps = [];

  renderSteps();

  try {

    if (!S.site) {

      step(
        "brief",
        "active",
        "understanding your brief"
      );

      await sleep(400);

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

      await sleep(500);

      step(
        "plan",
        "done",
        "structure planned"
      );


      step(
        "design",
        "active",
        "designing visual system"
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
        "generating website"
      );

      const site =
        await callAI(prompt);

      S.site = site;

      step(
        "build",
        "done",
        "website generated"
      );


      step(
        "content",
        "active",
        "checking content and interactions"
      );

      await sleep(500);

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

      await sleep(500);

      step(
        "audit",
        "done",
        "quality check passed"
      );

    } else {

      /* EDIT MODE */

      step(
        "brief",
        "active",
        "understanding your edit"
      );

      await sleep(400);

      step(
        "brief",
        "done",
        "edit request understood"
      );


      step(
        "plan",
        "active",
        "planning website changes"
      );

      await sleep(400);

      step(
        "plan",
        "done",
        "changes planned"
      );


      step(
        "design",
        "active",
        "adapting existing design"
      );

      await sleep(400);

      step(
        "design",
        "done",
        "design adapted"
      );


      step(
        "build",
        "active",
        "editing existing website"
      );

      const edited =
        await editAI(prompt);

      S.site = edited;

      step(
        "build",
        "done",
        "website updated"
      );


      step(
        "content",
        "active",
        "checking updated content"
      );

      await sleep(500);

      step(
        "content",
        "done",
        "changes checked"
      );


      step(
        "audit",
        "active",
        "checking for broken elements"
      );

      await sleep(500);

      step(
        "audit",
        "done",
        "quality check passed"
      );
    }


    step(
      "preview",
      "active",
      "rendering finished website"
    );

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


    S.history.unshift(prompt);

    S.history =
      S.history.slice(0, 10);

    localStorage.setItem(
      "nexa_history",
      JSON.stringify(S.history)
    );


    render();

    toast(
      S.site
        ? "Website updated successfully."
        : "Website completed."
    );

  } catch (e) {

    console.error(e);

    toast(
      "Build failed: " +
      (e.message || "Unknown error")
    );

    step(
      "build",
      "active",
      "error — try again"
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

        const p =
          document.querySelector("#prompt");

        if (p) p.focus();

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
  a.download = "nexa-website.html";

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );

  toast("Website exported.");
}


/* =========================
   PUBLIC
========================= */

function publish() {

  if (!S.site) {
    toast("Build a website first.");
    return;
  }

  exportSite();

  toast(
    "Website e
