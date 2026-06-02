import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Self-hosted fonts (replaces the prototype's Google Fonts CDN @import) — keeps
// the desktop app offline-first and compliant with the tight production CSP.
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";

// Design tokens first, then component styles (verbatim from the prototype).
import "./styles/colors_and_type.css";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
