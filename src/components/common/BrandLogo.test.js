import React from "react";
import {
  render,
  screen,
} from "@testing-library/react";

import BrandLogo from "./BrandLogo";
import { useTheme } from "../../context/ThemeContext";

jest.mock("../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
}));

describe("BrandLogo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses the light logo in light mode", () => {
    useTheme.mockReturnValue({
        theme: "Light",
    });

    render(<BrandLogo />);

    const logo = screen.getByAltText(
        "Interview Buddy logo"
    );

    expect(logo).toHaveAttribute(
        "src",
        "/IBlogo.png"
    );
    });

  test("uses the dark logo in dark mode", () => {
    useTheme.mockReturnValue({
      theme: "Dark",
    });

    render(<BrandLogo />);

    const logo = screen.getByAltText(
      "Interview Buddy logo"
    );

    expect(logo).toHaveAttribute(
      "src",
      "/IBlogo-dark.png"
    );
  });
});