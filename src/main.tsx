import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Assistant } from "./Assistant";
import "katex/dist/katex.min.css";
import "./style.css";
import "./math.css";
const panel = location.pathname.endsWith("/panel.html");
document.body.classList.toggle("panel-page", panel);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{panel ? <Assistant /> : <App />}</React.StrictMode>,
);
