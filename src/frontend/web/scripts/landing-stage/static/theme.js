// The visitor's saved theme, applied before first paint (`index.html`).
try {
  if (localStorage.getItem("landing-stage-theme") === "dark")
    document.documentElement.classList.add("dark");
} catch {
  // Storage can be blocked; the page starts light.
}
