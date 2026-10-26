import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { watchGlobalErrors } from "./ui/Guard";
import "./styles.css";

watchGlobalErrors();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
