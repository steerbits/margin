import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
async function connectBrowser() {
  const connect = new URLSearchParams(location.hash.slice(1)).get("connect");
  if (connect) {
    const result = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: connect }),
    });
    if (result.ok) {
      history.replaceState(null, "", location.pathname + location.search);
      return true;
    }
  }
  return false;
}
window.addEventListener("hashchange", () => {
  void connectBrowser()
    .then((connected) => {
      if (connected) location.reload();
    })
    .catch(() => location.reload());
});
async function start() {
  await connectBrowser().catch(() => false);
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void start();
