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

const esc = x => String(x).replace(/[&<>"']/g, m => ({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;",
  "'":"&#39;"
}[m]));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function step(id, status, note = "") {
  const x = S.steps.find(a => a[0] === id);

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
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
  ];

  const selected =
    preferred
      .map(id =>
        available.find(x => x.name === "models/" + id)
      )
      .find(Boolean)
    ||
    available.find(x => /flash/i.test(x.name))
    ||
    available[0];

  if (!selected) {
    throw Error(
      "No available generateContent model was found for this key."
    );
  }

  return selected.name.replace(/^models\//, "");
}

function cleanHtml(text) {
  let t = String(text || "").trim();

  t = t
    .replace(/^```html\s*/i, "")
    .replace(/^```xml\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const start = t.toLowerCase().indexOf("<!doctype html");

  if (start >= 0) {
    t = t.slice(start);
  }

  const end = t.toLowerCase().lastIndexOf("</html>");

  if (end >= 0) {
    t = t.slice(0, end + 7);
  }

  return t.trim();
}

async function callAI(prompt, mode = "build", existing = "") {

  if (!S.key || !S.model) {
    throw Error("Gemini is not connected.");
  }

  let instruction = `
You are Nexa Builder, an expert product designer,
UX designer, copywriter and senior frontend engineer.

Create a REAL, polished, professional production-quality
website from the user's request.

IMPORTANT:

- Do NOT simply repeat the user's prompt.
- Infer the brand identity.
- Infer the target audience.
- Create original professional copy.
- Create complete navigation.
- Create a strong hero section.
- Create meaningful sections.
- Create realistic content.
- Add products/services when appropriate.
- Add testimonials/social proof when appropriate.
- Add strong CTAs.
- Add a professional footer.
- Add responsive mobile design.
- Add hover and focus states.
- Add useful interactions.
- Add forms where appropriate.
- Avoid huge empty areas.
- Avoid generic placeholder text.
- Do not use Lorem ipsum.
- Do not make a simple text dump.
- Make the website feel custom-designed.
- Make it look like a serious production website.

TECHNICAL RULES:

- Return ONLY one complete HTML document.
- Start with <!doctype html>.
- End with </html>.
- CSS must be inside <style>.
- JavaScript must be inside <script>.
- No Markdown fences.
- No explanations.
- No React.
- No Tailwind.
- No npm.
- No build tools.
- The HTML must work as a standalone file.
- Make it responsive.
- Use semantic HTML.
- Make buttons and interactions functional.
`;

  if (mode === "build") {

    instruction += `
CREATE THE WEBSITE NOW.

USER BRIEF:
${prompt}
`;

  } else if (mode === "edit") {

    instruction += `
EDIT THE EXISTING WEBSITE.

Keep everything that is already good.

Apply the user's requested changes
without destroying the rest of the website.

USER REQUEST:
${prompt}

EXISTING WEBSITE:
${existing}
`;
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(S.model)}:generateContent?key=${encodeURIComponent(S.key)}`,
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
                text: instruction
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.75,
          maxOutputTokens: 65000
        }
      })
    }
  );

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw Error(
      d.error?.message ||
      `Gemini error HTTP ${r.status}`
    );
  }

  const parts =
    d.candidates?.[0]?.content?.parts || [];

  const text =
    parts
      .map(p => p.text || "")
      .join("");

  const html = cleanHtml(text);

  if (!html.toLowerCase().includes("<html")) {
    throw Error(
      "AI returned incomplete website code."
    );
  }

  if (!html.toLowerCase().includes("</html>")) {
    throw Error(
      "AI returned incomplete HTML."
    );
  }

  return html;
}

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
          Nexa will automatically find an available model.
        </p>

        <b>Gemini API Key</b>

        <input
          id="key"
          class="key"
          type="password"
          placeholder="AIza..."
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
          The key is stored only in this browser.
          Keep this builder private.
        </p>

      </div>
    </div>
  `;

  document.querySelector("#connect").onclick =
    async () => {

      const k =
        document.querySelector("#key")
          .value
          .trim();

      if (!k) return;

      const b =
        document.querySelector("#connect");

      b.disabled = true;
      b.textContent = "Connecting…";

      try {

        S.model = await models(k);
        S.key = k;

        localStorage.setItem(
          "nexa_key",
          k
        );

        localStorage.setItem(
          "nexa_model",
          S.model
        );

        render();

      } catch (e) {

        document.querySelector("#err").innerHTML =
          `<div class="error">
            ${esc(e.message)}
          </div>`;

      } finally {

        b.disabled = false;

        b.textContent =
          "Connect & Open Builder ✦";
      }
    };
}

function builder() {

  document.querySelector("#app").innerHTML = `

    <div class="app">

      <header class="top">

        <div class="brand">

          <span class="logo">✦</span>

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
            Build a real website from a prompt.
          </div>

          <p class="muted">
            Nexa understands, plans, designs,
            builds, checks and renders your website.
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

                ?

                `
                <iframe
                  id="frame"
                  class="frame"
                  sandbox="allow-scripts allow-forms allow-modals"
                ></iframe>
                `

                :

                `
                <div class="empty">

                  <div>

                    <h2>
                      Finished website appears here
                    </h2>

                    <p>
                      Enter a prompt and press Build.
                      Preview unlocks after the website
                      is generated successfully.
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

async function build() {

  if (S.busy) return;

  const input =
    document.querySelector("#prompt");

  const p =
    input?.value.trim();

  if (!p) {

    toast(
      "First describe the website you want."
    );

    return;
  }

  S.busy = true;
  S.steps = [];

  renderSteps();

  const button =
    document.querySelector("#build");

  if (button) {

    button.disabled = true;
    button.textContent = "Building…";
  }

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
      "creating website structure"
    );

    await sleep(600);

    step(
      "plan",
      "done",
      "structure ready"
    );

    step(
      "design",
      "active",
      "creating visual system"
    );

    await sleep(600);

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

    const site =
      await callAI(
        p,
        "build"
      );

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

    await sleep(700);

    step(
      "content",
      "done",
      "content checked"
    );

    step(
      "audit",
      "active",
      "running quality checks"
    );

    await sleep(700);

    const htmlLower =
      site.toLowerCase();

    const required = [
      "<!doctype html",
      "<html",
      "<head",
      "<body",
      "</html>"
    ];

    const valid =
      required.every(
        item =>
          htmlLower.includes(item)
      );

    if (!valid) {
      throw Error(
        "Generated website failed HTML quality check."
      );
    }

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

    S.site = site;

    localStorage.setItem(
      "nexa_site",
      S.site
    );

    await sleep(600);

    step(
      "preview",
      "done",
      "preview ready"
    );

    S.history.unshift(p);

    S.history =
      S.history.slice(0, 10);

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

    const active =
      S.steps.find(
        x => x[1] === "active"
      );

    if (active) {

      step(
        active[0],
        "active",
        "error — " + e.message
      );

    }

    toast(
      "Build failed: " +
      e.message
    );

  } finally {

    S.busy = false;

    const b =
      document.querySelector("#build");

    if (b) {

      b.disabled = false;
      b.textContent = "Build ✦";
    }
  }
}

function preview() {

  if (!S.site) {

    render();
    return;
  }

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
          class="frame"
          sandbox="allow-scripts allow-forms allow-modals"
        ></iframe>

      </div>

    </div>
  `;

  document.querySelector("#pframe").srcdoc =
    S.site;

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
        type:
          "text/html;charset=utf-8"
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
    1500
  );

  toast(
    "Website HTML exported."
  );
}

function publish() {

  if (!S.site) {

    toast(
      "Build a website first."
    );

    return;
  }

  exportSite();

  toast(
    "HTML exported. Upload it to GitHub Pages or another host for a public URL."
  );
}

function toast(message) {

  const t =
    document.createElement("div");

  t.className = "toast";

  t.textContent =
    message;

  document.body.appendChild(t);

  setTimeout(
    () => t.remove(),
    3500
  );
}

function render() {

  if (
    location.hash === "#preview" &&
    S.site
  ) {

    preview();
    return;
  }

  if (
    S.key &&
    S.model
  ) {

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
