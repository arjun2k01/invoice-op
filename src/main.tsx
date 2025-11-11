import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import InvoiceApp from "./InvoiceApp";

// ✅ Remove any accidental "dark" class on initial load
document.documentElement.classList.remove("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <InvoiceApp />
  </React.StrictMode>
);
