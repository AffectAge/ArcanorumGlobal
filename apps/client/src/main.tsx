import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-center"
      offset={86}
      expand={false}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast: "arc-toast",
          title: "arc-toast-title",
          description: "arc-toast-description",
          success: "arc-toast-success",
          error: "arc-toast-error",
          warning: "arc-toast-warning",
        },
      }}
    />
  </React.StrictMode>,
);
