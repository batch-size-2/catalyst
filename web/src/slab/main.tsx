import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SlabLab from "./SlabLab";
import "../index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SlabLab />
  </StrictMode>,
);
