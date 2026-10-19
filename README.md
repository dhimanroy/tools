# 🛠️ Tools & Utilities Directory

[![Deploy Status](https://img.shields.io/badge/Deployment-GitHub%20Pages-58a6ff?style=flat-square&logo=github)](https://dhimanroy.github.io/tools/)
[![Automated Services](https://img.shields.io/badge/Services-Autonomous%20Heartbeat-2ea44f?style=flat-square&logo=githubactions)](https://github.com/dhimanroy/tools/actions)
[![Zero Build Step](https://img.shields.io/badge/Frontend-Pure%20HTML5%20%2F%20CSS-0969da?style=flat-square)](https://dhimanroy.github.io/tools/)

A minimal, fast, and lightweight directory hosting web applications, computational utilities, and developer services on **GitHub Pages**.

**Live URL**: [https://dhimanroy.github.io/tools/](https://dhimanroy.github.io/tools/)

---

## 🌟 Highlights

- **Minimalist & Lightweight**: Clean, distraction-free typography and responsive card layout.
- **Dark / Light Theme**: Automatic theme detection (`prefers-color-scheme`) with instant manual toggle.
- **Zero Build Step**: Pure static HTML5 and CSS. No Node.js build pipeline required.
- **Autonomous Services**: Scheduled GitHub Actions workflows run background tasks and keep services updated.

---

## 🗂️ Tools Directory

| Tool | Status | Link | Description |
| :--- | :---: | :--- | :--- |
| **fixBib** | `🟢 Live` | [dhimanroy.github.io/fixBib](https://dhimanroy.github.io/fixBib/) | Browser-based BibTeX verification and formatting tool for academic and aerospace publications (AIAA, JFM, PoF). |
| **FlowData CFD Inspector** | `🟡 In Dev` | — | Planar velocity fields, boundary layer statistics, and wake profile inspection from simulation datasets. |
| **JSON & Payload Lab** | `🔵 Planned` | — | Client-side diagnostic workbench for JSONPath filtering, schema validation, and mock payloads. |

---

```text
tools/
├── index.html                     # Minimal tools directory landing page
├── styles.css                     # Modern lightweight stylesheet
├── app.js                         # Simple theme switcher
├── .github/
│   └── workflows/
│       └── deploy.yml             # GitHub Actions: Heartbeat runner + GitHub Pages deploy
├── get-a-discounted-hair-cut/     # Autonomous coupon tracker micro-app
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── data/
│   ├── crawler/
│   └── README.md
└── README.md                      # Repository documentation
```

---

## 🚀 How to Add a New Tool in 2 Steps

Adding another tool to this directory is straightforward:

### 1. Create a Subdirectory for Your Tool
Create a folder with your tool's web assets:
```bash
mkdir my-tool
# Add index.html, style.css, app.js inside ./my-tool/
```

### 2. Add a Card in `index.html`
Open [`index.html`](./index.html) and add an article inside `<main class="tools-grid">`:
```html
<article class="tool-card">
  <div class="card-top">
    <div class="card-title-group">
      <h2 class="card-title"><a href="./my-tool/">My New Tool</a></h2>
      <span class="card-tag">Category</span>
    </div>
    <span class="status-badge status-dev">Live</span>
  </div>
  <p class="card-desc">Description of what your tool does.</p>
  <div class="card-meta">
    <span class="card-tech">Tech Stack &bull; Details</span>
  </div>
</article>
```

Commit and push:
```bash
git add .
git commit -m "feat: add my-tool"
git push origin main
```
GitHub Pages will automatically publish it at `https://dhimanroy.github.io/tools/my-tool/`.

---

## 📄 License

&copy; 2026 [Dhiman Roy](https://github.com/dhimanroy). Released under the MIT License.
