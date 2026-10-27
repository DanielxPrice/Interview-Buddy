
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "./styles/index.css";
import "./styles/designSystem.css";
import "./styles/auth.css";
import "./styles/layout.css";
import "./styles/pages.css";
import "./styles/interviewSetup.css";
import "./styles/dashboard.css";
import "./styles/interviewSession.css";
import "./styles/settings.css";
import "./styles/sidebar.css";
import "./styles/history.css";

import App from "./App";

import {
  ThemeProvider,
} from "./context/ThemeContext";

import {
  AuthProvider,
} from "./context/AuthContext";

const root =
  ReactDOM.createRoot(
    document.getElementById(
      "root"
    )
  );

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
