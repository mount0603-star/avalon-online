import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import styles from "./styles.css?inline";

const styleElement = document.createElement("style");
styleElement.textContent = styles;
document.head.append(styleElement);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
