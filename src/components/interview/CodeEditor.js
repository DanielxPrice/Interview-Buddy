import React, {
  useMemo,
} from "react";

import CodeMirror from "@uiw/react-codemirror";

import {
  javascript,
} from "@codemirror/lang-javascript";

import {
  python,
} from "@codemirror/lang-python";

import {
  java,
} from "@codemirror/lang-java";

import {
  cpp,
} from "@codemirror/lang-cpp";

import {
  sql,
  PostgreSQL,
} from "@codemirror/lang-sql";

import {
  EditorView,
} from "@codemirror/view";

import {
  useTheme,
} from "../../context/ThemeContext";


function getLanguageExtension(
  language
) {
  switch (language) {
    case "javascript":
      return javascript({
        jsx: true,
      });

    case "java":
      return java();

    case "cpp":
      return cpp();

    case "sql":
      return sql({
        dialect: PostgreSQL,
      });

    case "python":
    default:
      return python();
  }
}


function CodeEditor({
  value,
  onChange,
  language = "python",
  disabled = false,
  ariaLabel = "Your Response",
}) {
  const { theme } =
    useTheme();


  const extensions =
    useMemo(
      () => [
        getLanguageExtension(
          language
        ),

        EditorView.contentAttributes.of({
          "aria-label":
            ariaLabel,
        }),
      ],
      [
        language,
        ariaLabel,
      ]
    );


  function handleChange(
    nextValue
  ) {
    onChange(
      nextValue
    );
  }


  return (
    <div className="interviewCodeMirror">
      <CodeMirror
        value={
          value
        }

        height="340px"

        placeholder="Write your solution here..."

        extensions={
          extensions
        }

        basicSetup={{
          lineNumbers:
            true,

          highlightActiveLineGutter:
            true,

          highlightActiveLine:
            true,

          highlightSpecialChars:
            true,

          history:
            true,

          foldGutter:
            false,

          drawSelection:
            true,

          dropCursor:
            true,

          indentOnInput:
            true,

          syntaxHighlighting:
            true,

          bracketMatching:
            true,

          closeBrackets:
            true,

          // Only enable SQL completion; preserve existing
          // behavior for the other supported languages.
          autocompletion:
            language === "sql",

          highlightSelectionMatches:
            true,
        }}

        indentWithTab={
          true
        }

        theme={
          theme === "Dark"
            ? "dark"
            : "light"
        }

        editable={
          !disabled
        }

        readOnly={
          disabled
        }

        onChange={
          handleChange
        }
      />
    </div>
  );
}


export default CodeEditor;