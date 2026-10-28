import React, {
  useEffect,
  useState,
} from "react";

import PageLayout from "../components/layout/PageLayout";
import { PAGES } from "../utils/constants";
import { interviewService } from "../services";

const DEFAULT_QUESTION_COUNT = 10;
const MAX_QUESTION_COUNT = 20;

/*
 * Code and Theoretical interviews share
 * the daily AI-question allowance.
 *
 * Quiz Style does not consume this quota.
 */
const DAILY_QUOTA_MODES = new Set([
  "Code Style",
  "Theoretical Style",
]);

function formatOptionLabel(value) {
  return String(value || "")
    .split(" ")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function getModeDetails(mode) {
  switch (mode) {
    case "Quiz Style":
      return {
        icon: "▣",
        title: "Quiz Style",
        description:
          "Quick-fire multiple choice interview questions.",
      };

    case "Code Style":
      return {
        icon: "‹›",
        title: "Code Style",
        description:
          "Practice coding questions and technical solutions.",
      };

    case "Theoretical Style":
      return {
        icon: "◎",
        title: "Theoretical Style",
        description:
          "Practice explaining technical concepts in depth.",
      };

    default:
      return {
        icon: "?",
        title: "No Mode Selected",
        description:
          "Return to the dashboard and choose a practice mode.",
      };
  }
}

function InterviewSetupPage({
  currentPage,
  onNavigate,
  selectedMode,
  onStartInterview,
}) {
  const [
    jobRole,
    setJobRole,
  ] = useState("");

  const [
    jobRoleQuery,
    setJobRoleQuery,
  ] = useState("");

  const [
    isJobRoleDropdownOpen,
    setIsJobRoleDropdownOpen,
  ] = useState(false);

  const [
    experienceLevel,
    setExperienceLevel,
  ] = useState("");

  const [
    selectedPracticeGoals,
    setSelectedPracticeGoals,
  ] = useState([]);

  const [
    questionCount,
    setQuestionCount,
  ] = useState(
    DEFAULT_QUESTION_COUNT
  );

  const [
    setupOptions,
    setSetupOptions,
  ] = useState(() =>
    selectedMode && interviewService.getCachedSetupOptions
      ? interviewService.getCachedSetupOptions(selectedMode)
      : { jobRoles: [], experienceLevels: [], tags: [] }
  );

  const [
    isLoadingOptions,
    setIsLoadingOptions,
  ] = useState(false);

  const [
    optionsError,
    setOptionsError,
  ] = useState("");

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const [
    isStartingSession,
    setIsStartingSession,
  ] = useState(false);

  /*
   * Daily quota state.
   *
   * Only Code Style and Theoretical Style
   * use this shared allowance.
   */
  const [
    questionQuota,
    setQuestionQuota,
  ] = useState(null);

  const [
    isLoadingQuota,
    setIsLoadingQuota,
  ] = useState(false);

  const [
    quotaError,
    setQuotaError,
  ] = useState("");

  const [availableQuestionCount, setAvailableQuestionCount] = useState(null);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [metadataGeneration, setMetadataGeneration] = useState(0);

  const hasCompleteSetup = Boolean(
    selectedMode && jobRole && experienceLevel && selectedPracticeGoals.length > 0
  );

  const modeDetails =
    getModeDetails(selectedMode);

  const usesDailyQuota =
    DAILY_QUOTA_MODES.has(
      selectedMode
    );

  const isUnlimitedQuota =
    Boolean(
      questionQuota?.unlimited
    );

  const quotaRemaining =
    usesDailyQuota &&
    questionQuota &&
    !isUnlimitedQuota
      ? Math.max(
          0,
          Number(
            questionQuota.remaining ||
              0
          )
        )
      : null;

  const quotaLimit =
    usesDailyQuota &&
    questionQuota &&
    !isUnlimitedQuota
      ? Number(
          questionQuota.limit || 0
        )
      : null;

  /*
   * A normal user cannot configure
   * a session larger than the number
   * of questions they have remaining.
   *
   * Admins remain capped only by the
   * normal per-session maximum of 20.
   */
  const quotaBound =
    usesDailyQuota && questionQuota && !isUnlimitedQuota
      ? Math.min(MAX_QUESTION_COUNT, quotaRemaining)
      : MAX_QUESTION_COUNT;

  const maxAllowedQuestionCount =
    hasCompleteSetup && availableQuestionCount !== null
      ? Math.min(quotaBound, availableQuestionCount)
      : quotaBound;

  const questionCountAboveAvailability =
    hasCompleteSetup &&
    availableQuestionCount !== null &&
    Number(questionCount) > availableQuestionCount;

  const dailyLimitReached =
    usesDailyQuota &&
    questionQuota &&
    !isUnlimitedQuota &&
    quotaRemaining <= 0;

  const questionCountAboveQuota =
    usesDailyQuota &&
    questionQuota &&
    !isUnlimitedQuota &&
    Number(questionCount) >
      maxAllowedQuestionCount;

  /*
   * Load the user's daily shared
   * Code + Theoretical allowance.
   *
   * Quiz Style never requests the quota
   * because Quiz questions do not count.
   */
  useEffect(() => {
    let isCurrent = true;

    async function loadQuestionQuota() {
      if (
        !DAILY_QUOTA_MODES.has(
          selectedMode
        )
      ) {
        if (isCurrent) {
          setQuestionQuota(null);
          setQuotaError("");
          setIsLoadingQuota(false);

          /*
           * A previous counted mode may
           * have reduced the count to zero.
           *
           * Restore a normal usable count
           * when returning to Quiz Style.
           */
          setQuestionCount(
            (currentCount) => {
              const parsed =
                Number(
                  currentCount
                );

              if (
                !Number.isInteger(
                  parsed
                ) ||
                parsed < 1
              ) {
                return DEFAULT_QUESTION_COUNT;
              }

              return Math.min(
                parsed,
                MAX_QUESTION_COUNT
              );
            }
          );
        }

        return;
      }

      setIsLoadingQuota(true);
      setQuotaError("");
      setQuestionQuota(null);

      try {
        const quota =
          await interviewService
            .getQuestionQuota();

        if (!isCurrent) {
          return;
        }

        setQuestionQuota(
          quota
        );

        /*
         * Admin accounts have no daily
         * question limit.
         */
        if (quota?.unlimited) {
          setQuestionCount(
            (currentCount) => {
              const parsed =
                Number(
                  currentCount
                );

              if (
                !Number.isInteger(
                  parsed
                ) ||
                parsed < 1
              ) {
                return DEFAULT_QUESTION_COUNT;
              }

              return Math.min(
                parsed,
                MAX_QUESTION_COUNT
              );
            }
          );

          return;
        }

        const remaining =
          Math.max(
            0,
            Number(
              quota?.remaining ||
                0
            )
          );

        const allowedMaximum =
          Math.min(
            MAX_QUESTION_COUNT,
            remaining
          );

        /*
         * Automatically reduce the current
         * session length if the user does
         * not have enough quota remaining.
         */
        setQuestionCount(
          (currentCount) => {
            if (
              allowedMaximum === 0
            ) {
              return 0;
            }

            const parsed =
              Number(
                currentCount
              );

            if (
              !Number.isInteger(
                parsed
              ) ||
              parsed < 1
            ) {
              return Math.min(
                DEFAULT_QUESTION_COUNT,
                allowedMaximum
              );
            }

            return Math.min(
              parsed,
              allowedMaximum
            );
          }
        );
      } catch (error) {
        if (isCurrent) {
          setQuestionQuota(null);

          setQuotaError(
            error.message ||
              "Unable to load your daily question allowance."
          );
        }
      } finally {
        if (isCurrent) {
          setIsLoadingQuota(
            false
          );
        }
      }
    }

    loadQuestionQuota();

    return () => {
      isCurrent = false;
    };
  }, [selectedMode]);

  /* Setup metadata is packaged with React and filtered locally.
   * A background refresh notifies the page when Firestore changes.
   */
  useEffect(() => {
    let current = true;
    if (!selectedMode) {
      setSetupOptions({ jobRoles: [], experienceLevels: [], tags: [] });
      setOptionsError("Select an interview mode before configuring a session.");
      setIsLoadingOptions(false);
      return undefined;
    }

    function applyOptions(fromRefresh = false) {
      if (!current) return;
      try {
        if (interviewService.getCachedSetupOptions) {
          const nextOptions = interviewService.getCachedSetupOptions(selectedMode, {
            jobRole, experienceLevel,
          });
          setSetupOptions(nextOptions);
          if (fromRefresh) {
            // Remove selections invalidated by an admin's Firestore edit.
            const exists = (items, value) => items.some((item) =>
              item.toLowerCase() === value.toLowerCase()
            );
            if (jobRole && !exists(nextOptions.jobRoles, jobRole)) {
              setJobRole("");
              setJobRoleQuery("");
              setExperienceLevel("");
              setSelectedPracticeGoals([]);
            } else if (experienceLevel && !exists(nextOptions.experienceLevels, experienceLevel)) {
              setExperienceLevel("");
              setSelectedPracticeGoals([]);
            } else {
              setSelectedPracticeGoals((previous) => previous.filter((tag) =>
                exists(nextOptions.tags, tag)
              ));
            }
          }
          setOptionsError("");
          setIsLoadingOptions(false);
        } else {
          // Compatibility for existing mock-based frontend tests.
          setIsLoadingOptions(true);
          interviewService.getSetupOptions(selectedMode, { jobRole, experienceLevel })
            .then((options) => {
              if (current) { setSetupOptions(options); setOptionsError(""); }
            })
            .catch((error) => {
              if (current) setOptionsError(error.message || "Unable to load setup options.");
            })
            .finally(() => { if (current) setIsLoadingOptions(false); });
        }
      } catch (error) {
        setOptionsError(error.message || "Unable to load interview setup options.");
        setIsLoadingOptions(false);
      }
    }
    applyOptions();
    const unsubscribe = interviewService.subscribeSetupMetadata?.(() => {
      applyOptions(true);
      // Metadata can refresh without a change in selected role/level/tags.
      // Recalculate the displayed count from the updated cache as well.
      if (current) setMetadataGeneration((generation) => generation + 1);
    });
    return () => { current = false; unsubscribe?.(); };
  }, [selectedMode, jobRole, experienceLevel]);

  // Bundled metadata makes each tag click a synchronous local calculation.
  // A legacy server response without a count index retains the old API fallback.
  useEffect(() => {
    let current = true;
    setAvailableQuestionCount(null);
    setAvailabilityError("");
    setIsLoadingAvailability(false);

    if (!hasCompleteSetup) return () => { current = false; };

    try {
      const cachedCount = interviewService.getCachedAvailableQuestionCount?.({
        mode: selectedMode, jobRole, experienceLevel, tags: selectedPracticeGoals,
      });
      if (Number.isSafeInteger(cachedCount) && cachedCount >= 0) {
        setAvailableQuestionCount(cachedCount);
        return () => { current = false; };
      }
    } catch {
      // Cache unavailable: use the existing server count request below.
    }

    setIsLoadingAvailability(true);
    const timeout = setTimeout(async () => {
      try {
        const count = await interviewService.getAvailableQuestionCount({
          mode: selectedMode,
          jobRole,
          experienceLevel,
          tags: selectedPracticeGoals,
        });
        if (current) setAvailableQuestionCount(count);
      } catch (error) {
        if (current) setAvailabilityError(
          error.message || "Unable to check available questions."
        );
      } finally {
        if (current) setIsLoadingAvailability(false);
      }
    }, 300);

    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [selectedMode, jobRole, experienceLevel, selectedPracticeGoals, hasCompleteSetup,
    metadataGeneration]);

  // Do not leave the requested session length above the eligible pool.
  useEffect(() => {
    if (!hasCompleteSetup || availableQuestionCount === null) return;
    setQuestionCount((previous) => {
      if (maxAllowedQuestionCount === 0) return 0;
      const value = Number(previous);
      return Number.isInteger(value) && value >= 1
        ? Math.min(value, maxAllowedQuestionCount)
        : Math.min(DEFAULT_QUESTION_COUNT, maxAllowedQuestionCount);
    });
  }, [hasCompleteSetup, availableQuestionCount, maxAllowedQuestionCount]);

  const filteredJobRoles =
    setupOptions.jobRoles.filter(
      (role) =>
        role
          .toLowerCase()
          .includes(
            jobRoleQuery
              .trim()
              .toLowerCase()
          )
    );

  function handleJobRoleChange(
    event
  ) {
    setJobRoleQuery(
      event.target.value
    );

    /*
     * Once the user begins typing again,
     * the previous valid selection is cleared.
     *
     * This prevents somebody from typing an
     * arbitrary value that does not exist in
     * Firebase and submitting it.
     */
    setJobRole("");

    setIsJobRoleDropdownOpen(true);
    setErrorMessage("");
  }

  function handleJobRoleSelect(role) {
    const displayRole =
      formatOptionLabel(role);

    setJobRole(displayRole);
    setJobRoleQuery(displayRole);

    /*
     * Experience levels and practice
     * goals depend on the selected role.
     *
     * Reset them whenever the user
     * changes roles so stale selections
     * cannot create an invalid session.
     */
    setExperienceLevel("");
    setSelectedPracticeGoals([]);

    setIsJobRoleDropdownOpen(false);
    setErrorMessage("");
  }

  function handleJobRoleKeyDown(
    event
  ) {
    if (event.key === "Escape") {
      setIsJobRoleDropdownOpen(false);
      return;
    }

    if (
      event.key === "Enter" &&
      isJobRoleDropdownOpen &&
      filteredJobRoles.length > 0
    ) {
      event.preventDefault();

      handleJobRoleSelect(
        filteredJobRoles[0]
      );
    }
  }

  function handleJobRoleBlur() {
    /*
     * Give a dropdown option's click event
     * time to fire before closing the menu.
     */
    window.setTimeout(() => {
      setIsJobRoleDropdownOpen(false);
    }, 100);
  }

  function togglePracticeGoal(tag) {
    setSelectedPracticeGoals(
      (currentGoals) =>
        currentGoals.includes(tag)
          ? currentGoals.filter(
              (goal) =>
                goal !== tag
            )
          : [
              ...currentGoals,
              tag,
            ]
    );

    setErrorMessage("");
  }

  function decreaseQuestionCount() {
    if (
      maxAllowedQuestionCount <= 0
    ) {
      return;
    }

    setQuestionCount(
      (currentCount) =>
        Math.max(
          1,
          Number(currentCount) - 1
        )
    );

    setErrorMessage("");
  }

  function increaseQuestionCount() {
    if (
      maxAllowedQuestionCount <= 0
    ) {
      return;
    }

    setQuestionCount(
      (currentCount) =>
        Math.min(
          maxAllowedQuestionCount,
          Number(currentCount) + 1
        )
    );

    setErrorMessage("");
  }

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (
      !jobRole ||
      !experienceLevel ||
      selectedPracticeGoals.length ===
        0
    ) {
      setErrorMessage(
        "Please fill in all required fields before starting."
      );

      return;
    }

    if (isLoadingAvailability || availableQuestionCount === null || availabilityError) {
      setErrorMessage("Please wait until matching question availability is verified.");
      return;
    }
    if (availableQuestionCount === 0) {
      setErrorMessage("No questions match your current selections. Choose different tags or filters.");
      return;
    }

    /*
     * Code and Theoretical sessions require
     * a successfully verified quota before
     * they can start.
     */
    if (usesDailyQuota) {
      if (isLoadingQuota) {
        setErrorMessage(
          "Please wait while your daily question allowance is checked."
        );

        return;
      }

      if (
        quotaError ||
        !questionQuota
      ) {
        setErrorMessage(
          "Your daily question allowance could not be verified. Please try again."
        );

        return;
      }

      if (dailyLimitReached) {
        setErrorMessage(
          "You have reached your daily Code + Theoretical question limit."
        );

        return;
      }
    }

    const parsedQuestionCount =
      Number(questionCount);

    if (
      !Number.isInteger(
        parsedQuestionCount
      ) ||
      parsedQuestionCount < 1 ||
      parsedQuestionCount >
        MAX_QUESTION_COUNT
    ) {
      setErrorMessage(
        `Please choose between 1 and ${MAX_QUESTION_COUNT} questions.`
      );

      return;
    }

    if (
      usesDailyQuota &&
      !isUnlimitedQuota &&
      parsedQuestionCount >
        quotaRemaining
    ) {
      setErrorMessage(
        `You only have ${quotaRemaining} Code + Theoretical question${
          quotaRemaining === 1
            ? ""
            : "s"
        } remaining today.`
      );

      return;
    }

    if (questionCountAboveAvailability || parsedQuestionCount > availableQuestionCount) {
      setErrorMessage(`Only ${availableQuestionCount} questions match your selections.`);
      return;
    }

    setErrorMessage("");
    setIsStartingSession(true);

    try {
      // Bypass the short-lived count cache immediately before session creation.
      const latestAvailable = await interviewService.getAvailableQuestionCount({
        mode: selectedMode, jobRole, experienceLevel, tags: selectedPracticeGoals,
        fresh: true,
      });
      setAvailableQuestionCount(latestAvailable);
      if (latestAvailable < parsedQuestionCount) {
        setQuestionCount(Math.min(parsedQuestionCount, latestAvailable));
        setErrorMessage(latestAvailable === 0
          ? "No questions match your current selections. Choose different tags or filters."
          : `Availability changed. Only ${latestAvailable} matching questions remain.`);
        return;
      }

      /*
       * Refresh the quota immediately before
       * starting a counted session.
       *
       * This catches another tab/session using
       * questions while this setup page was open.
       */
      if (usesDailyQuota) {
        const latestQuota =
          await interviewService
            .getQuestionQuota();

        setQuestionQuota(
          latestQuota
        );

        if (
          !latestQuota?.unlimited
        ) {
          const latestRemaining =
            Math.max(
              0,
              Number(
                latestQuota?.remaining ||
                  0
              )
            );

          if (
            parsedQuestionCount >
            latestRemaining
          ) {
            setQuestionCount(
              latestRemaining
            );

            if (
              latestRemaining === 0
            ) {
              setErrorMessage(
                "You have reached your daily Code + Theoretical question limit."
              );
            } else {
              setErrorMessage(
                `Your remaining allowance changed. You now have ${latestRemaining} question${
                  latestRemaining === 1
                    ? ""
                    : "s"
                } available today.`
              );
            }

            return;
          }
        }
      }

      const session =
        await interviewService.startSession(
          {
            mode: selectedMode,
            jobRole,
            experienceLevel,
            tags: selectedPracticeGoals,
            questionCount:
              parsedQuestionCount,
          }
        );

      onStartInterview(session);
    } catch (error) {
      setErrorMessage(
        error.message ||
          "Unable to start the interview session. Please try again."
      );
    } finally {
      setIsStartingSession(false);
    }
  }

  function handleCancel() {
    onNavigate(
      PAGES.DASHBOARD
    );
  }

  return (
    <PageLayout
      title="Interview Setup"
      subtitle={`Selected Mode: ${
        selectedMode ||
        "No mode selected"
      }`}
      currentPage={currentPage}
      onNavigate={onNavigate}
    >
      <div className="interviewSetupShell">
        {/* Main setup form */}
        <section className="setupMainCard ib-card">
          <div className="setupCardHeader">
            <div>
              <span className="ib-eyebrow">
                New Practice Session
              </span>

              <h2>
                Configure your interview
              </h2>

              <p>
                Customize the session
                before you begin.
              </p>
            </div>
          </div>

          {/* Selected interview mode */}
          <div className="setupSection">
            <div className="setupSectionHeading">
              <div>
                <span className="setupSectionLabel">
                  Interview Mode
                </span>

                <p>
                  You selected this mode
                  from the dashboard.
                </p>
              </div>

              <button
                type="button"
                className="setupChangeModeButton"
                onClick={handleCancel}
                disabled={
                  isStartingSession
                }
              >
                Change Mode
              </button>
            </div>

            <div className="selectedModeCard">
              <div
                className="selectedModeIcon"
                aria-hidden="true"
              >
                {modeDetails.icon}
              </div>

              <div>
                <strong>
                  {modeDetails.title}
                </strong>

                <span>
                  {
                    modeDetails.description
                  }
                </span>
              </div>

              <span className="selectedModeStatus">
                Selected
              </span>
            </div>
          </div>

          {isLoadingOptions && (
            <div
              className="setupStatusMessage"
              role="status"
            >
              <span
                className="setupStatusDot"
                aria-hidden="true"
              />

              Loading available setup
              options from Firebase...
            </div>
          )}

          {optionsError && (
            <div
              className="setupErrorMessage"
              role="alert"
            >
              {optionsError}
            </div>
          )}

          <form
            className="setupForm"
            onSubmit={handleSubmit}
          >
            {/* Role + Experience */}
            <div className="setupFormGrid">
              <div className="setupField">
                <label
                  className="setupFieldLabel"
                  htmlFor="jobRole"
                >
                  Job Role
                </label>

                <div className="jobRoleCombobox">
                  <input
                    id="jobRole"
                    className="ib-input"
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={
                      isJobRoleDropdownOpen
                    }
                    aria-controls="jobRoleOptions"
                    placeholder="Search job roles"
                    value={jobRoleQuery}
                    autoComplete="off"
                    disabled={
                      isLoadingOptions ||
                      Boolean(
                        optionsError
                      )
                    }
                    onChange={
                      handleJobRoleChange
                    }
                    onFocus={() =>
                      setIsJobRoleDropdownOpen(
                        true
                      )
                    }
                    onBlur={
                      handleJobRoleBlur
                    }
                    onKeyDown={
                      handleJobRoleKeyDown
                    }
                  />

                  {isJobRoleDropdownOpen &&
                    !isLoadingOptions &&
                    !optionsError && (
                      <div
                        id="jobRoleOptions"
                        className="jobRoleDropdown"
                        role="listbox"
                        aria-label="Available job roles"
                      >
                        {filteredJobRoles.length >
                        0 ? (
                          filteredJobRoles.map(
                            (role) => (
                              <button
                                key={
                                  role
                                }
                                type="button"
                                className="jobRoleOption"
                                role="option"
                                aria-selected={
                                  jobRole.toLowerCase() ===
                                  formatOptionLabel(
                                    role
                                  ).toLowerCase()
                                }
                                onMouseDown={(
                                  event
                                ) =>
                                  event.preventDefault()
                                }
                                onClick={() =>
                                  handleJobRoleSelect(
                                    role
                                  )
                                }
                              >
                                {formatOptionLabel(
                                  role
                                )}
                              </button>
                            )
                          )
                        ) : (
                          <p className="jobRoleEmpty">
                            No matching job
                            roles found.
                          </p>
                        )}
                      </div>
                    )}
                </div>

                <span className="setupFieldHint">
                  Start typing to filter
                  roles stored in
                  Firebase.
                </span>
              </div>

              <div className="setupField">
                <label
                  className="setupFieldLabel"
                  htmlFor="experienceLevel"
                >
                  Experience Level
                </label>

                <select
                  id="experienceLevel"
                  className="ib-select"
                  value={
                    experienceLevel
                  }
                  disabled={
                    isLoadingOptions ||
                    Boolean(optionsError)
                  }
                  onChange={(event) => {
                    setExperienceLevel(
                      event.target.value
                    );

                    /*
                     * Available practice goals depend
                     * on both role and experience.
                     */
                    setSelectedPracticeGoals([]);

                    setErrorMessage("");
                  }}
                >
                  <option value="">
                    Select experience
                    level
                  </option>

                  {setupOptions.experienceLevels.map(
                    (level) => (
                      <option
                        key={level}
                        value={level}
                      >
                        {formatOptionLabel(
                          level
                        )}
                      </option>
                    )
                  )}
                </select>

                <span className="setupFieldHint">
                  Questions are filtered
                  for this experience
                  level.
                </span>
              </div>
            </div>

            {/* Practice goals */}
            <fieldset
              className="practiceGoalFieldset setupSection"
              disabled={
                isLoadingOptions ||
                Boolean(optionsError) ||
                !jobRole ||
                !experienceLevel
              }
            >
              <div className="setupSectionHeading">
                <div>
                  <legend className="setupSectionLabel">
                    Practice Goals
                  </legend>

                  <p>
                    {!jobRole
                      ? "Select a job role first."
                      : !experienceLevel
                        ? "Select an experience level to see available topics."
                        : "Choose one or more topics available for this session."}
                  </p>
                </div>

                <span className="practiceGoalCount">
                  {
                    selectedPracticeGoals.length
                  }{" "}
                  selected
                </span>
              </div>

              <div className="practiceGoalSelector">
                {setupOptions.tags.map(
                  (tag) => {
                    const isSelected =
                      selectedPracticeGoals.includes(
                        tag
                      );

                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`practiceGoalPill${
                          isSelected
                            ? " selected"
                            : ""
                        }`}
                        aria-pressed={
                          isSelected
                        }
                        onClick={() =>
                          togglePracticeGoal(
                            tag
                          )
                        }
                      >
                        {isSelected && (
                          <span
                            className="practiceGoalCheck"
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                        )}

                        {formatOptionLabel(
                          tag
                        )}
                      </button>
                    );
                  }
                )}
              </div>

              <p
                className="selectionSummary"
                aria-live="polite"
              >
                {selectedPracticeGoals.length ===
                0
                  ? "No practice goals selected yet."
                  : `${selectedPracticeGoals.length} practice goal${
                      selectedPracticeGoals.length ===
                      1
                        ? ""
                        : "s"
                    } selected.`}
              </p>
            </fieldset>

            {/* Availability is the full matching pool, not daily quota or session limit. */}
            <div className="setupSection questionAvailability" aria-live="polite">
              <span className="setupSectionLabel">Matching Questions</span>
              {!hasCompleteSetup ? (
                <p>Select a job role, experience level, and at least one tag to see availability.</p>
              ) : isLoadingAvailability ? (
                <p role="status">Checking available questions...</p>
              ) : availabilityError ? (
                <p className="questionAvailabilityError" role="alert">{availabilityError}</p>
              ) : availableQuestionCount === null ? (
                <p>Checking available questions...</p>
              ) : (
                <>
                  <strong className="questionAvailabilityTotal">
                    {availableQuestionCount} matching question{availableQuestionCount === 1 ? "" : "s"}
                  </strong>
                  <p>
                    Matches at least one selected tag. Session length is capped at 20
                    {usesDailyQuota ? " and your remaining daily allowance" : ""}.
                  </p>
                  {availableQuestionCount === 0 && (
                    <p className="questionAvailabilityError" role="alert">
                      No questions match these filters. Try other tags or selections.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Daily question allowance */}
            {usesDailyQuota && (
              <div className="setupSection quotaSection">
                <div className="setupSectionHeading">
                  <div>
                    <span className="setupSectionLabel">
                      Daily Question
                      Allowance
                    </span>

                    <p>
                      Code and
                      Theoretical questions
                      share one daily
                      allowance.
                    </p>
                  </div>

                  {questionQuota &&
                    !isLoadingQuota &&
                    !quotaError && (
                      <span
                        className={`quotaStatusBadge${
                          isUnlimitedQuota
                            ? " quotaStatusBadge--unlimited"
                            : dailyLimitReached
                              ? " quotaStatusBadge--empty"
                              : ""
                        }`}
                      >
                        {isUnlimitedQuota
                          ? "Unlimited"
                          : `${quotaRemaining} remaining`}
                      </span>
                    )}
                </div>

                {isLoadingQuota && (
                  <div
                    className="quotaMessage"
                    role="status"
                  >
                    Checking your daily
                    question allowance...
                  </div>
                )}

                {quotaError && (
                  <div
                    className="quotaMessage quotaMessage--error"
                    role="alert"
                  >
                    {quotaError}
                  </div>
                )}

                {questionQuota &&
                  !isLoadingQuota &&
                  !quotaError &&
                  isUnlimitedQuota && (
                    <div className="quotaCard quotaCard--unlimited">
                      <strong>
                        Unlimited
                        questions
                      </strong>

                      <span>
                        Admin accounts do
                        not consume the
                        standard daily
                        Code + Theoretical
                        allowance.
                      </span>
                    </div>
                  )}

                {questionQuota &&
                  !isLoadingQuota &&
                  !quotaError &&
                  !isUnlimitedQuota && (
                    <div className="quotaCard">
                      <div className="quotaPrimary">
                        <strong>
                          {quotaRemaining}{" "}
                          of {quotaLimit}{" "}
                          remaining today
                        </strong>

                        <span>
                          Resets daily in{" "}
                          {questionQuota.timeZone ||
                            "the configured time zone"}
                          .
                        </span>
                      </div>

                      <div
                        className="quotaProgress"
                        role="progressbar"
                        aria-label="Daily question allowance remaining"
                        aria-valuemin="0"
                        aria-valuemax={
                          quotaLimit
                        }
                        aria-valuenow={
                          quotaRemaining
                        }
                      >
                        <span
                          style={{
                            width:
                              quotaLimit > 0
                                ? `${Math.min(
                                    100,
                                    Math.max(
                                      0,
                                      (quotaRemaining /
                                        quotaLimit) *
                                        100
                                    )
                                  )}%`
                                : "0%",
                          }}
                        />
                      </div>

                      <div className="quotaBreakdown">
                        <span>
                          Code used:{" "}
                          <strong>
                            {questionQuota.codeQuestionsUsed ||
                              0}
                          </strong>
                        </span>

                        <span>
                          Theoretical used:{" "}
                          <strong>
                            {questionQuota.theoreticalQuestionsUsed ||
                              0}
                          </strong>
                        </span>
                      </div>

                      {dailyLimitReached && (
                        <p className="quotaLimitReached">
                          Daily limit
                          reached. Code and
                          Theoretical
                          sessions will be
                          available again
                          after the daily
                          reset.
                        </p>
                      )}
                    </div>
                  )}
              </div>
            )}

            {/* Question count */}
            <div className="setupSection questionSection">
              <div className="setupSectionHeading">
                <div>
                  <label
                    className="setupSectionLabel"
                    htmlFor="questionCount"
                  >
                    Number of Questions
                  </label>

                  <p>
                    {usesDailyQuota
                      ? "Choose a session length within your remaining daily allowance."
                      : "Choose the length of this practice session."}
                  </p>
                </div>
              </div>

              <div className="questionCountControl">
                <button
                  type="button"
                  className="questionCountButton"
                  aria-label="Decrease question count"
                  onClick={
                    decreaseQuestionCount
                  }
                  disabled={
                    maxAllowedQuestionCount <= 0 ||
                    (hasCompleteSetup && (isLoadingAvailability || availableQuestionCount === null)) ||
                    Number(questionCount) <= 1
                  }
                >
                  −
                </button>

                <input
                  id="questionCount"
                  className="questionCountInput"
                  type="number"
                  min={
                    maxAllowedQuestionCount ===
                    0
                      ? "0"
                      : "1"
                  }
                  max={
                    maxAllowedQuestionCount
                  }
                  step="1"
                  value={questionCount}
                  disabled={
                    isLoadingQuota ||
                    dailyLimitReached ||
                    (hasCompleteSetup && (
                      isLoadingAvailability || availableQuestionCount === null ||
                      availableQuestionCount === 0 || Boolean(availabilityError)
                    ))
                  }
                  onChange={(event) => {
                    setQuestionCount(
                      event.target.value
                    );

                    setErrorMessage(
                      ""
                    );
                  }}
                />

                <button
                  type="button"
                  className="questionCountButton"
                  aria-label="Increase question count"
                  onClick={
                    increaseQuestionCount
                  }
                  disabled={
                    maxAllowedQuestionCount <= 0 ||
                    (hasCompleteSetup && (isLoadingAvailability || availableQuestionCount === null)) ||
                    Number(questionCount) >= maxAllowedQuestionCount
                  }
                >
                  +
                </button>

                <span className="questionCountLimit">
                  {hasCompleteSetup && availableQuestionCount !== null
                    ? maxAllowedQuestionCount > 0
                      ? `1–${maxAllowedQuestionCount} for this session`
                      : "No matching questions"
                    : usesDailyQuota && questionQuota && !isUnlimitedQuota
                      ? maxAllowedQuestionCount > 0
                        ? `1–${maxAllowedQuestionCount} available today`
                        : "No questions remaining today"
                      : `1–${MAX_QUESTION_COUNT} questions`}
                </span>
              </div>

              {questionCountAboveAvailability && (
                <p className="questionQuotaWarning" role="alert">
                  Only {availableQuestionCount} questions match these filters.
                </p>
              )}

              {questionCountAboveQuota && (
                <p
                  className="questionQuotaWarning"
                  role="alert"
                >
                  You only have{" "}
                  {quotaRemaining} shared
                  Code + Theoretical
                  question
                  {quotaRemaining === 1
                    ? ""
                    : "s"}{" "}
                  remaining today.
                </p>
              )}
            </div>

            {errorMessage && (
              <div
                className="setupErrorMessage"
                role="alert"
              >
                {errorMessage}
              </div>
            )}

            <div className="setupActionRow">
              <button
                type="button"
                className="ib-button ib-button--secondary"
                onClick={handleCancel}
                disabled={
                  isStartingSession
                }
              >
                Cancel
              </button>

              <button
                type="submit"
                className="ib-button ib-button--primary setupStartButton"
                disabled={
                  isStartingSession ||
                  isLoadingOptions ||
                  (hasCompleteSetup && (
                    isLoadingAvailability ||
                    Boolean(availabilityError) ||
                    availableQuestionCount === null ||
                    availableQuestionCount === 0 ||
                    questionCountAboveAvailability
                  )) ||
                  Boolean(
                    optionsError
                  ) ||
                  (
                    usesDailyQuota &&
                    (
                      isLoadingQuota ||
                      Boolean(
                        quotaError
                      ) ||
                      !questionQuota ||
                      dailyLimitReached ||
                      questionCountAboveQuota
                    )
                  )
                }
              >
                {isStartingSession
                  ? "Starting Session..."
                  : "Start Session"}

                {!isStartingSession && (
                  <span
                    aria-hidden="true"
                  >
                    →
                  </span>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Session summary */}
        <aside className="setupSummaryCard ib-card">
          <span className="ib-eyebrow">
            Session Summary
          </span>

          <h2>
            Your Practice Session
          </h2>

          <p className="setupSummaryIntro">
            Review your current
            configuration before
            starting.
          </p>

          <div className="setupSummaryList">
            <div className="setupSummaryItem">
              <span>Mode</span>

              <strong>
                {modeDetails.title}
              </strong>
            </div>

            <div className="setupSummaryItem">
              <span>Job Role</span>

              <strong>
                {jobRole ||
                  "Not selected"}
              </strong>
            </div>

            <div className="setupSummaryItem">
              <span>
                Experience
              </span>

              <strong>
                {experienceLevel
                  ? formatOptionLabel(
                      experienceLevel
                    )
                  : "Not selected"}
              </strong>
            </div>

            <div className="setupSummaryItem">
              <span>
                Practice Goals
              </span>

              <strong>
                {
                  selectedPracticeGoals.length
                }
              </strong>
            </div>

            <div className="setupSummaryItem">
              <span>
                Questions
              </span>

              <strong>
                {questionCount}
              </strong>
            </div>

            {usesDailyQuota && (
              <div className="setupSummaryItem">
                <span>
                  Daily Allowance
                </span>

                <strong>
                  {isLoadingQuota
                    ? "Checking..."
                    : quotaError
                      ? "Unavailable"
                      : isUnlimitedQuota
                        ? "Unlimited"
                        : questionQuota
                          ? `${quotaRemaining}/${quotaLimit} left`
                          : "Unavailable"}
                </strong>
              </div>
            )}
          </div>

          <div className="setupSummaryNote">
            <span
              className="setupSummaryNoteIcon"
              aria-hidden="true"
            >
              ✓
            </span>

            <p>
              Questions will be
              selected using the role,
              experience level, and
              practice goals you choose.
            </p>
          </div>
        </aside>
      </div>
    </PageLayout>
  );
}

export default InterviewSetupPage;