import React from "react";
import { useTheme } from "../../context/ThemeContext";

function BrandLogo({
  className = "",
  alt = "Interview Buddy logo",
}) {
  const { theme } = useTheme();

  const logoSource =
    theme === "Dark"
      ? "/IBlogo-dark.png"
      : "/IBlogo.png";

  function handleLogoError(event) {
    /*
     * If the dark logo has not been added yet,
     * fall back to the regular transparent logo.
     */
    if (
      event.currentTarget
        .getAttribute("src")
        ?.includes("IBlogo-dark.png")
    ) {
      event.currentTarget.src = "/IBlogo.png";
    }
  }

  return (
    <img
      src={logoSource}
      alt={alt}
      className={className}
      onError={handleLogoError}
    />
  );
}

export default BrandLogo;